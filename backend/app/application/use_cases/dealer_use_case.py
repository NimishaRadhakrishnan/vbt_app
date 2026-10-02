"""
Dealer and Inventory Use Cases.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import datetime, date
from decimal import Decimal

from app.domain.entities.dealer import Dealer, Product, DealerStock, DealerOrder, OrderItem, StockMovement
from app.domain.repositories.dealer_repository import DealerRepository
from app.domain.services.pricing import (
    ResolvedPrice,
    line_total,
    merge_quantities,
    validate_band,
    validate_price,
)
from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
)


class _RowRejected(Exception):
    """One row of a bulk upload is unusable. Never escapes this module.

    Not a ``ValueError``, and not a domain exception. A ValueError here would
    trip the source guard in test_business_rules_reach_the_user.py, which
    exists because sixteen bare ValueErrors once reached users as "An
    unexpected error occurred" - and the guard is right to object: it cannot
    tell a local signal from one that escapes. A domain exception would be
    wrong in the other direction, because these are collected per row and
    reported together, not raised at the caller.
    """


class DealerUseCase:
    def __init__(self, dealer_repository: DealerRepository) -> None:
        self._dealer_repository = dealer_repository

    async def register_dealer(
        self,
        name: str,
        phone: str,
        district: str,
        village: Optional[str] = None,
        taluk: Optional[str] = None,
        location_lat: Optional[float] = None,
        location_lng: Optional[float] = None,
        address: Optional[str] = None,
        contact_person: Optional[str] = None,
        alternate_contact: Optional[str] = None,
        state: Optional[str] = None,
        pin_code: Optional[str] = None,
        gst_number: Optional[str] = None,
        dealer_type: Optional[str] = None,
        remarks: Optional[str] = None,
        assigned_sales_officer_id: Optional[uuid.UUID] = None,
        requested_by: Optional[uuid.UUID] = None,
        initial_status: str = "active",
    ) -> Dealer:
        existing = await self._dealer_repository.get_by_phone(phone)
        if existing:
            raise ConflictException(f"A dealer with phone number {phone} is already registered.")

        dealer = Dealer(
            name=name,
            phone=phone,
            district=district,
            village=village,
            taluk=taluk,
            location_lat=location_lat,
            location_lng=location_lng,
            address=address,
            contact_person=contact_person,
            alternate_contact=alternate_contact,
            state=state,
            pin_code=pin_code,
            gst_number=gst_number,
            dealer_type=dealer_type,
            remarks=remarks,
            # Section 3: "assigned Sales Officer" is who registered them
            # by default - a Sales Officer can never set this to someone
            # else (see the router: this parameter is only ever the
            # caller's own user_id for that role), only Admin/Manager
            # reassignment later could change it.
            assigned_sales_officer_id=assigned_sales_officer_id or requested_by,
            status=initial_status,
            requested_by=requested_by,
        )
        return await self._dealer_repository.add(dealer)

    async def search_dealers(
        self,
        district: Optional[str] = None,
        taluk: Optional[str] = None,
        status: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Dealer]:
        return await self._dealer_repository.search_dealers(
            district=district, taluk=taluk, status=status, date_from=date_from, date_to=date_to, limit=limit, offset=offset
        )

    async def set_dealer_approval(
        self, dealer_id: uuid.UUID, approve: bool, updated_by: Optional[uuid.UUID] = None
    ) -> Dealer:
        dealer = await self._dealer_repository.get_by_id(dealer_id)
        if not dealer:
            raise BusinessRuleViolationException("Dealer not found.")
        if dealer.status != "pending_approval":
            raise BusinessRuleViolationException(f"Dealer is not pending approval (current status: {dealer.status}).")
        new_status = "active" if approve else "rejected"
        updated = await self._dealer_repository.set_dealer_status(dealer_id, new_status, updated_by=updated_by)
        return updated

    async def get_dealer_profile(self, dealer_id: uuid.UUID) -> Optional[Dealer]:
        return await self._dealer_repository.get_by_id(dealer_id)

    # Inventory Stocks
    async def audit_stock(
        self,
        dealer_id: uuid.UUID,
        product_id: uuid.UUID,
        stock_qty: int,
        notes: Optional[str] = None,
        updated_by: Optional[uuid.UUID] = None,
    ) -> DealerStock:
        dealer = await self._dealer_repository.get_by_id(dealer_id)
        if not dealer:
            raise BusinessRuleViolationException("Dealer not found.")
        product = await self._dealer_repository.get_product_by_id(product_id)
        if not product:
            raise BusinessRuleViolationException("Product not found.")

        stock = await self._dealer_repository.get_stock(dealer_id, product_id)
        if stock:
            diff = stock_qty - stock.stock_qty
            stock.stock_qty = stock_qty
            stock.last_updated_at = datetime.utcnow()
            stock.updated_by = updated_by
            await self._dealer_repository.update_stock(stock)
        else:
            diff = stock_qty
            stock = DealerStock(dealer_id=dealer_id, product_id=product_id, stock_qty=stock_qty, updated_by=updated_by)
            await self._dealer_repository.update_stock(stock)

        # Record stock movement ledger
        movement = StockMovement(
            dealer_id=dealer_id,
            product_id=product_id,
            quantity=diff,
            movement_type="stock_adjustment",
            notes=notes or "Manual inventory stock audit.",
            updated_by=updated_by,
        )
        await self._dealer_repository.record_movement(movement)
        return stock

    # Orders
    async def place_order(
        self,
        dealer_id: uuid.UUID,
        created_by: uuid.UUID,
        items: list[dict],
        comments: Optional[str] = None,
        payment_deadline: Optional[date] = None,
        payment_terms: Optional[str] = None,
    ) -> DealerOrder:
        # Quantities are totalled per product BEFORE pricing. A dealer who
        # orders the same product on two lines of 5 is buying 10 and must be
        # priced at 10; pricing each line on its own would quietly withhold
        # the discount the order has earned, and the dealer would notice.
        lines: list[tuple[uuid.UUID, int]] = []
        for item in items:
            qty = int(item["quantity"])
            if qty < 1:
                raise BusinessRuleViolationException(
                    f"Order quantity must be at least 1 (got {qty})."
                )
            lines.append((uuid.UUID(item["product_id"]), qty))

        if not lines:
            raise BusinessRuleViolationException("An order needs at least one product.")

        quantity_by_product = merge_quantities(lines)

        # Resolve once per product, at the order's total quantity for it.
        priced: dict[uuid.UUID, ResolvedPrice] = {}
        for prod_id, total_qty in quantity_by_product.items():
            product = await self._dealer_repository.get_product_by_id(prod_id)
            if not product:
                raise BusinessRuleViolationException(f"Product not found: {prod_id}")
            priced[prod_id] = await self._dealer_repository.resolve_price(
                prod_id, total_qty, dealer_id=dealer_id
            )

        order_items = []
        total_amount = Decimal("0")
        for prod_id, qty in lines:
            unit_price = priced[prod_id].price
            total_amount += line_total(priced[prod_id], qty)
            order_items.append(
                OrderItem(product_id=prod_id, quantity=qty, unit_price=unit_price)
            )

        order = DealerOrder(
            dealer_id=dealer_id,
            created_by=created_by,
            status="submitted",
            items=order_items,
            total_amount=total_amount,
            comments=comments,
            payment_deadline=payment_deadline,
            payment_terms=payment_terms,
        )
        created_order = await self._dealer_repository.add_order(order)

        # Record stock movement for items
        for item in order_items:
            movement = StockMovement(
                dealer_id=dealer_id,
                product_id=item.product_id,
                quantity=item.quantity,
                movement_type="inbound_order",
                notes=f"Order {created_order.id} submitted.",
            )
            await self._dealer_repository.record_movement(movement)
            # Update dealer stock level
            stock = await self._dealer_repository.get_stock(dealer_id, item.product_id)
            if stock:
                stock.stock_qty += item.quantity
                await self._dealer_repository.update_stock(stock)
            else:
                new_stock = DealerStock(dealer_id=dealer_id, product_id=item.product_id, stock_qty=item.quantity)
                await self._dealer_repository.update_stock(new_stock)

        return created_order

    async def list_dealer_orders(self, dealer_id: Optional[uuid.UUID] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[DealerOrder]:
        return await self._dealer_repository.list_orders(dealer_id=dealer_id, status=status, limit=limit, offset=offset)

    async def list_products(self) -> list[Product]:
        return await self._dealer_repository.list_products()

    # ------------------------------------------------------------- Price tiers

    async def quote_price(
        self,
        product_id: uuid.UUID,
        quantity: int,
        dealer_id: Optional[uuid.UUID] = None,
    ) -> ResolvedPrice:
        """What one unit costs at this quantity for this dealer.

        The same call the order uses, exposed so a screen can show the rate
        before anything is committed.
        """
        if quantity < 1:
            raise BusinessRuleViolationException(
                f"Quantity must be at least 1 (got {quantity})."
            )
        try:
            return await self._dealer_repository.resolve_price(
                product_id, quantity, dealer_id=dealer_id
            )
        except LookupError as exc:
            raise BusinessRuleViolationException(str(exc)) from exc

    async def list_price_tiers(
        self,
        product_id: Optional[uuid.UUID] = None,
        dealer_id: Optional[uuid.UUID] = None,
        include_general: bool = True,
    ) -> list[dict]:
        return await self._dealer_repository.list_price_tiers(
            product_id=product_id, dealer_id=dealer_id, include_general=include_general
        )

    async def add_price_tier(
        self,
        product_id: uuid.UUID,
        min_quantity: int,
        price: Decimal,
        max_quantity: Optional[int] = None,
        dealer_id: Optional[uuid.UUID] = None,
        note: Optional[str] = None,
        created_by: Optional[uuid.UUID] = None,
    ) -> dict:
        product = await self._dealer_repository.get_product_by_id(product_id)
        if not product:
            raise BusinessRuleViolationException(f"Product not found: {product_id}")
        if dealer_id is not None:
            dealer = await self._dealer_repository.get_by_id(dealer_id)
            if not dealer:
                raise BusinessRuleViolationException(f"Dealer not found: {dealer_id}")

        # Validated here so the message names the problem in the user's terms.
        # The database enforces the same rules regardless.
        try:
            validate_band(min_quantity, max_quantity)
            validate_price(Decimal(price))
        except ValueError as exc:
            raise BusinessRuleViolationException(str(exc)) from exc

        overlap = await self._find_overlap(
            product_id, dealer_id, min_quantity, max_quantity
        )
        if overlap is not None:
            raise ConflictException(self._overlap_message(overlap))

        return await self._dealer_repository.add_price_tier(
            {
                "product_id": product_id,
                "dealer_id": dealer_id,
                "min_quantity": min_quantity,
                "max_quantity": max_quantity,
                "price": Decimal(price),
                "note": note,
                "created_by": created_by,
            }
        )

    async def update_price_tier(
        self,
        tier_id: uuid.UUID,
        changes: dict,
        updated_by: Optional[uuid.UUID] = None,
    ) -> dict:
        existing = await self._get_tier(tier_id)
        if existing is None:
            raise BusinessRuleViolationException(f"Price tier not found: {tier_id}")

        merged = {**existing, **{k: v for k, v in changes.items() if v is not None}}
        # An explicit null max_quantity means "open-ended", which the filter
        # above would have dropped. Honour it when the caller sent the key.
        if "max_quantity" in changes:
            merged["max_quantity"] = changes["max_quantity"]

        try:
            validate_band(merged["min_quantity"], merged["max_quantity"])
            validate_price(Decimal(merged["price"]))
        except ValueError as exc:
            raise BusinessRuleViolationException(str(exc)) from exc

        overlap = await self._find_overlap(
            merged["product_id"],
            merged.get("dealer_id"),
            merged["min_quantity"],
            merged["max_quantity"],
            ignore_tier_id=tier_id,
        )
        if overlap is not None:
            raise ConflictException(self._overlap_message(overlap))

        payload = {
            "min_quantity": merged["min_quantity"],
            "max_quantity": merged["max_quantity"],
            "price": Decimal(merged["price"]),
            "note": merged.get("note"),
            "updated_by": updated_by,
        }
        result = await self._dealer_repository.update_price_tier(tier_id, payload)
        if result is None:
            raise BusinessRuleViolationException(f"Price tier not found: {tier_id}")
        return result

    async def delete_price_tier(self, tier_id: uuid.UUID) -> bool:
        deleted = await self._dealer_repository.delete_price_tier(tier_id)
        if not deleted:
            raise BusinessRuleViolationException(f"Price tier not found: {tier_id}")
        return True

    async def _get_tier(self, tier_id: uuid.UUID) -> Optional[dict]:
        for tier in await self._dealer_repository.list_price_tiers():
            if tier["id"] == tier_id:
                return tier
        return None

    async def _find_overlap(
        self,
        product_id: uuid.UUID,
        dealer_id: Optional[uuid.UUID],
        min_quantity: int,
        max_quantity: Optional[int],
        ignore_tier_id: Optional[uuid.UUID] = None,
    ) -> Optional[dict]:
        """The existing band this one would collide with, if any.

        The database refuses the overlap either way. This exists so the user is
        told *which* band is in the way, instead of reading a constraint name.
        """
        top = max_quantity if max_quantity is not None else 2147483646
        existing = await self._dealer_repository.list_price_tiers(
            product_id=product_id, dealer_id=dealer_id, include_general=False
        )
        if dealer_id is None:
            existing = [t for t in existing if t["dealer_id"] is None]
        for tier in existing:
            if ignore_tier_id is not None and tier["id"] == ignore_tier_id:
                continue
            other_top = (
                tier["max_quantity"] if tier["max_quantity"] is not None else 2147483646
            )
            if min_quantity <= other_top and tier["min_quantity"] <= top:
                return tier
        return None

    @staticmethod
    def _overlap_message(tier: dict) -> str:
        top = tier["max_quantity"]
        band = f"{tier['min_quantity']}+" if top is None else f"{tier['min_quantity']}-{top}"
        scope = "this dealer" if tier["dealer_id"] else "all dealers"
        return (
            f"That quantity range overlaps an existing band ({band} units at "
            f"₹{tier['price']} for {scope}). Adjust one of them so they do "
            "not share any quantity."
        )

    async def bulk_add_price_tiers(
        self,
        rows: list[dict],
        created_by: Optional[uuid.UUID] = None,
        dry_run: bool = False,
    ) -> dict:
        """Add many bands at once, all or nothing.

        Every row is checked before any row is written, and the result reports
        each failure against its own row number. A half-applied price sheet is
        worse than a rejected one: the operator cannot tell which products are
        now priced wrongly, and the dealer finds out first.

        With ``dry_run`` the caller gets the same report and nothing is
        written, which is what the preview step in the UI uses.
        """
        errors: list[dict] = []
        # Bands staged so far, so two rows inside the same upload that overlap
        # each other are caught here rather than by the database halfway
        # through - the batch is refused whole either way, but this way the
        # operator is told which two rows disagree.
        staged: list[dict] = []

        for index, row in enumerate(rows):
            line = row.get("row_number", index + 1)
            try:
                product_id = row["product_id"]
                min_quantity = int(row["min_quantity"])
                max_quantity = row.get("max_quantity")
                max_quantity = int(max_quantity) if max_quantity is not None else None
                price = Decimal(str(row["price"]))
                dealer_id = row.get("dealer_id")

                validate_band(min_quantity, max_quantity)
                validate_price(price)

                product = await self._dealer_repository.get_product_by_id(product_id)
                if not product:
                    raise _RowRejected(f"Product not found: {product_id}")
                if dealer_id is not None and not await self._dealer_repository.get_by_id(
                    dealer_id
                ):
                    raise _RowRejected(f"Dealer not found: {dealer_id}")

                clash = await self._find_overlap(
                    product_id, dealer_id, min_quantity, max_quantity
                )
                if clash is not None:
                    raise _RowRejected(self._overlap_message(clash))

                top = max_quantity if max_quantity is not None else 2147483646
                for other in staged:
                    if (
                        other["product_id"] == product_id
                        and other["dealer_id"] == dealer_id
                        and min_quantity <= other["_top"]
                        and other["min_quantity"] <= top
                    ):
                        raise _RowRejected(
                            f"Overlaps row {other['row_number']} in this same upload "
                            f"({other['min_quantity']}-"
                            f"{other['max_quantity'] if other['max_quantity'] is not None else '+'})."
                        )

                staged.append(
                    {
                        "row_number": line,
                        "product_id": product_id,
                        "dealer_id": dealer_id,
                        "min_quantity": min_quantity,
                        "max_quantity": max_quantity,
                        "_top": top,
                        "price": price,
                        "note": row.get("note"),
                        "created_by": created_by,
                    }
                )
            except (_RowRejected, KeyError, ValueError, TypeError, ArithmeticError) as exc:
                message = f"Missing column: {exc}" if isinstance(exc, KeyError) else str(exc)
                errors.append({"row_number": line, "error": message})

        if errors:
            return {
                "applied": 0,
                "rejected": len(errors),
                "errors": errors,
                "dry_run": dry_run,
                "message": (
                    f"{len(errors)} of {len(rows)} rows could not be accepted. "
                    "Nothing was saved - fix the rows listed and submit again."
                ),
            }

        if dry_run:
            return {
                "applied": 0,
                "would_apply": len(staged),
                "rejected": 0,
                "errors": [],
                "dry_run": True,
                "preview": [
                    {k: v for k, v in row.items() if not k.startswith("_")}
                    for row in staged
                ],
                "message": f"All {len(staged)} rows are valid. Nothing saved yet.",
            }

        for row in staged:
            await self._dealer_repository.add_price_tier(
                {k: v for k, v in row.items() if not k.startswith("_") and k != "row_number"}
            )

        return {
            "applied": len(staged),
            "rejected": 0,
            "errors": [],
            "dry_run": False,
            "message": f"{len(staged)} price bands saved.",
        }
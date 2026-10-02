"""
SQLAlchemyDealerRepository implementation.
"""

from __future__ import annotations
from typing import Optional
from datetime import date, datetime, time

import uuid

from decimal import Decimal

from geoalchemy2.shape import to_shape
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.dealer import Dealer, Product, DealerStock, DealerOrder, OrderItem, StockMovement
from app.domain.repositories.dealer_repository import DealerRepository
from app.domain.services.pricing import (
    PRICE_SOURCE_DEALER_TIER,
    PRICE_SOURCE_GENERAL_TIER,
    PRICE_SOURCE_LIST,
    ResolvedPrice,
)
from app.infrastructure.database.models.dealer_model import DealerModel, ProductModel, ProductPriceTierModel, DealerStockModel, DealerOrderModel, OrderItemModel, StockMovementModel


class SQLAlchemyDealerRepository(DealerRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_dealer_entity(model: DealerModel) -> Dealer:
        lat, lng = None, None
        if model.location:
            pt = to_shape(model.location)
            lat, lng = pt.y, pt.x
        return Dealer(
            id=model.id,
            name=model.name,
            phone=model.phone,
            district=model.district,
            village=model.village,
            taluk=model.taluk,
            location_lat=lat,
            location_lng=lng,
            address=model.address,
            contact_person=model.contact_person,
            alternate_contact=model.alternate_contact,
            state=model.state,
            pin_code=model.pin_code,
            gst_number=model.gst_number,
            dealer_type=model.dealer_type,
            remarks=model.remarks,
            assigned_sales_officer_id=model.assigned_sales_officer_id,
            status=model.status,
            requested_by=model.requested_by,
            updated_by=model.updated_by,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    @staticmethod
    def _to_product_entity(model: ProductModel) -> Product:
        return Product(
            id=model.id,
            name=model.name,
            category=model.category,
            sku_code=model.sku_code,
            price=float(model.price),
            description=model.description,
            is_active=model.is_active,
            created_at=model.created_at,
        )

    @staticmethod
    def _to_stock_entity(model: DealerStockModel) -> DealerStock:
        return DealerStock(
            id=model.id,
            dealer_id=model.dealer_id,
            product_id=model.product_id,
            stock_qty=model.stock_qty,
            low_stock_threshold=model.low_stock_threshold,
            updated_by=model.updated_by,
            last_updated_at=model.last_updated_at,
        )

    @staticmethod
    def _to_order_entity(model: DealerOrderModel) -> DealerOrder:
        items = [
            OrderItem(
                id=item.id,
                product_id=item.product_id,
                quantity=item.quantity,
                unit_price=float(item.unit_price),
            )
            for item in model.items
        ]
        return DealerOrder(
            id=model.id,
            dealer_id=model.dealer_id,
            created_by=model.created_by,
            status=model.status,
            items=items,
            total_amount=float(model.total_amount),
            comments=model.comments,
            payment_deadline=model.payment_deadline,
            payment_terms=model.payment_terms,
            order_date=model.order_date,
            created_at=model.created_at,
        )

    @staticmethod
    def _to_movement_entity(model: StockMovementModel) -> StockMovement:
        return StockMovement(
            id=model.id,
            dealer_id=model.dealer_id,
            product_id=model.product_id,
            quantity=model.quantity,
            movement_type=model.movement_type,
            notes=model.notes,
            updated_by=model.updated_by,
            recorded_at=model.recorded_at,
        )

    async def get_by_id(self, dealer_id: uuid.UUID) -> Optional[Dealer]:
        model = await self._session.get(DealerModel, dealer_id)
        return self._to_dealer_entity(model) if model else None

    async def get_by_phone(self, phone: str) -> Optional[Dealer]:
        result = await self._session.execute(select(DealerModel).where(DealerModel.phone == phone))
        model = result.scalar_one_or_none()
        return self._to_dealer_entity(model) if model else None

    async def add(self, dealer: Dealer) -> Dealer:
        loc_wkt = None
        if dealer.location_lat is not None and dealer.location_lng is not None:
            loc_wkt = f"POINT({dealer.location_lng} {dealer.location_lat})"
        model = DealerModel(
            id=dealer.id,
            name=dealer.name,
            phone=dealer.phone,
            district=dealer.district,
            village=dealer.village,
            taluk=dealer.taluk,
            location=loc_wkt,
            address=dealer.address,
            contact_person=dealer.contact_person,
            alternate_contact=dealer.alternate_contact,
            state=dealer.state,
            pin_code=dealer.pin_code,
            gst_number=dealer.gst_number,
            dealer_type=dealer.dealer_type,
            remarks=dealer.remarks,
            assigned_sales_officer_id=dealer.assigned_sales_officer_id,
            status=dealer.status,
            requested_by=dealer.requested_by,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_dealer_entity(model)

    async def search_dealers(
        self,
        *,
        district: Optional[str] = None,
        taluk: Optional[str] = None,
        status: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Dealer]:
        query = select(DealerModel).where(DealerModel.is_deleted == False)  # noqa: E712
        if district:
            query = query.where(DealerModel.district.ilike(f"%{district}%"))
        if taluk:
            query = query.where(DealerModel.taluk.ilike(f"%{taluk}%"))
        if status:
            query = query.where(DealerModel.status == status)
        if date_from:
            query = query.where(DealerModel.created_at >= datetime.combine(date_from, time.min))
        if date_to:
            query = query.where(DealerModel.created_at <= datetime.combine(date_to, time.max))
        result = await self._session.execute(
            query.order_by(DealerModel.created_at.desc()).limit(limit).offset(offset)
        )
        return [self._to_dealer_entity(m) for m in result.scalars().all()]

    async def set_dealer_status(
        self, dealer_id: uuid.UUID, status: str, updated_by: Optional[uuid.UUID] = None
    ) -> Optional[Dealer]:
        model = await self._session.get(DealerModel, dealer_id)
        if model is None:
            return None
        model.status = status
        if updated_by is not None:
            model.updated_by = updated_by
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_dealer_entity(model)

    async def get_product_by_id(self, product_id: uuid.UUID) -> Optional[Product]:
        model = await self._session.get(ProductModel, product_id)
        return self._to_product_entity(model) if model else None

    async def get_product_by_sku(self, sku_code: str) -> Optional[Product]:
        result = await self._session.execute(select(ProductModel).where(ProductModel.sku_code == sku_code))
        model = result.scalar_one_or_none()
        return self._to_product_entity(model) if model else None

    async def add_product(self, product: Product) -> Product:
        model = ProductModel(
            id=product.id,
            name=product.name,
            category=product.category,
            sku_code=product.sku_code,
            price=product.price,
            description=product.description,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_product_entity(model)

    async def list_products(self) -> list[Product]:
        result = await self._session.execute(
            select(ProductModel).where(ProductModel.is_active == True).order_by(ProductModel.name.asc())  # noqa: E712
        )
        return [self._to_product_entity(m) for m in result.scalars().all()]

    # ---------------------------------------------------------------- Price tiers

    _RESOLVE_PRICE_SQL = text(
        """
        SELECT
            t.id,
            t.price,
            t.min_quantity,
            t.max_quantity,
            t.note,
            (t.dealer_id IS NOT NULL) AS is_dealer_specific
        FROM product_price_tiers t
        WHERE t.product_id = CAST(:product_id AS UUID)
          AND (
                t.dealer_id IS NULL
                OR (
                    CAST(:dealer_id AS UUID) IS NOT NULL
                    AND t.dealer_id = CAST(:dealer_id AS UUID)
                )
              )
          AND t.min_quantity <= :quantity
          AND (t.max_quantity IS NULL OR t.max_quantity >= :quantity)
        -- A dealer's own band beats the general one. At most one row can match
        -- per level, so this chooses a level of specificity, not a winner
        -- between rivals: ex_price_tier_no_overlap rules those out.
        ORDER BY is_dealer_specific DESC
        LIMIT 1
        """
    )

    async def resolve_price(
        self,
        product_id: uuid.UUID,
        quantity: int,
        dealer_id: Optional[uuid.UUID] = None,
    ) -> ResolvedPrice:
        if quantity < 1:
            raise ValueError(f"Quantity must be at least 1 (got {quantity}).")

        row = (
            await self._session.execute(
                self._RESOLVE_PRICE_SQL,
                {
                    "product_id": str(product_id),
                    "dealer_id": str(dealer_id) if dealer_id else None,
                    "quantity": quantity,
                },
            )
        ).first()

        if row is not None:
            return ResolvedPrice(
                price=Decimal(row.price),
                source=(
                    PRICE_SOURCE_DEALER_TIER
                    if row.is_dealer_specific
                    else PRICE_SOURCE_GENERAL_TIER
                ),
                tier_id=row.id,
                min_quantity=row.min_quantity,
                max_quantity=row.max_quantity,
                note=row.note,
            )

        # No band covers this quantity: the list price stands.
        list_price = (
            await self._session.execute(
                select(ProductModel.price).where(ProductModel.id == product_id)
            )
        ).scalar_one_or_none()
        if list_price is None:
            # Pricing something that does not exist is a caller bug. Returning
            # zero here would put a free order in front of a dealer.
            raise LookupError(f"No product {product_id} to price")

        return ResolvedPrice(price=Decimal(list_price), source=PRICE_SOURCE_LIST)

    @staticmethod
    def _tier_to_dict(m: ProductPriceTierModel) -> dict:
        return {
            "id": m.id,
            "product_id": m.product_id,
            "dealer_id": m.dealer_id,
            "min_quantity": m.min_quantity,
            "max_quantity": m.max_quantity,
            "price": Decimal(m.price),
            "note": m.note,
            "created_at": m.created_at,
            "updated_at": m.updated_at,
        }

    async def list_price_tiers(
        self,
        product_id: Optional[uuid.UUID] = None,
        dealer_id: Optional[uuid.UUID] = None,
        include_general: bool = True,
    ) -> list[dict]:
        stmt = select(ProductPriceTierModel)
        if product_id is not None:
            stmt = stmt.where(ProductPriceTierModel.product_id == product_id)
        if dealer_id is not None:
            if include_general:
                # What this dealer would actually be charged: their own bands
                # plus the general ones they fall back to.
                stmt = stmt.where(
                    (ProductPriceTierModel.dealer_id == dealer_id)
                    | (ProductPriceTierModel.dealer_id.is_(None))
                )
            else:
                stmt = stmt.where(ProductPriceTierModel.dealer_id == dealer_id)
        stmt = stmt.order_by(
            ProductPriceTierModel.product_id,
            ProductPriceTierModel.dealer_id.is_(None).desc(),
            ProductPriceTierModel.min_quantity,
        )
        result = await self._session.execute(stmt)
        return [self._tier_to_dict(m) for m in result.scalars().all()]

    async def add_price_tier(self, tier: dict) -> dict:
        model = ProductPriceTierModel(
            product_id=tier["product_id"],
            dealer_id=tier.get("dealer_id"),
            min_quantity=tier["min_quantity"],
            max_quantity=tier.get("max_quantity"),
            price=tier["price"],
            note=tier.get("note"),
            created_by=tier.get("created_by"),
            updated_by=tier.get("created_by"),
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._tier_to_dict(model)

    async def update_price_tier(self, tier_id: uuid.UUID, changes: dict) -> Optional[dict]:
        model = (
            await self._session.execute(
                select(ProductPriceTierModel).where(ProductPriceTierModel.id == tier_id)
            )
        ).scalar_one_or_none()
        if model is None:
            return None
        for field in ("min_quantity", "max_quantity", "price", "note", "dealer_id"):
            if field in changes:
                setattr(model, field, changes[field])
        if "updated_by" in changes:
            model.updated_by = changes["updated_by"]
        await self._session.flush()
        await self._session.refresh(model)
        return self._tier_to_dict(model)

    async def delete_price_tier(self, tier_id: uuid.UUID) -> bool:
        model = (
            await self._session.execute(
                select(ProductPriceTierModel).where(ProductPriceTierModel.id == tier_id)
            )
        ).scalar_one_or_none()
        if model is None:
            return False
        await self._session.delete(model)
        await self._session.flush()
        return True

    async def get_stock(self, dealer_id: uuid.UUID, product_id: uuid.UUID) -> Optional[DealerStock]:
        result = await self._session.execute(
            select(DealerStockModel).where(
                DealerStockModel.dealer_id == dealer_id,
                DealerStockModel.product_id == product_id
            )
        )
        model = result.scalar_one_or_none()
        return self._to_stock_entity(model) if model else None

    async def update_stock(self, stock: DealerStock) -> DealerStock:
        model = await self._session.get(DealerStockModel, stock.id)
        if model is None:
            model = DealerStockModel(
                id=stock.id,
                dealer_id=stock.dealer_id,
                product_id=stock.product_id,
                stock_qty=stock.stock_qty,
                low_stock_threshold=stock.low_stock_threshold,
                updated_by=stock.updated_by,
            )
            self._session.add(model)
        else:
            model.stock_qty = stock.stock_qty
            model.low_stock_threshold = stock.low_stock_threshold
            if stock.updated_by is not None:
                model.updated_by = stock.updated_by
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_stock_entity(model)

    async def get_low_stock_alerts(self, dealer_id: Optional[uuid.UUID] = None) -> list[DealerStock]:
        query = select(DealerStockModel).where(DealerStockModel.stock_qty <= DealerStockModel.low_stock_threshold)
        if dealer_id:
            query = query.where(DealerStockModel.dealer_id == dealer_id)
        result = await self._session.execute(query)
        return [self._to_stock_entity(m) for m in result.scalars().all()]

    async def get_order_by_id(self, order_id: uuid.UUID) -> Optional[DealerOrder]:
        model = await self._session.get(DealerOrderModel, order_id)
        return self._to_order_entity(model) if model else None

    async def add_order(self, order: DealerOrder) -> DealerOrder:
        model = DealerOrderModel(
            id=order.id,
            dealer_id=order.dealer_id,
            created_by=order.created_by,
            status=order.status,
            total_amount=order.total_amount,
            comments=order.comments,
            payment_deadline=order.payment_deadline,
            payment_terms=order.payment_terms,
            order_date=order.order_date,
        )
        for item in order.items:
            model.items.append(
                OrderItemModel(
                    id=item.id,
                    product_id=item.product_id,
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                )
            )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_order_entity(model)

    async def update_order(self, order: DealerOrder) -> DealerOrder:
        model = await self._session.get(DealerOrderModel, order.id)
        if model is None:
            raise ValueError(f"Order not found: {order.id}")
        model.status = order.status
        model.total_amount = order.total_amount
        model.comments = order.comments
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_order_entity(model)

    async def list_orders(self, *, dealer_id: Optional[uuid.UUID] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[DealerOrder]:
        query = select(DealerOrderModel)
        if dealer_id:
            query = query.where(DealerOrderModel.dealer_id == dealer_id)
        if status:
            query = query.where(DealerOrderModel.status == status)
        result = await self._session.execute(
            query.order_by(DealerOrderModel.created_at.desc()).limit(limit).offset(offset)
        )
        return [self._to_order_entity(m) for m in result.scalars().all()]

    async def record_movement(self, movement: StockMovement) -> StockMovement:
        model = StockMovementModel(
            id=movement.id,
            dealer_id=movement.dealer_id,
            product_id=movement.product_id,
            quantity=movement.quantity,
            movement_type=movement.movement_type,
            notes=movement.notes,
            updated_by=movement.updated_by,
            recorded_at=movement.recorded_at,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_movement_entity(model)

    async def list_movements(self, dealer_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[StockMovement]:
        result = await self._session.execute(
            select(StockMovementModel)
            .where(StockMovementModel.dealer_id == dealer_id)
            .order_by(StockMovementModel.recorded_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return [self._to_movement_entity(m) for m in result.scalars().all()]
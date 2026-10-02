"""
DealerRepository interface.
"""

from __future__ import annotations
from typing import Optional
from datetime import date

import uuid
from abc import ABC, abstractmethod

from app.domain.entities.dealer import Dealer, Product, DealerStock, DealerOrder, StockMovement
from app.domain.services.pricing import ResolvedPrice


class DealerRepository(ABC):
    @abstractmethod
    async def get_by_id(self, dealer_id: uuid.UUID) -> Optional[Dealer]: ...

    @abstractmethod
    async def get_by_phone(self, phone: str) -> Optional[Dealer]: ...

    @abstractmethod
    async def add(self, dealer: Dealer) -> Dealer: ...

    @abstractmethod
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
    ) -> list[Dealer]: ...

    @abstractmethod
    async def set_dealer_status(
        self, dealer_id: uuid.UUID, status: str, updated_by: Optional[uuid.UUID] = None
    ) -> Optional[Dealer]: ...

    # Product
    @abstractmethod
    async def get_product_by_id(self, product_id: uuid.UUID) -> Optional[Product]: ...

    @abstractmethod
    async def get_product_by_sku(self, sku_code: str) -> Optional[Product]: ...

    @abstractmethod
    async def add_product(self, product: Product) -> Product: ...

    @abstractmethod
    async def list_products(self) -> list[Product]: ...

    # Price tiers
    @abstractmethod
    async def resolve_price(
        self,
        product_id: uuid.UUID,
        quantity: int,
        dealer_id: Optional[uuid.UUID] = None,
    ) -> ResolvedPrice:
        """The unit price for ``quantity`` of ``product_id``, for this dealer.

        Precedence is documented in ``app.domain.services.pricing``: dealer
        tier, then general tier, then the product's list price.
        """
        ...

    @abstractmethod
    async def list_price_tiers(
        self,
        product_id: Optional[uuid.UUID] = None,
        dealer_id: Optional[uuid.UUID] = None,
        include_general: bool = True,
    ) -> list[dict]: ...

    @abstractmethod
    async def add_price_tier(self, tier: dict) -> dict: ...

    @abstractmethod
    async def update_price_tier(self, tier_id: uuid.UUID, changes: dict) -> Optional[dict]: ...

    @abstractmethod
    async def delete_price_tier(self, tier_id: uuid.UUID) -> bool: ...

    # Stocks
    @abstractmethod
    async def get_stock(self, dealer_id: uuid.UUID, product_id: uuid.UUID) -> Optional[DealerStock]: ...

    @abstractmethod
    async def update_stock(self, stock: DealerStock) -> DealerStock: ...

    @abstractmethod
    async def get_low_stock_alerts(self, dealer_id: Optional[uuid.UUID] = None) -> list[DealerStock]: ...

    # Orders
    @abstractmethod
    async def get_order_by_id(self, order_id: uuid.UUID) -> Optional[DealerOrder]: ...

    @abstractmethod
    async def add_order(self, order: DealerOrder) -> DealerOrder: ...

    @abstractmethod
    async def update_order(self, order: DealerOrder) -> DealerOrder: ...

    @abstractmethod
    async def list_orders(self, *, dealer_id: Optional[uuid.UUID] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[DealerOrder]: ...

    # Stock Movements
    @abstractmethod
    async def record_movement(self, movement: StockMovement) -> StockMovement: ...

    @abstractmethod
    async def list_movements(self, dealer_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[StockMovement]: ...
"""
ORM models for the Targets, KPI & Incentive module.

Tables are created by migration 202611030001. Money is BIGINT paise and
percentages are 4-place decimals (1.0000 = 100%). Only the calculation
engine (phase 2) writes snapshots; only the statement use cases write
incentive_statement.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.session import Base


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class KpiItemModel(Base):
    __tablename__ = "kpi_item"
    id: Mapped[uuid.UUID] = _pk()
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    simple_name: Mapped[str] = mapped_column(String(80), nullable=False)
    help_text: Mapped[Optional[str]] = mapped_column(String(300))
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class KpiWeightSetModel(Base):
    __tablename__ = "kpi_weight_set"
    id: Mapped[uuid.UUID] = _pk()
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kpi_item.id", ondelete="CASCADE"), nullable=False)
    weight: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    cap_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=Decimal("1.2"))
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IncentiveRuleSetModel(Base):
    __tablename__ = "incentive_rule_set"
    id: Mapped[uuid.UUID] = _pk()
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    sales_min_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    sales_rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    coll_min_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    coll_rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    entry_min_sales_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=Decimal("0.8"))
    level_gap: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GradeBandModel(Base):
    __tablename__ = "grade_band"
    id: Mapped[uuid.UUID] = _pk()
    grade: Mapped[str] = mapped_column(String(2), nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    min_score: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KpiPeriodModel(Base):
    __tablename__ = "kpi_period"
    id: Mapped[uuid.UUID] = _pk()
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MonthWeightModel(Base):
    __tablename__ = "month_weight"
    id: Mapped[uuid.UUID] = _pk()
    region_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("territories.id", ondelete="CASCADE"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    weight: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)


class GoalModel(Base):
    __tablename__ = "goal"
    id: Mapped[uuid.UUID] = _pk()
    officer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kpi_item.id", ondelete="CASCADE"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    set_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SalesFigureModel(Base):
    __tablename__ = "sales_figure"
    id: Mapped[uuid.UUID] = _pk()
    officer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    sales_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    collection_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")
    entered_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FocusProductPlanModel(Base):
    __tablename__ = "focus_product_plan"
    id: Mapped[uuid.UUID] = _pk()
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kpi_period.id", ondelete="CASCADE"), nullable=False)
    officer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    expected: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False, default="rupees")


class PerformanceSnapshotModel(Base):
    __tablename__ = "performance_snapshot"
    id: Mapped[uuid.UUID] = _pk()
    officer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kpi_period.id", ondelete="CASCADE"), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    items: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    score: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2))
    grade: Mapped[Optional[str]] = mapped_column(String(2))
    sales_level: Mapped[Optional[int]] = mapped_column(Integer)
    collection_level: Mapped[Optional[int]] = mapped_column(Integer)
    level_match_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sales_incentive_paise: Mapped[Optional[int]] = mapped_column(BigInteger)
    collection_incentive_paise: Mapped[Optional[int]] = mapped_column(BigInteger)
    final_incentive_paise: Mapped[Optional[int]] = mapped_column(BigInteger)
    waiting_for_figures: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rule_version: Mapped[Optional[date]] = mapped_column(Date)
    stage: Mapped[str] = mapped_column(String(10), nullable=False, default="live")
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IncentiveStatementModel(Base):
    __tablename__ = "incentive_statement"
    id: Mapped[uuid.UUID] = _pk()
    officer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    period_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kpi_period.id", ondelete="RESTRICT"), nullable=False)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    rule_version: Mapped[date] = mapped_column(Date, nullable=False)
    final_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="draft")
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    paid_on: Mapped[Optional[date]] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KpiAuditLogModel(Base):
    __tablename__ = "kpi_audit_log"
    id: Mapped[uuid.UUID] = _pk()
    entity: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    old: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    new: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    reason: Mapped[Optional[str]] = mapped_column(String(300))
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

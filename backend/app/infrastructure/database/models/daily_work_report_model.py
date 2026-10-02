from sqlalchemy import Column, String, Date, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime

from app.infrastructure.database.session import Base

class DailyWorkReportModel(Base):
    __tablename__ = "daily_work_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    report_date = Column(Date, nullable=False)
    summary = Column(Text, nullable=False)
    attachment_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "report_date", name="uq_daily_work_reports_user_date"),
    )

    # Relationships
    user = relationship("UserModel")

"""
Composition root / Dependency Injection container.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

# --- Domain Repositories ---
from app.domain.repositories.user_repository import UserRepository
from app.domain.repositories.attendance_repository import AttendanceRepository
from app.domain.repositories.gps_track_repository import GPSTrackRepository
from app.domain.repositories.weekly_plan_repository import WeeklyPlanRepository
from app.domain.repositories.visit_repository import VisitRepository
from app.domain.repositories.farmer_repository import FarmerRepository
from app.domain.repositories.dealer_repository import DealerRepository
from app.domain.repositories.crop_issue_repository import CropIssueRepository
from app.domain.repositories.notification_repository import NotificationRepository
from app.domain.repositories.expense_repository import ExpenseRepository
from app.domain.repositories.daily_work_report_repository import DailyWorkReportRepository


# --- Infrastructure Repositories ---
from app.infrastructure.repositories.sqlalchemy_user_repository import SQLAlchemyUserRepository
from app.infrastructure.repositories.sqlalchemy_attendance_repository import SQLAlchemyAttendanceRepository
from app.infrastructure.repositories.sqlalchemy_gps_track_repository import SQLAlchemyGPSTrackRepository
from app.infrastructure.repositories.sqlalchemy_weekly_plan_repository import SQLAlchemyWeeklyPlanRepository
from app.infrastructure.repositories.sqlalchemy_visit_repository import SQLAlchemyVisitRepository
from app.infrastructure.repositories.sqlalchemy_farmer_repository import SQLAlchemyFarmerRepository
from app.infrastructure.repositories.sqlalchemy_dealer_repository import SQLAlchemyDealerRepository
from app.infrastructure.repositories.sqlalchemy_crop_issue_repository import SQLAlchemyCropIssueRepository
from app.infrastructure.repositories.sqlalchemy_notification_repository import SQLAlchemyNotificationRepository
from app.infrastructure.repositories.sqlalchemy_expense_repository import SQLAlchemyExpenseRepository
from app.infrastructure.repositories.sqlalchemy_daily_work_report_repository import SqlAlchemyDailyWorkReportRepository


# --- Core Security & Tokens ---
from app.application.interfaces.password_hasher import PasswordHasher
from app.application.interfaces.token_service import TokenService
from app.infrastructure.security.bcrypt_password_hasher import BcryptPasswordHasher
from app.infrastructure.security.jwt_token_service import JWTTokenService
from app.infrastructure.websockets.connection_manager import ConnectionManager

# --- Use Cases ---
from app.application.use_cases.auth.register_user import RegisterUserUseCase
from app.application.use_cases.auth.login_user import LoginUserUseCase
from app.application.use_cases.auth.refresh_token import RefreshTokenUseCase
from app.application.use_cases.auth.get_current_user import GetCurrentUserUseCase
from app.application.use_cases.attendance_use_case import AttendanceUseCase
from app.application.use_cases.planning_use_case import PlanningUseCase
from app.application.use_cases.visit_use_case import VisitUseCase
from app.application.use_cases.farmer_use_case import FarmerUseCase
from app.application.use_cases.dealer_use_case import DealerUseCase
from app.application.use_cases.crop_issue_use_case import CropIssueUseCase
from app.application.use_cases.report_use_case import ReportUseCase
from app.application.services.activity_aggregation_service import ActivityAggregationService

from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.config.settings import Settings, get_settings
from app.infrastructure.database.session import get_db_session

# --- Session Dependency ---
DbSession = Annotated[AsyncSession, Depends(get_db_session)]

# --- Repository Factories ---
def get_user_repository(session: DbSession) -> UserRepository:
    return SQLAlchemyUserRepository(session)

def get_attendance_repository(session: DbSession) -> AttendanceRepository:
    return SQLAlchemyAttendanceRepository(session)

def get_gps_track_repository(session: DbSession) -> GPSTrackRepository:
    return SQLAlchemyGPSTrackRepository(session)

def get_weekly_plan_repository(session: DbSession) -> WeeklyPlanRepository:
    return SQLAlchemyWeeklyPlanRepository(session)

def get_visit_repository(session: DbSession) -> VisitRepository:
    return SQLAlchemyVisitRepository(session)

def get_farmer_repository(session: DbSession) -> FarmerRepository:
    return SQLAlchemyFarmerRepository(session)

def get_dealer_repository(session: DbSession) -> DealerRepository:
    return SQLAlchemyDealerRepository(session)

def get_crop_issue_repository(session: DbSession) -> CropIssueRepository:
    return SQLAlchemyCropIssueRepository(session)

def get_notification_repository(session: DbSession) -> NotificationRepository:
    return SQLAlchemyNotificationRepository(session)

def get_expense_repository(session: DbSession) -> ExpenseRepository:
    return SQLAlchemyExpenseRepository(session)

def get_daily_work_report_repository(session: DbSession) -> DailyWorkReportRepository:
    return SqlAlchemyDailyWorkReportRepository(session)



# --- Service Singletons ---
def get_password_hasher() -> PasswordHasher:
    return BcryptPasswordHasher()

async def get_redis() -> Redis:
    return get_redis_client()

async def get_token_service(
    settings: Annotated[Settings, Depends(get_settings)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> TokenService:
    return JWTTokenService(settings=settings, redis=redis)

# --- Annotated Repositories for Use Cases ---
UserRepoDep = Annotated[UserRepository, Depends(get_user_repository)]
AttendanceRepoDep = Annotated[AttendanceRepository, Depends(get_attendance_repository)]
GPSTrackRepoDep = Annotated[GPSTrackRepository, Depends(get_gps_track_repository)]
WeeklyPlanRepoDep = Annotated[WeeklyPlanRepository, Depends(get_weekly_plan_repository)]
VisitRepoDep = Annotated[VisitRepository, Depends(get_visit_repository)]
FarmerRepoDep = Annotated[FarmerRepository, Depends(get_farmer_repository)]
DealerRepoDep = Annotated[DealerRepository, Depends(get_dealer_repository)]
CropIssueRepoDep = Annotated[CropIssueRepository, Depends(get_crop_issue_repository)]
NotificationRepoDep = Annotated[NotificationRepository, Depends(get_notification_repository)]
ExpenseRepoDep = Annotated[ExpenseRepository, Depends(get_expense_repository)]
DailyWorkReportRepoDep = Annotated[DailyWorkReportRepository, Depends(get_daily_work_report_repository)]


PasswordHasherDep = Annotated[PasswordHasher, Depends(get_password_hasher)]
TokenServiceDep = Annotated[TokenService, Depends(get_token_service)]

# --- Use Case Factories ---
def get_register_user_use_case(
    user_repository: UserRepoDep,
    password_hasher: PasswordHasherDep,
) -> RegisterUserUseCase:
    return RegisterUserUseCase(user_repository, password_hasher)

def get_login_user_use_case(
    user_repository: UserRepoDep,
    password_hasher: PasswordHasherDep,
    token_service: TokenServiceDep,
    notification_repository: NotificationRepository = Depends(get_notification_repository),
) -> LoginUserUseCase:
    return LoginUserUseCase(user_repository, password_hasher, token_service, notification_repository)

def get_refresh_token_use_case(token_service: TokenServiceDep) -> RefreshTokenUseCase:
    return RefreshTokenUseCase(token_service)

def get_current_user_use_case(
    user_repository: UserRepoDep,
    token_service: TokenServiceDep,
) -> GetCurrentUserUseCase:
    return GetCurrentUserUseCase(user_repository, token_service)

def get_attendance_use_case(
    attendance_repository: AttendanceRepoDep,
    user_repository: UserRepoDep,
) -> AttendanceUseCase:
    return AttendanceUseCase(attendance_repository, user_repository)

def get_planning_use_case(
    weekly_plan_repository: WeeklyPlanRepoDep,
) -> PlanningUseCase:
    return PlanningUseCase(weekly_plan_repository)

def get_visit_use_case(
    visit_repository: VisitRepoDep,
) -> VisitUseCase:
    return VisitUseCase(visit_repository)

def get_farmer_use_case(
    farmer_repository: FarmerRepoDep,
) -> FarmerUseCase:
    return FarmerUseCase(farmer_repository)

def get_dealer_use_case(
    dealer_repository: DealerRepoDep,
) -> DealerUseCase:
    return DealerUseCase(dealer_repository)

def get_crop_issue_use_case(
    crop_issue_repository: CropIssueRepoDep,
) -> CropIssueUseCase:
    return CropIssueUseCase(crop_issue_repository)

def get_report_use_case(
    attendance_repository: AttendanceRepoDep,
    visit_repository: VisitRepoDep,
    farmer_repository: FarmerRepoDep,
) -> ReportUseCase:
    return ReportUseCase(attendance_repository, visit_repository, farmer_repository)

def get_activity_aggregation_service(session: DbSession) -> ActivityAggregationService:
    return ActivityAggregationService(session)

_websocket_manager = ConnectionManager()

def get_websocket_manager() -> ConnectionManager:
    return _websocket_manager

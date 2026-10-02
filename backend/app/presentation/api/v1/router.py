"""
Aggregates all v1 routers under a single APIRouter.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.presentation.api.v1.routers.auth_router import router as auth_router
from app.presentation.api.v1.routers.attendance_router import router as attendance_router
from app.presentation.api.v1.routers.consent_router import router as consent_router
from app.presentation.api.v1.routers.location_router import router as location_router
from app.presentation.api.v1.routers.location_ws_router import router as location_ws_router
from app.presentation.api.v1.routers.planning_router import router as planning_router
from app.presentation.api.v1.routers.visit_router import router as visit_router
from app.presentation.api.v1.routers.farmer_router import router as farmer_router
from app.presentation.api.v1.routers.dealer_router import router as dealer_router
from app.presentation.api.v1.routers.crop_issue_router import router as crop_issue_router
from app.presentation.api.v1.routers.report_router import router as report_router
from app.presentation.api.v1.routers.daily_report_router import router as daily_report_router
from app.presentation.api.v1.routers.health_router import router as health_router
from app.presentation.api.v1.routers.user_management_router import router as user_management_router
from app.presentation.api.v1.routers.notification_router import router as notification_router
from app.presentation.api.v1.routers.task_router import router as task_router
from app.presentation.api.v1.routers.productivity_router import router as productivity_router
from app.presentation.api.v1.routers.leave_router import router as leave_router
from app.presentation.api.v1.routers.hr_policy_router import router as hr_policy_router
from app.presentation.api.v1.routers.enquiry_router import router as enquiry_router
from app.presentation.api.v1.routers.day_closure_router import router as day_closure_router
from app.presentation.api.v1.routers.day_closure_config_router import router as day_closure_config_router
from app.presentation.api.v1.routers.custom_field_router import router as custom_field_router
from app.presentation.api.v1.routers.enum_option_router import router as enum_option_router
from app.presentation.api.v1.routers.knowledge_router import router as knowledge_router
from app.presentation.api.v1.routers.momentum_router import router as momentum_router
from app.presentation.api.v1.routers.management_router import router as management_router
from app.presentation.api.v1.routers.admin_router import router as admin_router
from app.presentation.api.v1.routers.holiday_router import router as holiday_router
from app.presentation.api.v1.routers.master_data_router import router as master_data_router
from app.presentation.api.v1.routers.daily_visit_tracker_router import router as daily_visit_tracker_router
from app.presentation.api.v1.routers.admin_daily_visit_router import router as admin_daily_visit_router
from app.presentation.api.v1.routers.dealer_payment_router import router as dealer_payment_router
from app.presentation.api.v1.routers.stock_router import router as stock_router
from app.presentation.api.v1.websocket_router import router as websocket_router

api_v1_router = APIRouter()
api_v1_router.include_router(health_router)
api_v1_router.include_router(auth_router)
api_v1_router.include_router(attendance_router)
api_v1_router.include_router(consent_router)
api_v1_router.include_router(location_router)
api_v1_router.include_router(location_ws_router)
api_v1_router.include_router(planning_router)
api_v1_router.include_router(visit_router)
api_v1_router.include_router(farmer_router)
api_v1_router.include_router(dealer_router)
api_v1_router.include_router(crop_issue_router)
api_v1_router.include_router(report_router)
api_v1_router.include_router(daily_report_router)
api_v1_router.include_router(user_management_router)
api_v1_router.include_router(notification_router)
api_v1_router.include_router(task_router)
api_v1_router.include_router(productivity_router)
api_v1_router.include_router(leave_router)
api_v1_router.include_router(hr_policy_router)
api_v1_router.include_router(enquiry_router)
api_v1_router.include_router(day_closure_router)
api_v1_router.include_router(day_closure_config_router)
api_v1_router.include_router(custom_field_router)
api_v1_router.include_router(enum_option_router)
api_v1_router.include_router(knowledge_router)
api_v1_router.include_router(management_router)
api_v1_router.include_router(momentum_router)
api_v1_router.include_router(admin_router)
api_v1_router.include_router(holiday_router)
api_v1_router.include_router(master_data_router)
api_v1_router.include_router(daily_visit_tracker_router)
api_v1_router.include_router(admin_daily_visit_router)
api_v1_router.include_router(dealer_payment_router)
api_v1_router.include_router(stock_router)
api_v1_router.include_router(websocket_router)

"""
LoginUser use case.
"""

from __future__ import annotations
from typing import Optional
from datetime import datetime, timezone

import logging
import re

from app.application.dto.auth_dto import LoginInput, LoginOutput
from app.domain.entities.notification import Notification
from app.domain.repositories.notification_repository import NotificationRepository
from app.application.interfaces.password_hasher import PasswordHasher
from app.application.interfaces.token_service import TokenService
from app.application.services.login_issue_service import report_login_issue
from app.domain.exceptions.domain_exceptions import (
    InactiveAccountException,
    InvalidCredentialsException,
    LoginIssueException,
)
from app.domain.repositories.user_repository import UserRepository
from app.domain.value_objects.email import Email

logger = logging.getLogger(__name__)


class LoginUserUseCase:
    def __init__(
        self,
        user_repository: UserRepository,
        password_hasher: PasswordHasher,
        token_service: TokenService,
        notification_repository: Optional[NotificationRepository] = None,
    ) -> None:
        self._user_repository = user_repository
        self._password_hasher = password_hasher
        self._token_service = token_service
        self._notification_repository = notification_repository

    async def execute(self, data: LoginInput) -> LoginOutput:
        # BUG FIX: the mobile app's single "Employee ID or Email" field
        # always posts whatever was typed as `employee_id` - it never
        # populates `email`, even when the text is clearly an email
        # address. This use case previously looked up ONLY by employee_id
        # whenever that field was non-empty, so any mobile login using an
        # email address failed with "invalid credentials" for any account
        # whose employee_id column is null. An employee_id containing "@"
        # is unambiguously not a real employee ID, so it is treated as an
        # email instead.
        user = None
        if data.employee_id and "@" in data.employee_id:
            try:
                email = Email(data.employee_id)
                user = await self._user_repository.get_by_email(email)
            except ValueError:
                user = await self._user_repository.get_by_employee_id(data.employee_id)
        elif data.employee_id:
            user = await self._user_repository.get_by_employee_id(data.employee_id)
            if user is None:
                # Not an Employee ID - the sign-in box also takes the
                # account's mobile number. Only an unambiguous match
                # (exactly one account) signs in.
                phone = re.sub(r"[\s\-()]", "", data.employee_id)
                if re.fullmatch(r"\+?[0-9]{7,15}", phone):
                    matches = await self._user_repository.find_by_phone(phone)
                    if len(matches) == 1:
                        user = matches[0]
        elif data.email:
            try:
                email = Email(data.email)
                user = await self._user_repository.get_by_email(email)
            except ValueError:
                pass

        if user is None or not self._password_hasher.verify(
            data.password, user.hashed_password
        ):
            logger.warning(
                "login_failed",
                extra={"email": data.email, "employee_id": data.employee_id},
            )
            if user is not None:
                from zoneinfo import ZoneInfo
                from app.infrastructure.database.session import AsyncSessionLocal
                from sqlalchemy import text

                now = datetime.now(timezone.utc)
                ist = ZoneInfo("Asia/Kolkata")
                now_ist = now.astimezone(ist).date()
                last_failed_ist = (
                    user.last_failed_login_at.astimezone(ist).date()
                    if user.last_failed_login_at
                    else None
                )

                if last_failed_ist == now_ist:
                    user.failed_logins += 1
                else:
                    user.failed_logins = 1
                user.last_failed_login_at = now

                # Update in an isolated session so rollback on 401 doesn't discard it
                async with AsyncSessionLocal() as isolated_session:
                    await isolated_session.execute(
                        text(
                            "UPDATE users SET failed_logins = :fl, last_failed_login_at = :now WHERE id = :uid"
                        ),
                        {"fl": user.failed_logins, "now": now, "uid": user.id},
                    )
                    await isolated_session.commit()
            raise InvalidCredentialsException()

        if user.is_deleted:
            raise InvalidCredentialsException()

        if not user.is_active:
            # The password was right, so tell the admins - they may want to
            # switch the account back on. The officer still gets the same
            # 'deactivated' answer as before.
            try:
                await report_login_issue(
                    user_id=user.id, full_name=user.full_name, employee_id=user.employee_id,
                    issue_type="account_inactive", attempted_device_id=data.device_id,
                    device_name=data.device_name, bound_device_id=user.device_id,
                    description="Tried to sign in while the account is deactivated.",
                    ip_address=data.ip_address,
                )
            except Exception:
                logger.error("Could not record inactive-account login issue", exc_info=True)
            raise InactiveAccountException()

        # Handle device binding
        if data.device_id:
            if user.device_id is None:
                # First login binds device ID
                user.bind_device(data.device_id)
                await self._user_repository.update(user)
            elif user.device_id != data.device_id:
                # Single-device rule: hold the sign-in and ask the admin.
                logger.warning(
                    "device_binding_mismatch",
                    extra={"user_id": str(user.id), "expected": user.device_id, "actual": data.device_id},
                )
                issue = await report_login_issue(
                    user_id=user.id, full_name=user.full_name, employee_id=user.employee_id,
                    issue_type="device_mismatch", attempted_device_id=data.device_id,
                    device_name=data.device_name, bound_device_id=user.device_id,
                    description="Signed in from a phone other than the registered one.",
                    ip_address=data.ip_address,
                )
                short = issue["id"][:8].upper()
                if issue["status"] == "rejected":
                    note = f" Reason: {issue['note']}" if issue.get("note") else ""
                    raise LoginIssueException(
                        f"Your admin declined the request to use this phone.{note} Please contact your admin.",
                        code="device_approval_rejected", issue_id=issue["id"], status="rejected",
                    )
                raise LoginIssueException(
                    "This account is registered to another phone. Your request to use this phone has been "
                    f"sent to the admin (ref {short}). Try signing in again once they approve it.",
                    code="device_approval_pending", issue_id=issue["id"], status="pending",
                )

        token_pair = await self._token_service.issue_token_pair(
            user.id, user.role.value
        )

        logger.info("login_succeeded", extra={"user_id": str(user.id)})

        user.last_login_at = datetime.now(timezone.utc)
        # A successful sign-in clears 'pending_review' / 'blocked'.
        user.login_status = "active"
        await self._user_repository.update(user)

        if self._notification_repository and user.role.value != "admin":
            try:
                all_users = await self._user_repository.list_all(limit=200)
                for u in all_users:
                    if u.role.value == "admin":
                        notif = Notification(
                            user_id=u.id,
                            title="Officer Logged In & Activity Updated",
                            message=f"Officer {user.full_name} ({user.employee_id or user.email}) logged in. Activity has been updated.",
                            type="broadcast",
                        )
                        await self._notification_repository.add(notif)
            except Exception:
                logger.error(
                    "Failed to generate login notification for admins", exc_info=True
                )

        return LoginOutput(
            access_token=token_pair.access_token,
            refresh_token=token_pair.refresh_token,
            token_type=token_pair.token_type,
            expires_in=token_pair.expires_in,
        )

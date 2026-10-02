"""
Authenticated file access.

Previously served via a plain StaticFiles mount at /static - no
authentication at all, so anyone with (or guessing) a UUID filename could
view any uploaded file, regardless of role or whether they were even a
logged-in user of this app. Replaced with this route, gated by:

- A valid access token, passed as ?token=... rather than an Authorization
  header. Browsers can't attach custom headers to <img src="..."> or
  <a href="..."> tags, which is how these files actually get rendered in
  the dashboard (proof photos, enquiry attachments) - so a header-only
  check would silently break the exact UI this exists to protect.
  Matches the identical tradeoff already made for /ws/locations and
  /ws/alerts in this codebase (both take ?token=...), not a new pattern
  introduced here.

- Role-based ownership, backed by the file_uploads table: admin/manager
  can view any file; anyone else can only view a file they uploaded
  themselves. A file with no file_uploads row (uploaded before this
  table existed, or any write that somehow bypassed save_upload) fails
  safe to admin/manager-only - not "deny everyone" and not "allow
  everyone" for an unrecorded owner, since guessing either way is wrong.

NOTE on the token-in-URL tradeoff, stated plainly rather than glossed
over: this reuses the same long-lived access token used for API auth,
which can leak via browser history, server access logs, or a Referer
header if the file URL is ever embedded cross-origin - genuinely worse
than a short-lived, purpose-specific token would be. This is a
deliberate stepping stone, not the intended end state. Pairing this with
an S3 migration (flagged separately) would replace this whole mechanism
with short-lived, signed S3 URLs, solving the token-lifetime problem and
the horizontal-scaling problem (local disk only being visible to
whichever backend replica wrote it) at the same time, rather than
solving them separately.
"""

from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.container import get_redis
from app.domain.exceptions.domain_exceptions import InvalidTokenException
from app.infrastructure.config.settings import Settings, get_settings
from app.infrastructure.database.session import get_db_session
from app.infrastructure.security.jwt_token_service import JWTTokenService
from app.infrastructure.storage.local_file_storage import UPLOAD_DIR, get_file_owner

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{filename}")
async def get_file(
    filename: str,
    token: str,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> FileResponse:
    settings: Settings = get_settings()
    token_service = JWTTokenService(settings=settings, redis=redis)
    try:
        claims = await token_service.decode_access_token(token)
    except InvalidTokenException:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")

    is_privileged = claims.role in ("admin", "manager")
    if not is_privileged:
        owner_id = await get_file_owner(filename, session)
        if owner_id is None or owner_id != claims.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this file.")

    # Defense in depth: even though a non-privileged caller only ever
    # reaches this line after filename matched a real file_uploads row,
    # strip any directory components before touching disk so a crafted
    # filename (e.g. "../../etc/passwd") can never escape UPLOAD_DIR,
    # regardless of the auth check above.
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")

    return FileResponse(file_path)

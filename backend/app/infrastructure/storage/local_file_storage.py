"""
Local-disk file storage for uploads (crop issue photos, task-review proof
photos, day-closure documents, enquiry images, daily-report attachments).

Previously duplicated byte-for-byte across 4 routers (crop_issue,
daily_report, day_closure, enquiry) - same disk write, same UUID filename,
no ownership tracking at all. Centralized here while adding uploaded_by
tracking, since touching all 4 call sites to add near-identical tracking
logic was the natural moment to also stop the duplication (this exact
"same code copied N times, quietly drifts" pattern has caused real bugs
elsewhere in this codebase before - duplicate CHECK constraints going out
of sync, two independent GPS-tracking implementations before they were
consolidated, etc.).

Deliberately kept as a thin, swappable seam: save_upload()'s return value
is just a URL, nothing disk-specific leaks to callers. A future S3
migration (flagged separately, alongside signed/expiring URLs replacing
the token-in-query-param approach the /files route uses) should be able
to replace this module's internals without any of the 4 router call
sites changing at all.
"""

from __future__ import annotations

import os
import shutil
import uuid
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config.settings import get_settings

UPLOAD_DIR = "uploads"


async def save_upload(file: UploadFile, uploaded_by: uuid.UUID, session: AsyncSession) -> str:
    """Writes the file to local disk under a random UUID filename, records
    who uploaded it, and returns the URL clients should use to fetch it
    back (the authenticated /files/{filename} route, not a raw path)."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_ext = os.path.splitext(file.filename or "")[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    await session.execute(
        text("INSERT INTO file_uploads (filename, uploaded_by) VALUES (:filename, :uploaded_by)"),
        {"filename": unique_filename, "uploaded_by": uploaded_by},
    )
    await session.commit()

    return f"{get_settings().public_backend_url}/files/{unique_filename}"


async def get_file_owner(filename: str, session: AsyncSession) -> Optional[uuid.UUID]:
    """None means either the file was never tracked (uploaded before this
    table existed) or the filename doesn't correspond to any upload at
    all - callers should treat both the same way: fail safe, not assume
    ownership either way."""
    result = await session.execute(
        text("SELECT uploaded_by FROM file_uploads WHERE filename = :filename"),
        {"filename": filename},
    )
    row = result.first()
    return row.uploaded_by if row else None

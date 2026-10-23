"""Speedometer photo + km, once at check-in and once at check-out.

Officers submit from the app or the web; admin/manager see, download one
photo or everything (ZIP + CSV). Rows and files are deleted after
settings.odometer_retention_days by the daily retention job.
"""
from __future__ import annotations

import csv
import io
import os
import uuid
import zipfile
from datetime import date, datetime, time as time_type, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.container import get_redis
from app.domain.exceptions.domain_exceptions import InvalidTokenException
from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.config.company_time import company_now, company_today, company_tz
from app.infrastructure.config.settings import get_settings
from app.infrastructure.database.session import get_db_session
from app.infrastructure.security.jwt_token_service import JWTTokenService
from app.infrastructure.storage.local_file_storage import UPLOAD_DIR
from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(prefix="/odometer", tags=["odometer"])

ODO_DIR = os.path.join(UPLOAD_DIR, "odometer")
MAX_BYTES = 10 * 1024 * 1024
OUT_CUTOFF = time_type(18, 0)  # check-out reading expected before 6 PM
MAX_KM = 9_999_999.0

_MAGIC = ((b"\xff\xd8\xff", ".jpg"), (b"\x89PNG\r\n\x1a\n", ".png"))


def _ext_for(head: bytes) -> Optional[str]:
    for magic, ext in _MAGIC:
        if head.startswith(magic):
            return ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


async def _today_attendance(session: AsyncSession, user_id: uuid.UUID):
    tz = company_tz()
    start = datetime.combine(company_today(), time_type.min, tzinfo=tz)
    row = (await session.execute(
        text("""SELECT id, check_in_time, check_out_time FROM attendance
                WHERE user_id = :u AND check_in_time >= :s AND check_in_time < :e
                ORDER BY check_in_time DESC LIMIT 1"""),
        {"u": user_id, "s": start, "e": start + timedelta(days=1)},
    )).first()
    return row


def _row(r) -> dict:
    return {
        "id": str(r.id), "kind": r.kind, "km": float(r.km), "is_late": r.is_late,
        "created_at": r.created_at.astimezone(company_tz()).isoformat(),
    }


@router.get("/today")
async def my_today(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]) -> dict:
    rows = (await session.execute(
        text("SELECT * FROM odometer_readings WHERE user_id = :u AND reading_date = :d"),
        {"u": current_user.user_id, "d": company_today()},
    )).all()
    out = {"required": bool(get_settings().odometer_required and current_user.role != "admin"),
           "check_in": None, "check_out": None}
    for r in rows:
        out[r.kind] = _row(r)
    return out


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit_reading(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    kind: Annotated[str, Form()],
    km: Annotated[float, Form()],
    file: Annotated[UploadFile, File()],
) -> dict:
    if kind not in ("check_in", "check_out"):
        raise HTTPException(status_code=422, detail="kind must be check_in or check_out.")
    if not (0 <= km <= MAX_KM):
        raise HTTPException(status_code=422, detail="Enter the km shown on the speedometer.")
    today = company_today()
    att = await _today_attendance(session, current_user.user_id)
    start_km = None
    if kind == "check_out":
        if not att:
            raise HTTPException(status_code=409, detail="Check in first, then submit the end-of-day reading.")
        if att.check_out_time is not None:
            raise HTTPException(status_code=409, detail="You have already checked out today.")
        s = (await session.execute(
            text("SELECT km FROM odometer_readings WHERE user_id = :u AND reading_date = :d AND kind = 'check_in'"),
            {"u": current_user.user_id, "d": today},
        )).first()
        start_km = float(s.km) if s else None
        if start_km is not None and km < start_km:
            raise HTTPException(
                status_code=422,
                detail=f"End km ({km:g}) cannot be less than this morning's reading ({start_km:g}).",
            )
    elif att and att.check_out_time is not None:
        raise HTTPException(status_code=409, detail="You have already checked out today.")

    exists = (await session.execute(
        text("SELECT 1 FROM odometer_readings WHERE user_id = :u AND reading_date = :d AND kind = :k"),
        {"u": current_user.user_id, "d": today, "k": kind},
    )).first()
    if exists:
        raise HTTPException(status_code=409, detail="Already submitted. Ask an admin if it needs correcting.")

    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Photo is too large (max 10 MB).")
    ext = _ext_for(data[:16])
    if not ext:
        raise HTTPException(status_code=422, detail="Please upload a JPEG or PNG photo.")

    name = f"{uuid.uuid4()}{ext}"

    def _write() -> None:
        os.makedirs(ODO_DIR, exist_ok=True)
        with open(os.path.join(ODO_DIR, name), "wb") as f:
            f.write(data)

    await run_in_threadpool(_write)
    late = kind == "check_out" and company_now().time() > OUT_CUTOFF
    row = (await session.execute(
        text("""INSERT INTO odometer_readings (user_id, attendance_id, reading_date, kind, km, filename, is_late)
                VALUES (:u, :a, :d, :k, :km, :f, :l) RETURNING *"""),
        {"u": current_user.user_id, "a": att.id if att else None, "d": today, "k": kind,
         "km": round(km, 1), "f": name, "l": late},
    )).one()
    await session.commit()
    return _row(row)


async def _token_claims(token: str, redis: Redis):
    try:
        return await JWTTokenService(settings=get_settings(), redis=redis).decode_access_token(token)
    except InvalidTokenException:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


@router.get("")
async def list_readings(
    _u: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user_id: Optional[uuid.UUID] = None,
) -> list[dict]:
    return await _daily_rows(session, date_from, date_to, user_id)


async def _daily_rows(session, date_from, date_to, user_id) -> list[dict]:
    today = company_today()
    date_to = date_to or today
    date_from = date_from or (date_to - timedelta(days=6))
    q = """SELECT o.*, u.full_name, u.employee_id FROM odometer_readings o
           JOIN users u ON u.id = o.user_id
           WHERE o.reading_date BETWEEN :a AND :b"""
    params: dict = {"a": date_from, "b": date_to}
    if user_id:
        q += " AND o.user_id = :u"
        params["u"] = user_id
    q += " ORDER BY o.reading_date DESC, u.full_name, o.kind"
    rows = (await session.execute(text(q), params)).all()
    days: dict = {}
    for r in rows:
        d = days.setdefault((r.reading_date, r.user_id), {
            "date": r.reading_date.isoformat(), "user_id": str(r.user_id),
            "officer_name": r.full_name, "employee_id": r.employee_id,
            "check_in": None, "check_out": None, "distance_km": None,
        })
        d[r.kind] = _row(r)
        # Who uploaded = the officer themself (only they can submit).
        d[r.kind]["uploaded_by"] = r.full_name
    for d in days.values():
        if d["check_in"] and d["check_out"]:
            d["distance_km"] = round(d["check_out"]["km"] - d["check_in"]["km"], 1)
    return list(days.values())


@router.get("/{reading_id}/photo")
async def reading_photo(
    reading_id: uuid.UUID,
    token: str,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    redis: Annotated[Redis, Depends(get_redis)],
    download: bool = False,
):
    claims = await _token_claims(token, redis)
    r = (await session.execute(
        text("""SELECT o.*, u.full_name FROM odometer_readings o JOIN users u ON u.id = o.user_id
                WHERE o.id = :i"""), {"i": reading_id},
    )).first()
    if not r:
        raise HTTPException(status_code=404, detail="Photo not found.")
    if claims.role not in ("admin", "manager") and claims.user_id != r.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this photo.")
    path = os.path.join(ODO_DIR, os.path.basename(r.filename))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Photo file is no longer available.")
    if not download:
        return FileResponse(path)
    nice = f"{r.reading_date}_{_slug(r.full_name)}_{r.kind}_{r.km:g}km{os.path.splitext(r.filename)[1]}"
    return FileResponse(path, filename=nice)


def _slug(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in s).strip("_") or "officer"


@router.get("/download/all.zip")
async def download_all(
    token: str,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    redis: Annotated[Redis, Depends(get_redis)],
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user_id: Optional[uuid.UUID] = None,
):
    claims = await _token_claims(token, redis)
    if claims.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized.")
    date_to = date_to or company_today()
    date_from = date_from or (date_to - timedelta(days=6))
    q = """SELECT o.*, u.full_name, u.employee_id FROM odometer_readings o
           JOIN users u ON u.id = o.user_id WHERE o.reading_date BETWEEN :a AND :b"""
    params: dict = {"a": date_from, "b": date_to}
    if user_id:
        q += " AND o.user_id = :u"
        params["u"] = user_id
    rows = (await session.execute(text(q + " ORDER BY o.reading_date, u.full_name, o.kind"), params)).all()

    def _build() -> bytes:
        buf = io.BytesIO()
        csv_buf = io.StringIO()
        w = csv.writer(csv_buf)
        w.writerow(["date", "time", "officer", "employee_id", "type", "km", "after_6pm", "file"])
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            for r in rows:
                ext = os.path.splitext(r.filename)[1]
                arc = f"{r.reading_date}_{_slug(r.full_name)}_{r.kind}_{r.km:g}km{ext}"
                p = os.path.join(ODO_DIR, os.path.basename(r.filename))
                if os.path.isfile(p):
                    z.write(p, arc)
                local = r.created_at.astimezone(company_tz())
                w.writerow([r.reading_date, local.strftime("%H:%M:%S"), r.full_name, r.employee_id, r.kind,
                            f"{r.km:g}", "yes" if r.is_late else "", arc])
            z.writestr("readings.csv", csv_buf.getvalue())
        return buf.getvalue()

    data = await run_in_threadpool(_build)
    await write_audit_log(session, user_id=claims.user_id, event_type="admin_odometer_download",
                          description=f"Downloaded {len(rows)} speedometer photos", context_data={"from": str(date_from), "to": str(date_to)})
    await session.commit()
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="speedometer_{date_from}_{date_to}.zip"'})


@router.delete("/{reading_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response, response_model=None)
async def delete_reading(
    reading_id: uuid.UUID,
    current_user: CurrentUser,
    _a: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    """Admin: remove a wrong reading so the officer can submit it again."""
    r = (await session.execute(
        text("DELETE FROM odometer_readings WHERE id = :i RETURNING filename, user_id, kind, reading_date"), {"i": reading_id}
    )).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reading not found.")
    await write_audit_log(session, user_id=current_user.user_id, event_type="admin_odometer_delete",
                          description=f"Removed {r.kind} speedometer reading for {r.reading_date}",
                          context_data={"officer_id": str(r.user_id)})
    await session.commit()
    try:
        os.remove(os.path.join(ODO_DIR, os.path.basename(r.filename)))
    except OSError:
        pass

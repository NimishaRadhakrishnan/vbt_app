"""
Nightly data-stage job (01:30 IST, after the 00:30 calculation run).

What it does, and what it never does:
- Daily snapshots older than the live window (default 60 days) are marked
  `archive`, then thinned to one per week. The last snapshot of every
  period is always kept, so past months, "My best" and charts stay correct.
  Frozen incentive statements hold their own copy of every input and are
  never touched.
- Photos older than the live window are shrunk to the archive width
  (default 1280 px). A photo from a trial that is still inside its
  conversion window stays full size. Nothing is deleted.
- No entry (visit, trial, order, closure, figure) is ever deleted here.
  The "years kept" setting is informational: the brief says nothing an
  incentive was calculated from is deleted.
"""

from __future__ import annotations

import logging
import os
from datetime import timedelta
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.repositories import kpi_data_repository as repo
from app.infrastructure.storage.local_file_storage import UPLOAD_DIR

log = logging.getLogger("kpi.stage")
IMAGE_EXT = {".jpg", ".jpeg", ".png"}


async def stage_snapshots(s: AsyncSession, live_days: int) -> dict:
    marked = (await s.execute(text(
        "UPDATE performance_snapshot SET stage = 'archive' "
        "WHERE stage = 'live' AND snapshot_date < current_date - make_interval(days => :d) RETURNING id"),
        {"d": live_days})).all()
    deleted = (await s.execute(text("""
        DELETE FROM performance_snapshot ps
        WHERE ps.stage = 'archive'
          AND ps.id NOT IN (SELECT DISTINCT ON (officer_id, period_id) id FROM performance_snapshot
                            ORDER BY officer_id, period_id, snapshot_date DESC)
          AND ps.id NOT IN (SELECT DISTINCT ON (officer_id, period_id, date_trunc('week', snapshot_date)) id
                            FROM performance_snapshot WHERE stage = 'archive'
                            ORDER BY officer_id, period_id, date_trunc('week', snapshot_date), snapshot_date DESC)
        RETURNING ps.id"""))).all()
    await s.commit()
    return {"snapshots_archived": len(marked), "snapshots_thinned": len(deleted)}


def _shrink(path: str, max_px: int) -> int:
    """Shrink one image in place. Returns bytes saved (0 when untouched)."""
    from PIL import Image, ImageOps

    before = os.path.getsize(path)
    with Image.open(path) as im:
        if im.width <= max_px:
            return 0
        fmt = (im.format or "JPEG").upper()
        im = ImageOps.exif_transpose(im)
        h = round(im.height * max_px / im.width)
        small = im.resize((max_px, h), Image.LANCZOS)
        tmp = path + ".tmp"
        if fmt == "PNG":
            small.save(tmp, "PNG", optimize=True)
        else:
            small.convert("RGB").save(tmp, "JPEG", quality=85, optimize=True)
    after = os.path.getsize(tmp)
    if after >= before:                       # never make a file bigger
        os.remove(tmp)
        return 0
    os.replace(tmp, path)
    return before - after


async def stage_photos(s: AsyncSession, live_days: int, max_px: int, window_days: int,
                       upload_dir: Optional[str] = None) -> dict:
    base = upload_dir or UPLOAD_DIR
    rows = (await s.execute(text("""
        SELECT f.filename FROM file_uploads f
        WHERE f.uploaded_at < now() - make_interval(days => :d)
          AND NOT EXISTS (
              SELECT 1 FROM visits v
              WHERE v.is_trial = true AND v.start_time > now() - make_interval(days => :w)
                AND (v.photo_url_farmer LIKE '%' || f.filename OR v.photo_url_farm LIKE '%' || f.filename))
    """), {"d": live_days, "w": window_days})).all()
    shrunk = saved = failed = 0
    for r in rows:
        name = os.path.basename(r.filename)
        if os.path.splitext(name)[1].lower() not in IMAGE_EXT:
            continue
        path = os.path.join(base, name)
        if not os.path.isfile(path):
            continue
        try:
            gain = _shrink(path, max_px)
        except Exception as e:  # noqa: BLE001 - one bad file must not stop the rest
            failed += 1
            log.warning("photo_shrink_failed file=%s error=%s", name, e)
            continue
        if gain:
            shrunk += 1
            saved += gain
    return {"photos_shrunk": shrunk, "photo_bytes_saved": saved, "photos_failed": failed}


async def run(s: AsyncSession, upload_dir: Optional[str] = None) -> dict:
    cfg = await repo.get_settings_map(s)
    live = int(cfg.get("kpi.live_days", 60))
    px = int(cfg.get("kpi.photo_archive_px", 1280))
    window = int(cfg.get("kpi.conversion_window_days", 60))
    out = {**(await stage_snapshots(s, live)), **(await stage_photos(s, live, px, window, upload_dir))}
    log.info("kpi_stage_done %s", out)
    return out

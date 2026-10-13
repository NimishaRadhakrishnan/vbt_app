"""GPS history retention: delete tracks older than settings.gps_retention_days.

Runs from the app's lifespan loop (see main.py) once a day, and can be run
by hand through scripts/gps_retention_job.py. Deleting in batches keeps each
transaction short so a large backlog never blocks live pings.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from app.infrastructure.config.settings import get_settings
from app.infrastructure.database.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

_BATCH = 10000


async def purge_old_gps(days: int | None = None) -> dict[str, int]:
    """Delete GPS tracks, stale last-known positions and old location alerts
    older than `days` (default: settings.gps_retention_days). Returns counts."""
    keep_days = days if days is not None else get_settings().gps_retention_days
    if keep_days < 1:
        raise ValueError("gps_retention_days must be at least 1")
    cutoff = datetime.now(UTC) - timedelta(days=keep_days)

    counts = {"gps_tracks": 0, "officer_locations": 0, "location_alerts": 0}
    statements = {
        "gps_tracks": """
            DELETE FROM gps_tracks WHERE id IN (
                SELECT id FROM gps_tracks WHERE recorded_at < :cutoff LIMIT :batch)
        """,
        "officer_locations": """
            DELETE FROM officer_locations WHERE officer_id IN (
                SELECT officer_id FROM officer_locations WHERE updated_at < :cutoff LIMIT :batch)
        """,
        "location_alerts": """
            DELETE FROM location_alerts WHERE id IN (
                SELECT id FROM location_alerts WHERE created_at < :cutoff LIMIT :batch)
        """,
    }
    for name, sql in statements.items():
        while True:
            async with AsyncSessionLocal() as session:
                result = await session.execute(text(sql), {"cutoff": cutoff, "batch": _BATCH})
                await session.commit()
            deleted = result.rowcount or 0
            counts[name] += deleted
            if deleted < _BATCH:
                break
    logger.info("gps_retention_done", extra={"cutoff": cutoff.isoformat(), **counts})
    return counts


async def purge_old_closures(days: int | None = None) -> dict[str, int]:
    """Delete day closures (sales and farm) older than `days` (default
    settings.closure_retention_days), with their stock rows, photos and
    custom answers. Photo files are removed from disk too."""
    import os

    from app.infrastructure.storage.local_file_storage import UPLOAD_DIR

    keep_days = days if days is not None else get_settings().closure_retention_days
    if keep_days < 1:
        raise ValueError("closure_retention_days must be at least 1")
    cutoff_day = (datetime.now(UTC) - timedelta(days=keep_days)).date()

    counts = {"day_closures": 0, "photos": 0}
    while True:
        async with AsyncSessionLocal() as session:
            ids = [r.id for r in (await session.execute(
                text("SELECT id FROM day_closures WHERE date < :d LIMIT :batch"),
                {"d": cutoff_day, "batch": 500},
            )).all()]
            if not ids:
                break
            urls = [r.image_url for r in (await session.execute(
                text("SELECT image_url FROM sales_closure_images WHERE closure_id = ANY(:ids)"),
                {"ids": ids},
            )).all()]
            await session.execute(
                text("DELETE FROM custom_field_answers WHERE record_id = ANY(:ids)"), {"ids": ids}
            )
            await session.execute(text("DELETE FROM day_closures WHERE id = ANY(:ids)"), {"ids": ids})
            names = []
            for url in urls:
                name = os.path.basename((url or "").split("?")[0])
                if name:
                    names.append(name)
            if names:
                await session.execute(
                    text("DELETE FROM file_uploads WHERE filename = ANY(:n)"), {"n": names}
                )
            await session.commit()
        for name in names:
            try:
                os.remove(os.path.join(UPLOAD_DIR, name))
                counts["photos"] += 1
            except OSError:
                pass
        counts["day_closures"] += len(ids)
    logger.info("closure_retention_done", extra={"cutoff": cutoff_day.isoformat(), **counts})
    return counts

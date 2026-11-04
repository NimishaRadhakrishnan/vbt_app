#!/usr/bin/env python3
"""Nightly data-stage job (01:30 IST): python scripts/kpi_stage_job.py"""
import asyncio
import logging
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.application.use_cases.kpi_storage import run  # noqa: E402
from app.infrastructure.database.session import AsyncSessionLocal  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("kpi.stage")


async def main() -> int:
    t0 = time.monotonic()
    log.info("kpi_stage_start")
    try:
        async with AsyncSessionLocal() as s:
            out = await run(s)
    except Exception:
        log.exception("kpi_stage_failed")
        return 1
    log.info("kpi_stage_end seconds=%.1f %s", time.monotonic() - t0, out)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

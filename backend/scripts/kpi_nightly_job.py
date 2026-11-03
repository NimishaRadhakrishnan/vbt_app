#!/usr/bin/env python3
"""Nightly full KPI recalculation (00:30 IST): python scripts/kpi_nightly_job.py

Recalculates every active field officer for the current month and quarter,
fixing anything the live queue missed. Logs start, end and errors. Closed
periods are never touched.
"""
import asyncio
import logging
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.application.use_cases.kpi_recalculate import recalculate_everyone  # noqa: E402
from app.infrastructure.database.session import AsyncSessionLocal  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("kpi.nightly")


async def main() -> int:
    t0 = time.monotonic()
    log.info("kpi_nightly_start")
    async with AsyncSessionLocal() as s:
        ok, failed = await recalculate_everyone(s)
    log.info("kpi_nightly_end officers_ok=%s officers_failed=%s seconds=%.1f", ok, failed, time.monotonic() - t0)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

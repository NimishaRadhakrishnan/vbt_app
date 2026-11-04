#!/usr/bin/env python3
"""Daily friendly goal reminders (09:30 IST): python scripts/kpi_nudge_job.py"""
import asyncio
import logging
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.application.use_cases.kpi_nudges import nudge_everyone  # noqa: E402
from app.infrastructure.database.session import AsyncSessionLocal  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("kpi.nudge")


async def main() -> int:
    t0 = time.monotonic()
    log.info("kpi_nudge_start")
    async with AsyncSessionLocal() as s:
        sent, failed = await nudge_everyone(s)
    log.info("kpi_nudge_end sent=%s failed=%s seconds=%.1f", sent, failed, time.monotonic() - t0)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

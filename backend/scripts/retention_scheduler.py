#!/usr/bin/env python3
import asyncio
import time
from datetime import datetime, timedelta, timezone
import subprocess
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("scheduler")

# (hour, minute) in UTC -> script. IST is UTC+5:30.
#   00:30 IST = 19:00 UTC  KPI nightly recalculation (before the retention run)
#   01:30 IST = 20:00 UTC  data stages (archive, thin snapshots, shrink old photos)
#   02:00 IST = 20:30 UTC  retention purge
#   09:30 IST = 04:00 UTC  friendly goal reminders (max 1 per officer per day)
JOBS = [
    (19, 0, "scripts/kpi_nightly_job.py"),
    (20, 0, "scripts/kpi_stage_job.py"),
    (20, 30, "scripts/gps_retention_job.py"),
    (4, 0, "scripts/kpi_nudge_job.py"),
]


def _next_run(now: datetime):
    best = None
    for hour, minute, script in JOBS:
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        if best is None or target < best[0]:
            best = (target, script)
    return best


async def schedule_loop():
    logger.info("Scheduler started: KPI recalculation 00:30 IST, data stages 01:30 IST, retention 02:00 IST, goal reminders 09:30 IST.")
    while True:
        target, script = _next_run(datetime.now(timezone.utc))
        sleep_seconds = (target - datetime.now(timezone.utc)).total_seconds()
        logger.info(f"Next run: {script} at {target.isoformat()} (in {sleep_seconds:.0f} seconds)")
        await asyncio.sleep(max(sleep_seconds, 0))

        logger.info(f"Time reached. Executing {script}...")
        try:
            subprocess.run(["python", script], check=True)
        except Exception as e:
            logger.error(f"Error running {script}: {e}")
        await asyncio.sleep(1)   # step past the minute so the same job is not picked twice


if __name__ == "__main__":
    asyncio.run(schedule_loop())

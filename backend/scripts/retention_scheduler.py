#!/usr/bin/env python3
import asyncio
import time
from datetime import datetime, timedelta, timezone
import subprocess
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("scheduler")

# 2 AM IST is 20:30 UTC
TARGET_HOUR_UTC = 20
TARGET_MINUTE_UTC = 30

async def schedule_loop():
    logger.info("Retention scheduler started. Will run daily at 02:00 IST (20:30 UTC).")
    while True:
        now = datetime.now(timezone.utc)
        target = now.replace(hour=TARGET_HOUR_UTC, minute=TARGET_MINUTE_UTC, second=0, microsecond=0)
        
        # If it's already past 20:30 UTC today, schedule for tomorrow
        if now >= target:
            target += timedelta(days=1)
            
        sleep_seconds = (target - now).total_seconds()
        logger.info(f"Next run scheduled at {target.isoformat()} (in {sleep_seconds:.0f} seconds)")
        
        await asyncio.sleep(sleep_seconds)
        
        logger.info("Time reached. Executing gps_retention_job.py...")
        try:
            subprocess.run(["python", "scripts/gps_retention_job.py"], check=True)
        except Exception as e:
            logger.error(f"Error running retention job: {e}")

if __name__ == "__main__":
    asyncio.run(schedule_loop())

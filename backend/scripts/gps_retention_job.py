#!/usr/bin/env python3
"""
GPS Data Retention Job

Officers affirmatively agree to a 12-month retention policy for their
location data. This job deletes any `gps_tracks` older than exactly 365 days.
Intended to be run via cron (e.g., daily at 2 AM).
"""

import sys
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import text, create_engine

# Try to import from app settings, otherwise read from ENV for standalone execution
import os
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from app.infrastructure.config.settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("gps_retention")

def main():
    settings = get_settings()
    engine = create_engine(str(settings.database_url).replace("+asyncpg", "+psycopg2"))
    
    # 12 months ago (~365 days)
    cutoff = datetime.now(timezone.utc) - timedelta(days=365)
    
    logger.info(f"Starting GPS retention job. Cutoff date: {cutoff.isoformat()}")
    
    total_tracks_deleted = 0
    total_locations_deleted = 0
    
    while True:
        with engine.begin() as conn:
            result_tracks = conn.execute(
                text("""
                    DELETE FROM gps_tracks 
                    WHERE id IN (
                        SELECT id FROM gps_tracks 
                        WHERE recorded_at < :cutoff 
                        LIMIT 10000
                    )
                """),
                {"cutoff": cutoff}
            )
            deleted = result_tracks.rowcount
            total_tracks_deleted += deleted
            
        if deleted == 0:
            break
            
    while True:
        with engine.begin() as conn:
            result_latest = conn.execute(
                text("""
                    DELETE FROM officer_locations 
                    WHERE officer_id IN (
                        SELECT officer_id FROM officer_locations 
                        WHERE updated_at < :cutoff 
                        LIMIT 10000
                    )
                """),
                {"cutoff": cutoff}
            )
            deleted = result_latest.rowcount
            total_locations_deleted += deleted
            
        if deleted == 0:
            break

    logger.info(f"Deleted {total_tracks_deleted} stale GPS points from gps_tracks.")
    if total_locations_deleted > 0:
        logger.info(f"Deleted {total_locations_deleted} stale last-known positions from officer_locations.")
        
    logger.info("GPS retention job completed.")

if __name__ == "__main__":
    main()

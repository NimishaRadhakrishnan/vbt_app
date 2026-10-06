#!/usr/bin/env python3
"""Run the GPS retention purge by hand: python scripts/gps_retention_job.py

The API process already runs this once a day on its own; this script is for
an immediate or one-off clean-up. The period comes from the GPS_RETENTION_DAYS
setting (90 by default), the same value the officer disclosure states.
"""
import asyncio
import logging
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.application.services.gps_retention import purge_old_gps  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

if __name__ == "__main__":
    print(asyncio.run(purge_old_gps()))

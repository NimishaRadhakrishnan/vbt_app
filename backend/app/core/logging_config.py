"""
Structured logging configuration.

Emits JSON log lines (one per event) instead of free-text, so logs are
directly queryable in CloudWatch/ELK/Loki without a parsing step. Every
request gets a request_id (set in the logging middleware) that is included
on every log line for that request, which is what makes tracing a single
request's full path through the system possible once more modules exist.
This is also the foundation the Audit Logging module (a later phase) will
build on for tamper-evident, queryable security event records.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import timezone, datetime

from app.infrastructure.config.settings import get_settings

_RESERVED_LOG_RECORD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "taskName",
}


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED_LOG_RECORD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(settings.log_level)

    # Quiet down noisy third-party loggers unless we're debugging.
    for noisy_logger in ("sqlalchemy.engine", "uvicorn.access"):
        logging.getLogger(noisy_logger).setLevel(
            logging.INFO if settings.debug else logging.WARNING
        )

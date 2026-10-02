from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.infrastructure.config.settings import get_settings
from app.infrastructure.database.models import (
    user_model,  # noqa: F401
    attendance_model,  # noqa: F401
    crop_issue_model,  # noqa: F401
    daily_work_report_model,  # noqa: F401
    dealer_model,  # noqa: F401
    expense_model,  # noqa: F401
    farmer_model,  # noqa: F401
    gps_track_model,  # noqa: F401
    notification_model,  # noqa: F401
    territory_model,  # noqa: F401
    visit_model,  # noqa: F401
    weekly_plan_model,  # noqa: F401
)

# Import Base and every model module so `target_metadata` is complete for
# autogenerate. Previously this imported connection_model, mcp_server_model,
# tool_capability_model, risk_finding_model, policy_model,
# governance_recommendation_model, risk_card_model, alert_model, and
# audit_log_model - all part of the "MCP Server Risk Scanner" scaffold
# that was deleted from app/infrastructure/database/models/ during an
# earlier cleanup pass, but this file's imports were never updated to
# match. That meant `alembic upgrade head` (and any other Alembic command
# that loads env.py, which is most of them) crashed with an ImportError
# on a fresh checkout - including the `alembic upgrade head` step in
# start.sh, which runs on every container startup. Tasks/leave/HR
# policy/enquiry/day closure/momentum tables intentionally have no ORM
# model here (those modules are raw-SQL, per the architecture notes) so
# they're correctly absent from this list, not missing by oversight.
from app.infrastructure.database.session import Base

config = context.config
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url_sync)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

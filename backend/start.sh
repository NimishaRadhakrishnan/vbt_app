#!/bin/sh
# Run pending DB migrations, then start the API server.
# Using a script file (instead of a "sh -c '...&&...'" command typed into a
# host's dashboard) avoids quoting/parsing issues some platforms have with
# shell operators in a single command-line field.
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting server..."

# WORKERS
# -------
# One worker leaves half of a 2-core box idle. Measured on 2 vCPU / 8 GB
# (a Hostinger KVM 2), a second worker raised the heaviest endpoint from
# ~52 to ~80 requests/second and cut its p50 latency roughly in half.
#
# Default 2, because that is the box this is being deployed on and because
# each worker opens its own database pool (10 + 20 overflow). Four workers on
# two cores would ask Postgres for up to 120 connections while contending for
# the same two cores - slower AND closer to max_connections.
#
# Override with UVICORN_WORKERS if the machine is bigger. A rough rule: one
# per core, and check that workers x 30 stays under Postgres max_connections.
#
# NOTE: the stale-location sweep in app/main.py runs once per worker, so it
# fires N times per interval. It is an idempotent UPDATE, so this is wasteful
# rather than wrong - but if that loop ever grows teeth, move it into the
# `scheduler` service, which is a single process by design.
WORKERS="${UVICORN_WORKERS:-2}"

# PROXY HEADERS
# -------------
# Without --proxy-headers, request.client.host is the address of whatever
# opened the connection - Nginx - so every request in the world looks like it
# came from one client. The per-IP login backstop then becomes a single shared
# bucket and 100 failed logins lock out the entire company.
#
# --forwarded-allow-ips is the list of proxies whose forwarding headers are
# believed. It defaults to the Docker network, where only Nginx can reach this
# port. Set it explicitly if the topology differs; do NOT widen it to "*" on a
# host where port 8000 is reachable from the internet, or anyone can claim any
# address.
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers "$WORKERS" \
    --proxy-headers \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-172.16.0.0/12,10.0.0.0/8,127.0.0.1}"

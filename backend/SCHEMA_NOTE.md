# Where did schema.sql go?

It was removed. It defined the full application schema (attendance, weekly
plans, farmers, dealers, orders, crop issues, notifications, visits, etc.)
correctly — but nothing in this project ever actually executed it against
a real database. There was no `docker-entrypoint-initdb.d` mount, no init
script, and no Alembic migration wired to it. Every router built against
those tables was fully implemented and completely non-functional in any
real deployment as a result.

**The schema now lives entirely in `backend/alembic/versions/`**, as
versioned, repeatable migrations — specifically:
- `202607240001_create_officer_location_tables.py` (officer_locations, gps_tracks)
- `202607240002_create_vishakan_business_schema.py` (everything else)

Run `alembic upgrade head` to apply the full schema. Don't recreate a
`schema.sql` file alongside the migrations — a second, hand-maintained copy
of the schema that isn't the source of truth is exactly what caused this
problem in the first place.

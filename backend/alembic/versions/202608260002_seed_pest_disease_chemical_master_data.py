"""seed pests, diseases, chemicals master data (Daily Visit Tracker gap)

Revision ID: 202608260002
Revises: 202608260001
Create Date: 2026-08-26 00:30:00

Migration 202608250001 created the `pests`, `diseases`, and `chemicals`
tables and wired them end-to-end (Step 5 of the mobile wizard ->
DailyVisitTrackerSubmitRequest.pest_ids/disease_ids/chemicals ->
visit_health_pests / visit_health_diseases / visit_health_chemicals) but
never seeded any rows - unlike farm_operations and organic_solutions in
that same migration, which got their full named lists. As shipped, an
officer opening Step 5 for a pest/disease-affected crop saw three empty
pickers.

This adds the two items your spec named explicitly as examples (Stem
borer, Aphids / Blast, Wilt), plus a broader set of pests, diseases, and
generic chemical/pesticide categories common across the field crops this
app already models (rice, cotton, vegetables, pulses) so Step 5 is
actually usable out of the box. All rows are admin-editable afterward via
GET/future-CRUD on master_data_router.py, same as every other table here
- this is a starting list, not a closed one.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "202608260002"
down_revision: str | None = "202608260001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PESTS = [
    "Stem borer",
    "Aphids",
    "Whitefly",
    "Fruit borer",
    "Pod borer",
    "Leaf folder",
    "Mealybug",
    "Thrips",
    "Jassids",
    "Red hairy caterpillar",
]

_DISEASES = [
    "Blast",
    "Wilt",
    "Blight",
    "Rust",
    "Powdery mildew",
    "Root rot",
    "Leaf spot",
    "Anthracnose",
    "Bacterial blight",
    "Mosaic virus",
]

_CHEMICALS = [
    "Insecticide - broad spectrum",
    "Fungicide - systemic",
    "Fungicide - contact",
    "Herbicide - pre-emergence",
    "Herbicide - post-emergence",
    "Miticide",
    "Nematicide",
    "Bio-pesticide",
    "Growth regulator",
]


def _insert(table: str, names: list[str]) -> None:
    values = ", ".join(f"(gen_random_uuid(), '{name}')" for name in names)
    op.execute(f"INSERT INTO {table} (id, name) VALUES {values}")


def upgrade() -> None:
    _insert("pests", _PESTS)
    _insert("diseases", _DISEASES)
    _insert("chemicals", _CHEMICALS)


def downgrade() -> None:
    op.execute(
        "DELETE FROM pests WHERE name = ANY(ARRAY[" + ",".join(f"'{n}'" for n in _PESTS) + "])"
    )
    op.execute(
        "DELETE FROM diseases WHERE name = ANY(ARRAY[" + ",".join(f"'{n}'" for n in _DISEASES) + "])"
    )
    op.execute(
        "DELETE FROM chemicals WHERE name = ANY(ARRAY[" + ",".join(f"'{n}'" for n in _CHEMICALS) + "])"
    )

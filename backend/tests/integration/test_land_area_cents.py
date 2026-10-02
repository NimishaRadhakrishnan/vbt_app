"""
Land area is stored and reported in CENTS. 1 acre = 100 cents.

Guards both halves of the change: the conversion arithmetic, and the
schema rename that makes the stored unit unambiguous. Runs against a
real Postgres, because a rename that only exists in Python would still
break every query at runtime.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER','vbt')}:{os.getenv('POSTGRES_PASSWORD','vbt')}"
    f"@{os.getenv('POSTGRES_HOST','127.0.0.1')}:{os.getenv('POSTGRES_PORT','5433')}/{os.getenv('POSTGRES_DB','vbt')}"
)


@pytest.fixture(scope="module")
def engine():
    return create_engine(DB_URL)


# --- conversion arithmetic ---

def test_one_acre_is_one_hundred_cents():
    from app.domain.value_objects.land_area import CENTS_PER_ACRE, acres_to_cents
    assert CENTS_PER_ACRE == 100
    assert acres_to_cents(1) == 100


def test_half_acre_is_fifty_cents():
    """Explicitly required: decimals must not truncate."""
    from app.domain.value_objects.land_area import acres_to_cents
    assert acres_to_cents(0.5) == 50


def test_fractional_acres_convert_exactly():
    from app.domain.value_objects.land_area import acres_to_cents
    assert acres_to_cents(2.5) == 250
    assert acres_to_cents(0.25) == 25
    assert acres_to_cents(0.01) == 1


def test_round_trip_is_lossless():
    from app.domain.value_objects.land_area import acres_to_cents, cents_to_acres
    for v in (0.5, 1, 2.5, 10, 0.25):
        assert cents_to_acres(acres_to_cents(v)) == v


def test_none_passes_through():
    """Land area is optional on several forms; None must not become 0,
    which would read as 'measured, and it was zero'."""
    from app.domain.value_objects.land_area import acres_to_cents, cents_to_acres
    assert acres_to_cents(None) is None
    assert cents_to_acres(None) is None


def test_conversion_note_is_available_for_display():
    from app.domain.value_objects.land_area import CONVERSION_NOTE
    assert CONVERSION_NOTE == "1 acre = 100 cents"


# --- schema: the rename actually happened in the database ---

def test_columns_renamed_to_cents(engine):
    with engine.begin() as c:
        cols = {
            r[0] for r in c.execute(text("""
                SELECT table_name||'.'||column_name FROM information_schema.columns
                WHERE column_name IN
                  ('cents','acres','cents_covered','acres_covered',
                   'trial_plot_size_cents','trial_plot_size_acres')
            """)).fetchall()
        }
    assert "farmers.cents" in cols
    assert "visits.cents_covered" in cols
    assert "visit_trial_details.trial_plot_size_cents" in cols
    # The old names must be gone, or code could still read them and get
    # cents while believing it has acres.
    assert "farmers.acres" not in cols
    assert "visits.acres_covered" not in cols
    assert "visit_trial_details.trial_plot_size_acres" not in cols


def test_stored_value_round_trips_as_cents(engine):
    """A farmer recorded as 250 cents reads back as 250 - no implicit
    re-scaling anywhere in the write/read path."""
    fid = uuid.uuid4()
    with engine.begin() as c:
        c.execute(
            text("""INSERT INTO farmers (id,name,phone,village,taluk,district,crop,cents,is_deleted)
                    VALUES (:i,'Cents RT','9000000099','V','T','Dindigul','Tomato',250,false)""")
            .bindparams(i=fid)
        )
        got = c.execute(text("SELECT cents FROM farmers WHERE id=:i").bindparams(i=fid)).scalar()
        c.execute(text("DELETE FROM farmers WHERE id=:i").bindparams(i=fid))
    assert float(got) == 250.0


def test_decimal_cents_survive_storage(engine):
    """0.5 acre = 50 cents; a half-cent must also survive, since the
    column is not an integer."""
    fid = uuid.uuid4()
    with engine.begin() as c:
        c.execute(
            text("""INSERT INTO farmers (id,name,phone,village,taluk,district,crop,cents,is_deleted)
                    VALUES (:i,'Dec','9000000098','V','T','Dindigul','Tomato',50.5,false)""")
            .bindparams(i=fid)
        )
        got = c.execute(text("SELECT cents FROM farmers WHERE id=:i").bindparams(i=fid)).scalar()
        c.execute(text("DELETE FROM farmers WHERE id=:i").bindparams(i=fid))
    assert float(got) == 50.5


def test_unrelated_units_untouched(engine):
    """The requirement was land area only - weight and crop-age units
    must be unaffected."""
    with engine.begin() as c:
        cols = {
            r[0] for r in c.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name IN ('visit_micronutrients','visit_crop_profiles')
                  AND column_name IN ('unit','crop_age_unit','quantity')
            """)).fetchall()
        }
    assert "unit" in cols or "crop_age_unit" in cols

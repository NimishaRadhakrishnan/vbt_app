"""Phase 6: nudges (max one a day), the data-stage job, photo shrinking, push token."""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import text

from app.application.use_cases import kpi_nudges as nud
from app.application.use_cases import kpi_storage as stg
from app.infrastructure.config.company_time import company_today
from app.infrastructure.push.expo_push import send_push
from app.main import app
from tests.integration.test_kpi_engine import RUPEE, add_farmer, add_visit, db, make_user, set_goal, token_for  # noqa: F401

pytestmark = pytest.mark.asyncio
TUE = date(2026, 11, 3)
WED = date(2026, 11, 4)


@pytest.fixture
async def clean(db):
    yield db
    s = db
    await s.rollback()
    ids = list(s.created)
    await s.execute(text("DELETE FROM notifications WHERE user_id = ANY(:i)"), {"i": ids})
    await s.execute(text("DELETE FROM file_uploads WHERE uploaded_by = ANY(:i)"), {"i": ids})
    await s.execute(text("DELETE FROM kpi_period WHERE start_date IN (DATE '2026-01-01', DATE '2026-12-31') OR (type='month' AND start_date = date_trunc('month', current_date))"))
    await s.execute(text("DELETE FROM kpi_period WHERE start_date = DATE '2025-01-01'"))
    await s.execute(text("UPDATE settings SET value = 'true'::jsonb WHERE key = 'kpi.nudges_enabled'"))
    await s.commit()


async def _sales_officer(s, sales_pct=1.0):
    t = company_today()
    so = await make_user(s, work_mode="sales")
    await set_goal(s, so, "sales_done", t.year, t.month, 1_000_000 * RUPEE)
    await s.execute(text("INSERT INTO sales_figure (officer_id, year, month, sales_amount_paise, collection_amount_paise) "
                         "VALUES (:o, :y, :m, :s, :c)"), {"o": so, "y": t.year, "m": t.month, "s": int(1_000_000 * RUPEE * sales_pct), "c": 100 * RUPEE})
    await s.commit()
    return so


async def test_one_nudge_a_day_and_each_only_once(clean):
    s = clean
    so = await _sales_officer(s)
    first = await nud.nudge_officer(s, so, TUE)
    assert first and "100%" in first
    assert await nud.nudge_officer(s, so, TUE) is None                  # max one a day
    assert await nud.nudge_officer(s, so, WED) is None                  # nothing new to say: never a repeat
    await s.execute(text("UPDATE sales_figure SET collection_amount_paise = :c WHERE officer_id = :o"), {"c": 1_000_000 * RUPEE, "o": so})
    await s.commit()
    second = await nud.nudge_officer(s, so, date(2026, 11, 5))
    assert second and second != first and "Money collected" in second   # a new reason: collection goal reached
    third = await nud.nudge_officer(s, so, date(2026, 11, 6))
    assert third and "close" in third                                   # and close to the next collection level
    n = (await s.execute(text("SELECT count(*) FROM notifications WHERE user_id = :u AND type = 'kpi_nudge'"), {"u": so})).scalar_one()
    assert n == 3
    log_days = (await s.execute(text("SELECT count(*) FROM (SELECT sent_on FROM kpi_nudge_log WHERE officer_id = :o AND delivered "
                                     "GROUP BY sent_on HAVING count(*) > 1) x"), {"o": so})).scalar_one()
    assert log_days == 0


async def test_no_nudge_on_sunday_or_when_switched_off(clean):
    s = clean
    so = await _sales_officer(s)
    assert await nud.nudge_officer(s, so, date(2026, 11, 8)) is None    # a Sunday
    await s.execute(text("UPDATE settings SET value = 'false'::jsonb WHERE key = 'kpi.nudges_enabled'"))
    await s.commit()
    assert await nud.nudge_everyone(s) == (0, 0)
    assert (await s.execute(text("SELECT count(*) FROM notifications WHERE user_id = :u"), {"u": so})).scalar_one() == 0


async def test_higher_milestone_silences_lower_ones(clean):
    s = clean
    so = await _sales_officer(s, sales_pct=0.85)
    msg = await nud.nudge_officer(s, so, TUE)
    assert msg and "80%" in msg
    keys = {r.nudge_key.split(":")[2] for r in (await s.execute(text("SELECT nudge_key FROM kpi_nudge_log WHERE officer_id = :o AND kind = 'milestone'"), {"o": so})).all()}
    assert {"80", "50"} <= keys                                          # 50% will not be sent tomorrow


async def test_monday_and_seven_days_left_messages():
    base = {"period": {"type": "month", "start": "2026-11-01", "days_left": 7, "working_days_left": 6},
            "advice": "Visit 2 farmers a day to reach your goal.",
            "field": {"items": [{"code": "farmers_visited", "name": "Farmers visited", "skipped": False, "goal": 30, "pct": 0.2, "left": 24, "done": 6, "extra": 0}]}}
    monday = nud.candidates(base, date(2026, 11, 2), set())
    kinds = {k for k, _, _ in monday}
    assert {"weekly", "days_left"} <= kinds
    weekly = next(m for k, _, m in monday if k == "weekly")
    assert weekly == "This week you need 24 farmer visits to stay on track."     # 24 left over 6 working days = 4 a day, 6 days this week
    assert not [k for k, _, _ in nud.candidates(base, date(2026, 11, 3), set()) if k == "weekly"]   # Mondays only


async def test_push_token_and_overview_nudge(clean):
    s = clean
    so = await _sales_officer(s)
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://t")
    c.headers["Authorization"] = f"Bearer {token_for(so, 'field_officer')}"
    async with c:
        assert (await c.post("/api/v1/kpi/me/push-token", json={"token": "ExponentPushToken[abc]", "platform": "android"})).status_code == 204
        assert (await c.get("/api/v1/kpi/me/overview")).json()["nudge"] is None
        await nud.nudge_officer(s, so, TUE)
        j = (await c.get("/api/v1/kpi/me/overview")).json()
        assert j["nudge"] and j["nudge"]["message"]
        assert (await c.post(f"/api/v1/notifications/{j['nudge']['id']}/read")).status_code == 200
        assert (await c.get("/api/v1/kpi/me/overview")).json()["nudge"] is None
    assert await send_push(["not-a-token"], "t", "b") == 0


async def test_snapshots_thinned_but_last_of_period_kept(clean):
    s = clean
    so = await make_user(s, work_mode="field")
    pid = (await s.execute(text("INSERT INTO kpi_period (type, start_date, end_date) VALUES ('quarter', DATE '2026-01-01', DATE '2026-03-31') "
                                "ON CONFLICT (type, start_date) DO UPDATE SET type = 'quarter' RETURNING id"))).scalar_one()
    d = date(2026, 1, 1)
    while d <= date(2026, 3, 31):
        await s.execute(text("INSERT INTO performance_snapshot (officer_id, period_id, snapshot_date, items, score) VALUES (:o, :p, :d, '{}'::jsonb, 50)"),
                        {"o": so, "p": pid, "d": d})
        d += timedelta(days=1)
    await s.commit()
    out = await stg.stage_snapshots(s, 60)
    assert out["snapshots_archived"] >= 90
    rows = [r.snapshot_date for r in (await s.execute(text("SELECT snapshot_date FROM performance_snapshot WHERE officer_id = :o ORDER BY snapshot_date"), {"o": so})).all()]
    assert date(2026, 3, 31) in rows and 12 <= len(rows) <= 15            # about one a week
    assert len({r.isocalendar()[1] for r in rows}) == len(rows)


async def test_old_photos_shrunk_trial_photos_kept(clean, tmp_path):
    s = clean
    so = await make_user(s, work_mode="field")
    names = {k: f"{uuid.uuid4()}.jpg" for k in ("old", "new", "trial")}
    for k, n in names.items():
        Image.effect_noise((3000, 2000), 90).convert("RGB").save(tmp_path / n, "JPEG", quality=95)
        age = "now()" if k == "new" else "now() - interval '100 days'"
        await s.execute(text(f"INSERT INTO file_uploads (filename, uploaded_by, uploaded_at) VALUES (:f, :u, {age})"), {"f": n, "u": so})
    farmer = await add_farmer(s, "v")
    vid = uuid.uuid4()
    await s.execute(text("""INSERT INTO visits (id, user_id, visit_type, farmer_id, start_time, location_start, is_trial, photo_url_farm)
        VALUES (:i, :u, 'farmer', :f, now() - interval '30 days', ST_GeogFromText('POINT(77 11)'), true, :p)"""),
                    {"i": vid, "u": so, "f": farmer, "p": f"http://x/files/{names['trial']}"})
    await s.commit()
    out = await stg.stage_photos(s, 60, 1280, 60, upload_dir=str(tmp_path))
    assert out["photos_shrunk"] >= 1 and out["photo_bytes_saved"] > 0
    assert Image.open(tmp_path / names["old"]).width == 1280
    assert Image.open(tmp_path / names["new"]).width == 3000               # recent: untouched
    assert Image.open(tmp_path / names["trial"]).width == 3000             # trial still inside its window: untouched
    again = await stg.stage_photos(s, 60, 1280, 60, upload_dir=str(tmp_path))
    assert again["photos_shrunk"] == 0                                      # nothing to do twice

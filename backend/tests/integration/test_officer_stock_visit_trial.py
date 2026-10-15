"""Officer leftover stock stays exact through a Field Visit trial:
issued by admin - given in the trial + unused returned at the end."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.main import app


@pytest.fixture
async def _ensure_db():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("No database reachable")


@pytest.fixture
async def client(_ensure_db):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _login(client, email):
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _stock(client, headers, pid, **params):
    rows = (await client.get("/api/v1/stock/my-stock", headers=headers, params=params)).json()
    return next((r for r in rows if r["product_id"] == pid), None)


async def test_trial_deducts_and_unused_returns(client):
    admin = await _login(client, "admin@vishakan.com")
    officer = await _login(client, "dinesh@vishakan.com")
    me = (await client.get("/api/v1/auth/me", headers=officer)).json()
    uid = me.get("id") or me.get("user_id")

    pid = uuid.uuid4()
    other = uuid.uuid4()
    async with AsyncSessionLocal() as s:
        for i, nm in ((pid, "Tracked"), (other, "NotIssued")):
            await s.execute(text("INSERT INTO products (id, name, category, sku_code, price) VALUES (:i, :n, 'x', :sku, 10)")
                            .bindparams(i=i, n=f"{nm} {uuid.uuid4().hex[:6]}", sku=f"S{uuid.uuid4().hex[:8]}"))
        await s.commit()
    pid, other = str(pid), str(other)
    dealer_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as s:
        await s.execute(text("INSERT INTO dealers (id, name, phone, district) VALUES (CAST(:i AS uuid), 'Visit Dealer', :ph, 'Erode')")
                        .bindparams(i=dealer_id, ph=str(uuid.uuid4().int)[:10]))
        await s.commit()

    # Not issued yet: hidden from the issued-only list, shown as 0 in the full list.
    assert await _stock(client, officer, pid, issued_only="true") is None
    assert (await _stock(client, officer, pid))["current_quantity"] == 0

    alloc = await client.post("/api/v1/stock/allocations", headers=admin,
                              json={"allocations": [{"officer_id": str(uid), "product_id": pid, "quantity": 100}]})
    assert alloc.status_code == 201, alloc.text
    row = await _stock(client, officer, pid, issued_only="true")
    assert row["current_quantity"] == 100 and row["allocated"] == 100 and row["used"] == 0
    assert await _stock(client, officer, other, issued_only="true") is None

    # Close any visit left open by earlier runs.
    await client.post("/api/v1/visits/end", headers=officer, json={"latitude": 11, "longitude": 77, "task_completed": True})

    def start(qty, product=pid):
        return client.post("/api/v1/visits/start", headers=officer, json={
            "visit_type": "dealer", "dealer_id": dealer_id, "latitude": 11.0, "longitude": 77.0, "purpose": "demo",
            "photo_urls": ["/u/x.jpg"], "is_trial": True,
            "trial_products": [{"product_id": product, "quantity_given": qty}]})

    # Taking more than is held is refused and leaves no open visit behind.
    too_much = await start(150)
    assert too_much.status_code == 400, too_much.text
    assert (await client.get("/api/v1/visits/active", headers=officer)).json() is None
    assert (await start(5, other)).status_code == 400  # never issued -> nothing in hand

    ok = await start(40)
    assert ok.status_code == 201, ok.text
    assert (await _stock(client, officer, pid))["current_quantity"] == 60

    # Leftover above what was taken is refused and the visit stays open.
    bad = await client.post("/api/v1/visits/end", headers=officer, json={
        "latitude": 11, "longitude": 77, "task_completed": True,
        "trial_leftovers": [{"product_id": pid, "quantity_leftover": 41}]})
    assert bad.status_code == 400
    assert (await client.get("/api/v1/visits/active", headers=officer)).json() is not None

    done = await client.post("/api/v1/visits/end", headers=officer, json={
        "latitude": 11, "longitude": 77, "task_completed": True,
        "trial_leftovers": [{"product_id": pid, "quantity_leftover": 15}]})
    assert done.status_code == 200, done.text
    row = await _stock(client, officer, pid, issued_only="true")
    # 100 issued - 40 taken + 15 unused returned = 75; 25 really used.
    assert row["current_quantity"] == 75 and row["allocated"] == 100 and row["used"] == 40 and row["corrections"] == 15


async def test_visit_without_farmer_or_dealer_gets_a_clear_message(client):
    officer = await _login(client, "dinesh@vishakan.com")
    await client.post("/api/v1/visits/end", headers=officer, json={"latitude": 11, "longitude": 77, "task_completed": True})
    res = await client.post("/api/v1/visits/start", headers=officer, json={
        "visit_type": "farmer", "latitude": 11.0, "longitude": 77.0, "purpose": "x", "photo_urls": ["/u/x.jpg"]})
    assert res.status_code == 400
    assert "farmer or a dealer" in res.text


async def test_ledger_shows_running_balance_and_who_it_went_to(client):
    """History rows carry the stock left after each movement and the farmer."""
    officer = await _login(client, "dinesh@vishakan.com")
    hist = await client.get("/api/v1/stock/ledger?limit=50", headers=officer)
    assert hist.status_code == 200, hist.text
    rows = hist.json()
    assert rows and all("balance_after" in r and "context" in r for r in rows)
    # newest first: the newest row's balance equals the officer's current stock for that product
    top = rows[0]
    mine = {i["product_id"]: i["current_quantity"] for i in (await client.get("/api/v1/stock/my-stock", headers=officer)).json()}
    assert abs(top["balance_after"] - mine[top["product_id"]]) < 1e-6
    only_trials = await client.get("/api/v1/stock/ledger?movement_type=trial_given&date_from=2020-01-01&date_to=2099-01-01", headers=officer)
    assert only_trials.status_code == 200 and all(r["movement_type"] == "trial_given" for r in only_trials.json())

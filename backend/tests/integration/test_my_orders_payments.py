"""Officer's received-orders list and payment collection (mobile Orders screen)."""
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


async def test_my_orders_and_collect_payment(client):
    officer = await _login(client, "dinesh@vishakan.com")
    me = (await client.get("/api/v1/auth/me", headers=officer)).json()
    uid = me.get("id") or me.get("user_id")

    dealer_id, order_id, product_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with AsyncSessionLocal() as s:
        await s.execute(text("INSERT INTO dealers (id, name, phone, district, assigned_sales_officer_id) "
                             "VALUES (:i, 'Test Agro', :ph, 'Erode', CAST(:u AS uuid))").bindparams(i=dealer_id, u=str(uid), ph=str(uuid.uuid4().int)[:10]))
        await s.execute(text("INSERT INTO products (id, name, category, sku_code, price) "
                             "VALUES (:i, :pn, 'x', :sku, 100)").bindparams(i=product_id, pn=f"Test Prod {uuid.uuid4().hex[:6]}", sku=f"T{uuid.uuid4().hex[:8]}"))
        await s.execute(text("INSERT INTO dealer_orders (id, dealer_id, created_by, status, total_amount) "
                             "VALUES (:o, :d, CAST(:u AS uuid), 'submitted', 1000)").bindparams(o=order_id, d=dealer_id, u=str(uid)))
        await s.execute(text("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) "
                             "VALUES (gen_random_uuid(), :o, :p, 10, 100)").bindparams(o=order_id, p=product_id))
        await s.commit()

    mine = await client.get("/api/v1/dealers/orders/mine", headers=officer)
    assert mine.status_code == 200, mine.text
    row = next(r for r in mine.json() if r["id"] == str(order_id))
    assert row["dealer_name"] == "Test Agro" and row["outstanding_amount"] == 1000 and row["items"][0]["quantity"] == 10

    pay = await client.post(f"/api/v1/dealers/orders/{order_id}/payments", headers=officer,
                            json={"collection_status": "collected", "amount": 400, "method": "cash"})
    assert pay.status_code == 201, pay.text
    over = await client.post(f"/api/v1/dealers/orders/{order_id}/payments", headers=officer,
                             json={"collection_status": "collected", "amount": 900, "method": "cash"})
    assert over.status_code == 400

    row = next(r for r in (await client.get("/api/v1/dealers/orders/mine", headers=officer)).json() if r["id"] == str(order_id))
    assert row["amount_paid"] == 400 and row["outstanding_amount"] == 600
    hist = await client.get(f"/api/v1/dealers/orders/{order_id}/payments", headers=officer)
    assert len(hist.json()) == 1

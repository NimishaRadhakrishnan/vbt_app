import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from app.main import app
from app.infrastructure.database.session import AsyncSessionLocal, engine

@pytest.fixture
async def _ensure_db():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("No database reachable")

@pytest.fixture
async def clients():
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    yield client
    await client.aclose()

@pytest.fixture
async def admin_token(clients, _ensure_db):
    res = await clients.post("/api/v1/auth/login", json={"email": "admin@vishakan.com", "password": "Password123!"})
    return res.json()["access_token"]

@pytest.fixture
async def officer_token(clients, _ensure_db):
    res = await clients.post("/api/v1/auth/login", json={"email": "dinesh@vishakan.com", "password": "Password123!"})
    return res.json()["access_token"]

@pytest.fixture
async def officer_id(clients, officer_token):
    res = await clients.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {officer_token}"})
    return res.json()["id"]

@pytest.fixture
async def product_id(_ensure_db):
    async with AsyncSessionLocal() as session:
        res = await session.execute(text("SELECT id FROM products WHERE is_active = true LIMIT 1"))
        row = res.fetchone()
        if not row:
            pytest.skip("No product found")
        return row[0]

@pytest.fixture(autouse=True)
async def clear_ledger(officer_id, product_id, _ensure_db):
    # clear before
    async with AsyncSessionLocal() as session:
        await session.execute(text("DELETE FROM stock_ledger WHERE officer_id = CAST(:oid AS UUID) AND product_id = CAST(:pid AS UUID)").bindparams(oid=str(officer_id), pid=str(product_id)))
        await session.commit()
    yield
    # clear after
    async with AsyncSessionLocal() as session:
        await session.execute(text("DELETE FROM stock_ledger WHERE officer_id = CAST(:oid AS UUID) AND product_id = CAST(:pid AS UUID)").bindparams(oid=str(officer_id), pid=str(product_id)))
        await session.commit()

async def test_my_stock_reflects_allocation(clients, admin_token, officer_token, officer_id, product_id):
    # POST /api/v1/stock/allocations
    payload = {
        "allocations": [
            {
                "officer_id": officer_id,
                "product_id": str(product_id),
                "quantity": 50,
                "remarks": "Test"
            }
        ]
    }
    res = await clients.post("/api/v1/stock/allocations", json=payload, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 201

    # GET /api/v1/stock/my-stock
    res = await clients.get("/api/v1/stock/my-stock", headers={"Authorization": f"Bearer {officer_token}"})
    assert res.status_code == 200
    stocks = res.json()
    
    stock = next((s for s in stocks if s["product_id"] == str(product_id)), None)
    assert stock is not None
    assert stock["current_quantity"] == 50.0

async def test_trial_rejected_when_insufficient(clients, admin_token, officer_token, officer_id, product_id):
    # Allocate 3 units
    payload = {
        "allocations": [
            {
                "officer_id": officer_id,
                "product_id": str(product_id),
                "quantity": 3,
                "remarks": "Test"
            }
        ]
    }
    res = await clients.post("/api/v1/stock/allocations", json=payload, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 201

    async with AsyncSessionLocal() as session:
        cat_res = await session.execute(text("SELECT id FROM crop_categories WHERE is_active = true LIMIT 1"))
        cat_row = cat_res.fetchone()
        cat_id = str(cat_row[0]) if cat_row else None
        crop_res = await session.execute(text("SELECT id FROM crops WHERE is_active = true LIMIT 1"))
        crop_row = crop_res.fetchone()
        crop_id = str(crop_row[0]) if crop_row else None
        
    visit_payload = {
        "latitude": 10.0,
        "longitude": 20.0,
        "farm_size_value": 1.0,
        "farm_size_unit": "cents",
        "farming_type": "conventional",
        "crop_status": "healthy",
        "new_farmer": {
            "name": "Test Farmer",
            "phone": "9999999999",
            "village": "Test Village",
            "taluk": "Test Taluk",
            "district": "Test District",
            "crop": "Test Crop",
            "cents": 1.0
        },
        "config_version": 1,
        "custom_field_answers": {},
        "is_trial": True,
        "demo_status": "started_today",
        # Must be one of ck_visit_trial_purpose's values. This said "demo",
        # which is not in the set; the test still went green because the
        # stock check answered 400 before the row reached Postgres. Now that
        # the schema validates the field, an invalid value would 422 here and
        # the test would stop exercising the insufficient-stock path at all.
        "visit_purpose": "demo_setup",
        "trial_plot_size_cents": 2,
        "trial_products": [
            {
                "product_id": str(product_id),
                "quantity_given": 999
            }
        ]
    }

    res = await clients.post("/api/v1/visits/daily-tracker/submit", json=visit_payload, headers={"Authorization": f"Bearer {officer_token}"})
    assert res.status_code == 400, res.text

    # check my-stock still shows 3.0
    res = await clients.get("/api/v1/stock/my-stock", headers={"Authorization": f"Bearer {officer_token}"})
    assert res.status_code == 200
    stocks = res.json()
    stock = next((s for s in stocks if s["product_id"] == str(product_id)), None)
    assert stock is not None
    assert stock["current_quantity"] == 3.0



async def test_admin_products_fetch(clients, admin_token):
    res = await clients.get("/api/v1/admin/products", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert isinstance(res.json(), list)

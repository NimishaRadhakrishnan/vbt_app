import pytest
import uuid
import random
from datetime import datetime, UTC, timedelta
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from app.main import app
from app.infrastructure.database.session import AsyncSessionLocal, engine
from tests.integration.test_location_history import _database_reachable, _register_and_login_test_officer
from app.infrastructure.config.company_time import company_tz

@pytest.mark.asyncio
async def test_visit_count_at_00_30_ist() -> None:
    if not await _database_reachable():
        pytest.skip("No DB")
        
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        officer_id, admin_token = await _register_and_login_test_officer(client)
        
        async with AsyncSessionLocal() as session:
            # Create a dummy farmer
            farmer_id = uuid.uuid4()
            rand_phone = str(random.randint(1000000000, 9999999999))
            await session.execute(
                text("""
                    INSERT INTO farmers (id, name, phone, district, taluk, village, crop, cents, created_at, updated_at)
                    VALUES (:id, 'Test Farmer', :phone, 'D', 'T', 'V', 'Rice', 5, now(), now())
                """),
                {"id": farmer_id, "phone": rand_phone}
            )
            
            today = datetime.now(company_tz()).date()
            ist_today_0030 = datetime(today.year, today.month, today.day, 0, 30, tzinfo=company_tz())
            
            await session.execute(text("DELETE FROM visits WHERE user_id = :uid"), {"uid": officer_id})
            
            await session.execute(
                text("""
                    INSERT INTO visits (
                        id, user_id, visit_type, farmer_id, dealer_id,
                        start_time, end_time, created_at, updated_at,
                        location_start, location_end, purpose
                    )
                    VALUES (
                        gen_random_uuid(), :uid, 'farmer', :fid, NULL,
                        :st, :et, now(), now(),
                        ST_SetSRID(ST_MakePoint(78, 11), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(78, 11), 4326)::geography,
                        'test'
                    )
                """),
                {"uid": officer_id, "fid": farmer_id, "st": ist_today_0030, "et": ist_today_0030 + timedelta(minutes=15)}
            )
            await session.commit()
            
            res = await session.execute(text("SELECT email FROM users WHERE id = :uid"), {"uid": officer_id})
            officer_email = res.scalar()
            
        officer_login = await client.post(
            "/api/v1/auth/login",
            json={"email": officer_email, "password": "Password123!"}
        )
        officer_token = officer_login.json()["access_token"]
        
        response = await client.get(
            "/api/v1/visits/daily-tracker/dashboard-summary",
            headers={"Authorization": f"Bearer {officer_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["visits_today"] == 1, f"Expected 1 visit, got {data['visits_today']} - UTC offset bug still present if 0"

        # Leave nothing behind. This test seeds a farmer named "Test Farmer"
        # and a visit pointing at it; other modules clean up by name, and a
        # stray row here made their cleanup collide with check_visit_target.
        async with AsyncSessionLocal() as session:
            await session.execute(text("DELETE FROM visits WHERE user_id = :uid"), {"uid": officer_id})
            await session.execute(text("DELETE FROM farmers WHERE id = :fid"), {"fid": farmer_id})
            await session.commit()

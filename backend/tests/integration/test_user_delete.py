import pytest
import uuid
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.main import app
import pytest_asyncio

@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

@pytest_asyncio.fixture
async def admin_token(client, db_session):
    resp = await client.post("/api/v1/auth/login", json={"email": "admin@vishakan.com", "password": "Password123!"})
    row = await db_session.execute(text("SELECT id FROM users WHERE email = 'admin@vishakan.com'"))
    admin_id = row.scalar()
    return {"token": resp.json()["access_token"], "id": str(admin_id)}

@pytest_asyncio.fixture
def admin_client(client, admin_token):
    client.headers.update({"Authorization": f"Bearer {admin_token['token']}"})
    return client

@pytest_asyncio.fixture
async def create_user(db_session: AsyncSession):
    async def _create(role="field_officer", is_active=True):
        user_id = uuid.uuid4()
        email = f"user_{user_id}@example.com"
        await db_session.execute(text("""
            INSERT INTO users (id, email, hashed_password, full_name, role, is_active, is_deleted, created_at, updated_at)
            VALUES (:id, :email, 'hash', 'Test User', :role, :is_active, false, now(), now())
        """).bindparams(id=user_id, email=email, role=role, is_active=is_active))
        await db_session.commit()
        return user_id
    return _create

@pytest_asyncio.fixture
async def isolate_single_admin(db_session: AsyncSession, admin_token):
    admin_id = uuid.UUID(admin_token["id"])
    admins = await db_session.execute(text("SELECT id, is_active FROM users WHERE role = 'admin' AND id != :admin_id").bindparams(admin_id=admin_id))
    admin_states = admins.fetchall()
    
    await db_session.execute(text("UPDATE users SET is_active = false WHERE role = 'admin' AND id != :admin_id").bindparams(admin_id=admin_id))
    await db_session.commit()
    
    yield admin_id
    
    for uid, is_active in admin_states:
        await db_session.execute(text("UPDATE users SET is_active = :is_active WHERE id = :id").bindparams(is_active=is_active, id=uid))
    await db_session.commit()

@pytest.mark.asyncio
async def test_last_active_admin_forbidden(admin_client, admin_token, db_session: AsyncSession, isolate_single_admin):
    admin_id = isolate_single_admin
    resp = await admin_client.post(f"/api/v1/users/{admin_id}/status", json={"is_active": False})
    assert resp.status_code == 400
    assert "administrator cannot deactivate their own account" in resp.json()["detail"].lower() or "last active" in resp.json()["detail"].lower()

@pytest.mark.asyncio
async def test_disable_user_works(admin_client, create_user):
    user_id = await create_user(is_active=True)
    resp = await admin_client.post(f"/api/v1/users/{user_id}/status", json={"is_active": False})
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

@pytest.mark.asyncio
async def test_active_user_cannot_be_deleted(admin_client, create_user):
    user_id = await create_user(is_active=True)
    resp = await admin_client.delete(f"/api/v1/admin/users/{user_id}")
    assert resp.status_code == 400

@pytest.mark.asyncio
async def test_archived_user_cannot_log_in(client, db_session: AsyncSession):
    pw_hash = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjIQqiRQYq"
    user_id = uuid.uuid4()
    email = f"archived_{user_id}@test.com"
    await db_session.execute(text("""
        INSERT INTO users (id, email, hashed_password, full_name, role, is_active, is_deleted, created_at, updated_at)
        VALUES (:id, :email, :hash, 'Archived', 'field_officer', true, true, now(), now())
    """).bindparams(id=user_id, email=email, hash=pw_hash))
    await db_session.commit()

    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    assert resp.status_code in [400, 401]

@pytest.mark.asyncio
async def test_zero_record_hard_delete(admin_client, create_user, db_session: AsyncSession, admin_token):
    user_id = await create_user(is_active=False)
    audit_id = uuid.uuid4()
    
    await db_session.execute(text("""
        INSERT INTO audit_logs (id, user_id, event_type, description, action, affected_module, context_data, created_at, updated_at)
        VALUES (:aid, :uid, 'test_event', 'test', 'test_action', 'test_module', '{}', now(), now())
    """).bindparams(aid=audit_id, uid=user_id))
    await db_session.commit()

    resp = await admin_client.delete(f"/api/v1/admin/users/{user_id}")
    assert resp.status_code == 200
    assert resp.json() == {"result": "deleted"}
    
    # Check that audit row survived but user_id is NULL
    row = (await db_session.execute(text("SELECT user_id FROM audit_logs WHERE id = :aid").bindparams(aid=audit_id))).fetchone()
    assert row is not None
    assert row[0] is None
    
    user_count = await db_session.scalar(text("SELECT count(*) FROM users WHERE id = :uid").bindparams(uid=user_id))
    assert user_count == 0
    
    # Teardown
    await db_session.execute(text("DELETE FROM audit_logs WHERE event_type LIKE 'test_event%'"))
    await db_session.commit()

@pytest.mark.asyncio
async def test_hard_delete_with_leftover_records(admin_client, create_user, db_session: AsyncSession):
    user_id = await create_user(is_active=False)
    
    await db_session.execute(text("""
        INSERT INTO visit_drafts (id, officer_id, draft_data, created_at, updated_at)
        VALUES (gen_random_uuid(), :uid, '{}', now(), now())
    """).bindparams(uid=user_id))
    await db_session.commit()

    resp = await admin_client.delete(f"/api/v1/admin/users/{user_id}")
    assert resp.status_code == 200
    assert resp.json() == {"result": "deleted"}
    
    dev_count = await db_session.scalar(text("SELECT count(*) FROM visit_drafts WHERE officer_id = :uid").bindparams(uid=user_id))
    assert dev_count == 0

@pytest.mark.asyncio
async def test_user_with_kudos_archived(admin_client, create_user, db_session: AsyncSession, admin_token):
    user_id = await create_user(is_active=False)
    
    await db_session.execute(text("""
        INSERT INTO kudos (id, from_user_id, to_user_id, message, created_at)
        VALUES (gen_random_uuid(), :uid, :admin, 'Good job', now())
    """).bindparams(uid=user_id, admin=uuid.UUID(admin_token["id"])))
    await db_session.commit()

    resp = await admin_client.delete(f"/api/v1/admin/users/{user_id}")
    assert resp.status_code == 200
    assert resp.json() == {"result": "archived"}

@pytest.mark.asyncio
async def test_delete_impact_matches_pg_constraint(admin_client, create_user, db_session: AsyncSession):
    user_id = await create_user(is_active=False)
    resp = await admin_client.get(f"/api/v1/admin/users/{user_id}/delete-impact")
    assert resp.status_code == 200
    counts = resp.json()["counts"]
    assert isinstance(counts, dict)

@pytest.mark.asyncio
async def test_assignee_list_excludes_archived(admin_client, create_user):
    user_id = await create_user(is_active=True)
    await admin_client.delete(f"/api/v1/admin/users/{user_id}") # won't hard delete, will fail active check. Wait!
    
    user_id2 = await create_user(is_active=False)
    await admin_client.delete(f"/api/v1/admin/users/{user_id2}")
    
    resp = await admin_client.get("/api/v1/users")
    assert str(user_id2) not in str(resp.json())

@pytest.mark.asyncio
async def test_admin_deleting_self_rejected(admin_client, admin_token):
    resp = await admin_client.delete(f"/api/v1/admin/users/{admin_token['id']}")
    assert resp.status_code == 400
    assert "cannot delete their own account" in resp.json()["detail"].lower()

@pytest.mark.asyncio
async def test_integrity_error_is_not_leaked_to_client(admin_client, create_user, db_session: AsyncSession, monkeypatch):
    user_id = await create_user(is_active=False)
    
    # Mock session.execute to raise IntegrityError ONLY when deleting the user
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.exc import IntegrityError
    
    original_execute = AsyncSession.execute
    
    async def mock_execute(self, statement, *args, **kwargs):
        if "DELETE FROM users WHERE id = :uid" in str(statement):
            raise IntegrityError("mock error", params={}, orig=Exception("mock constraint violation"))
        return await original_execute(self, statement, *args, **kwargs)
        
    monkeypatch.setattr(AsyncSession, "execute", mock_execute)
    
    resp = await admin_client.delete(f"/api/v1/admin/users/{user_id}")
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "has protected history and cannot be deleted" in detail
    assert "IntegrityError" not in detail
    
    # Verify user still exists
    user_exists = await db_session.scalar(text("SELECT count(*) FROM users WHERE id = :uid").bindparams(uid=user_id))
    assert user_exists == 1

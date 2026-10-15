"""Officer login issues: held sign-in -> admin notified -> admin acts -> officer told."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.main import app

EMAIL = "dinesh@vishakan.com"


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


async def _reset_officer():
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET device_id = NULL, login_status = 'active', is_active = true WHERE email = :e"), {"e": EMAIL})
        await s.execute(text("DELETE FROM login_issues WHERE user_id = (SELECT id FROM users WHERE email = :e)"), {"e": EMAIL})
        await s.commit()


async def _login(client, device, name=None, email=EMAIL):
    return await client.post("/api/v1/auth/login", json={
        "email": email, "password": "Password123!", "device_id": device, "device_name": name})


async def _admin(client):
    res = await client.post("/api/v1/auth/login", json={"email": "admin@vishakan.com", "password": "Password123!"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_new_phone_request_approve_flow(client):
    await _reset_officer()
    old, new = f"dev-old-{uuid.uuid4().hex[:8]}", f"dev-new-{uuid.uuid4().hex[:8]}"
    assert (await _login(client, old, "Old Phone")).status_code == 200

    held = await _login(client, new, "Samsung SM-A52 · Android 13")
    assert held.status_code == 401
    assert held.json()["code"] == "device_approval_pending"
    again = await _login(client, new, "Samsung SM-A52 · Android 13")
    assert again.json()["code"] == "device_approval_pending"

    admin = await _admin(client)
    pending = (await client.get("/api/v1/login-issues?status_filter=pending", headers=admin)).json()
    row = next(r for r in pending if r["attempted_device_id"] == new)
    assert row["officer_name"] and row["employee_id"] is not None or row["email"] == EMAIL
    assert row["device_name"].startswith("Samsung") and row["registered_device_id"] == old
    assert row["attempt_count"] == 2 and row["login_status"] == "pending_review"
    assert (await client.get("/api/v1/login-issues/pending-count", headers=admin)).json()["pending"] >= 1

    # an officer cannot see or act on the queue
    officer = await _login(client, old)
    oh = {"Authorization": f"Bearer {officer.json()['access_token']}"}
    assert (await client.get("/api/v1/login-issues", headers=oh)).status_code == 403
    assert (await client.post(f"/api/v1/login-issues/{row['id']}/action", headers=oh, json={"action": "approve_device"})).status_code == 403
    mine = (await client.get("/api/v1/login-issues/mine", headers=oh)).json()
    assert any(m["id"] == row["id"] for m in mine)

    done = await client.post(f"/api/v1/login-issues/{row['id']}/action", headers=admin, json={"action": "approve_device", "note": "Phone lost"})
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["status"] == "resolved" and body["resolved_by_name"]
    kinds = [e["event_type"] for e in body["events"]]
    assert kinds[0] == "created" and "attempt_again" in kinds and "approve_device" in kinds and "officer_notified" in kinds
    assert (await client.post(f"/api/v1/login-issues/{row['id']}/action", headers=admin, json={"action": "reject", "note": "x"})).status_code == 409

    assert (await _login(client, new)).status_code == 200      # new phone works

    async with AsyncSessionLocal() as s:
        st = (await s.execute(text("SELECT login_status FROM users WHERE email = :e"), {"e": EMAIL})).scalar_one()
        n = (await s.execute(text(
            "SELECT count(*) FROM notifications WHERE type = 'login_resolved' AND user_id = (SELECT id FROM users WHERE email = :e)"), {"e": EMAIL})).scalar_one()
        a = (await s.execute(text("SELECT count(*) FROM audit_logs WHERE event_type = 'admin_login_issue_approve_device'"))).scalar_one()
    assert st == "active" and n >= 1 and a >= 1
    # the old phone is no longer registered: it raises its own fresh request
    held_old = await _login(client, old)
    assert held_old.status_code == 401 and held_old.json()["code"] == "device_approval_pending"
    audit = (await client.get("/api/v1/login-issues/audit", headers=admin)).json()
    assert any(e["event_type"] == "approve_device" for e in audit)
    await _reset_officer()


async def test_reject_needs_note_and_blocks_retries(client):
    await _reset_officer()
    old, new = f"dev-old-{uuid.uuid4().hex[:8]}", f"dev-new-{uuid.uuid4().hex[:8]}"
    await _login(client, old)
    await _login(client, new, "Redmi")
    admin = await _admin(client)
    row = next(r for r in (await client.get("/api/v1/login-issues?status_filter=pending", headers=admin)).json() if r["attempted_device_id"] == new)
    assert (await client.post(f"/api/v1/login-issues/{row['id']}/action", headers=admin, json={"action": "reject"})).status_code == 400
    assert (await client.post(f"/api/v1/login-issues/{row['id']}/action", headers=admin, json={"action": "authorize_login"})).status_code == 400
    res = await client.post(f"/api/v1/login-issues/{row['id']}/action", headers=admin, json={"action": "reject", "note": "Not your phone"})
    assert res.status_code == 200 and res.json()["status"] == "rejected"
    held = await _login(client, new)
    assert held.json()["code"] == "device_approval_rejected" and "Not your phone" in held.json()["message"]
    await _reset_officer()


async def test_inactive_account_request_and_authorize(client):
    await _reset_officer()
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET is_active = false WHERE email = :e"), {"e": EMAIL})
        await s.commit()
    res = await _login(client, "dev-x", "Pixel")
    assert res.status_code == 403
    admin = await _admin(client)
    row = next(r for r in (await client.get("/api/v1/login-issues?status_filter=pending", headers=admin)).json() if r["issue_type"] == "account_inactive")
    assert row["account_active"] is False
    ok = await client.post(f"/api/v1/login-issues/{row['id']}/action", headers=admin, json={"action": "authorize_login"})
    assert ok.status_code == 200
    assert (await _login(client, "dev-x")).status_code == 200
    await _reset_officer()

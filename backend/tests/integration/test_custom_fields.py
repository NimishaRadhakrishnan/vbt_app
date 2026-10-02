import uuid
import os
import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import text, create_engine
from app.main import app
from app.application.services import custom_field_service
import jwt
from app.infrastructure.config.settings import Settings

FO_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
SO_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000002")
ADMIN_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER','vbt')}:{os.getenv('POSTGRES_PASSWORD','vbt')}"
    f"@{os.getenv('POSTGRES_HOST','127.0.0.1')}:{os.getenv('POSTGRES_PORT','5432')}/{os.getenv('POSTGRES_DB','vbt')}"
)

@pytest.fixture(scope="module")
def engine():
    eng = create_engine(DB_URL)
    yield eng
    eng.dispose()

def get_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "role": "field_officer", "type": "access", "iat": now, "exp": now + timedelta(days=1)}
    return jwt.encode(payload, Settings().jwt_secret_key, algorithm="HS256")

def get_so_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "role": "sales_officer", "type": "access", "iat": now, "exp": now + timedelta(days=1)}
    return jwt.encode(payload, Settings().jwt_secret_key, algorithm="HS256")

def get_admin_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "role": "admin", "type": "access", "iat": now, "exp": now + timedelta(days=1)}
    return jwt.encode(payload, Settings().jwt_secret_key, algorithm="HS256")


@pytest.fixture(autouse=True)
def clean(engine):
    with engine.begin() as c:
        c.execute(text("DELETE FROM custom_field_answers WHERE submitted_by IN (:fo, :so, :admin)").bindparams(fo=FO_ID, so=SO_ID, admin=ADMIN_ID))
        c.execute(text("DELETE FROM custom_field_definitions"))
        c.execute(text("UPDATE form_config_versions SET version = 1, updated_at = now()"))
        c.execute(text("DELETE FROM sales_closure_details WHERE closure_id IN (SELECT id FROM day_closures WHERE officer_id IN (:fo, :so))").bindparams(fo=FO_ID, so=SO_ID))
        c.execute(text("DELETE FROM day_closures WHERE officer_id IN (:fo, :so)").bindparams(fo=FO_ID, so=SO_ID))
        c.execute(text("DELETE FROM visits WHERE user_id IN (:fo, :so)").bindparams(fo=FO_ID, so=SO_ID))
        # Scoped to farmers THIS module created. A blanket
        # "DELETE FROM farmers WHERE name = 'Test Farmer'" reached into other
        # modules' rows; with visits still pointing at them the delete tripped
        # check_visit_target and took eight unrelated tests down with it.
        c.execute(
            text(
                "DELETE FROM farmers WHERE name = 'Test Farmer' AND created_by IN (:fo, :so, :admin)"
            ).bindparams(fo=FO_ID, so=SO_ID, admin=ADMIN_ID)
        )
        
        for uid in (FO_ID, SO_ID, ADMIN_ID):
            c.execute(text("DELETE FROM attendance WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM visits WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM tasks WHERE assigned_to = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM day_closures WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM crop_issues WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM leave_requests WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM audit_logs WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_locations WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM device_registry WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM user_territories WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM weekly_plans WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM notifications WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM expenses WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM enquiries WHERE reported_by = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM personal_bests WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM user_badges WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM attendance WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM visits WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM tasks WHERE assigned_to = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM day_closures WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM crop_issues WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM leave_requests WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM audit_logs WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_locations WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM device_registry WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM user_territories WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM weekly_plans WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM notifications WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM expenses WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM enquiries WHERE reported_by = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM personal_bests WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM user_badges WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM users WHERE id = :uid").bindparams(uid=uid))
        
        for uid, role, email in (
            (FO_ID, "field_officer", "fo@test.local"),
            (SO_ID, "sales_officer", "so@test.local"),
            (ADMIN_ID, "admin", "admin@test.local"),
        ):
            c.execute(
                text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                        VALUES (:id,:e,'Test User',:r,'x',true)""").bindparams(id=uid, e=email, r=role)
            )
    yield

@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c

def _build_fo_closure_payload() -> dict:
    return {
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
        "custom_field_answers": {}
    }


def test_transactional_rollback_on_custom_field_error(engine, monkeypatch, client):
    token = get_token(FO_ID)
    
    def mock_save(*args, **kwargs):
        raise ValueError("Simulated DB error during custom fields insert")
    monkeypatch.setattr(custom_field_service, "validate_and_save_custom_answers", mock_save)

    payload = _build_fo_closure_payload()

    response = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 500 or response.status_code == 400
    
    with engine.connect() as conn:
        res = conn.execute(text("SELECT count(*) FROM day_closures WHERE officer_id = :o_id"), {"o_id": FO_ID}).scalar()
        assert res == 0, "Closure was not rolled back!"
        res_v = conn.execute(text("SELECT count(*) FROM visits WHERE user_id = :o_id"), {"o_id": FO_ID}).scalar()
        assert res_v == 0, "Visit was not rolled back!"


def test_stale_config_relaxation(engine, client):
    admin_token = get_admin_token(ADMIN_ID)
    
    res_create = client.post("/api/v1/admin/custom-fields/day_closure", json={
        "section": "default",
        "label": "Stale Label",
        "field_type": "text",
        "is_required": False,
        "is_enabled": True,
        "visible_to_field_officer": True,
        "visible_to_sales_officer": True
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res_create.status_code == 201
    stale_key = res_create.json()["field_key"]

    res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    server_version = res.json()["version"]

    client.delete(f"/api/v1/admin/custom-fields/day_closure/{stale_key}", headers={"Authorization": f"Bearer {admin_token}"})

    new_res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    new_server_version = new_res.json()["version"]
    assert new_server_version > server_version

    payload = _build_fo_closure_payload()
    payload["config_version"] = server_version
    payload["custom_field_answers"] = {stale_key: "I am late"}

    res2 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res2.status_code == 201, res2.text


def test_current_config_strictness(engine, client):
    admin_token = get_admin_token(ADMIN_ID)

    res_create = client.post("/api/v1/admin/custom-fields/day_closure", json={
        "section": "default",
        "label": "Strict Label",
        "field_type": "text",
        "is_required": True,
        "is_enabled": True,
        "visible_to_field_officer": True,
        "visible_to_sales_officer": True
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res_create.status_code == 201
    strict_key = res_create.json()["field_key"]

    res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    server_version = res.json()["version"]

    payload = _build_fo_closure_payload()
    payload["config_version"] = server_version
    payload["custom_field_answers"] = {} 

    res2 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res2.status_code == 400


def test_submit_with_custom_answers_success(engine, client):
    admin_token = get_admin_token(ADMIN_ID)

    res_create = client.post("/api/v1/admin/custom-fields/day_closure", json={
        "section": "default",
        "label": "Valid Label",
        "field_type": "text",
        "is_required": False,
        "is_enabled": True,
        "visible_to_field_officer": True,
        "visible_to_sales_officer": True
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res_create.status_code == 201
    valid_key = res_create.json()["field_key"]

    res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    server_version = res.json()["version"]

    payload = _build_fo_closure_payload()
    payload["config_version"] = server_version
    payload["custom_field_answers"] = {valid_key: "Test Answer"}

    res2 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res2.status_code == 201, res2.text

    with engine.connect() as conn:
        visit_id = conn.execute(text("SELECT id FROM visits WHERE user_id = :u"), {"u": FO_ID}).scalar()
        ans = conn.execute(text("SELECT value FROM custom_field_answers WHERE record_id = :v AND field_key = :k"), {"v": visit_id, "k": valid_key}).scalar()
        assert ans == "Test Answer"


def test_reject_invisible_field_for_role(engine, client):
    admin_token = get_admin_token(ADMIN_ID)

    res_create = client.post("/api/v1/admin/custom-fields/day_closure", json={
        "section": "default",
        "label": "Invisible Key",
        "field_type": "text",
        "is_required": False,
        "is_enabled": True,
        "visible_to_field_officer": False,
        "visible_to_sales_officer": True
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res_create.status_code == 201
    invisible_key = res_create.json()["field_key"]

    res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    server_version = res.json()["version"]

    payload = _build_fo_closure_payload()
    payload["config_version"] = server_version
    payload["custom_field_answers"] = {invisible_key: "I saw this"}

    res2 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res2.status_code == 400


def test_reject_deleted_field_current_version(engine, client):
    admin_token = get_admin_token(ADMIN_ID)

    res_create = client.post("/api/v1/admin/custom-fields/day_closure", json={
        "section": "default",
        "label": "Deleted Key",
        "field_type": "text",
        "is_required": False,
        "is_enabled": True,
        "visible_to_field_officer": True,
        "visible_to_sales_officer": True
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res_create.status_code == 201
    deleted_key = res_create.json()["field_key"]

    client.delete(f"/api/v1/admin/custom-fields/day_closure/{deleted_key}", headers={"Authorization": f"Bearer {admin_token}"})

    res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    server_version = res.json()["version"]

    payload = _build_fo_closure_payload()
    payload["config_version"] = server_version
    payload["custom_field_answers"] = {deleted_key: "Deleted Answer"}

    res2 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res2.status_code == 400


def test_custom_fields_idempotency(engine, client):
    """
    Submitting custom answers for the same record twice (e.g. offline queue replay)
    does not create duplicate visits or duplicate custom field answers.
    The router explicitly blocks duplicate day closures with a 400.
    """
    admin_token = get_admin_token(ADMIN_ID)
    client.post("/api/v1/admin/custom-fields/day_closure", json={
        "section": "default", "label": "Idempotent Key", "field_type": "text",
        "is_required": False, "is_enabled": True, "visible_to_field_officer": True,
        "visible_to_sales_officer": True
    }, headers={"Authorization": f"Bearer {admin_token}"})
    
    res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    server_version = res.json()["version"]
    key = [f for f in res.json()["fields"] if f["label"] == "Idempotent Key"][0]["field_key"]

    payload = _build_fo_closure_payload()
    payload["config_version"] = server_version
    payload["custom_field_answers"] = {key: "First Value"}
    
    # First submit
    res1 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res1.status_code == 201

    with engine.connect() as conn:
        visit_count_1 = conn.execute(text("SELECT count(*) FROM visits WHERE user_id = :u"), {"u": FO_ID}).scalar()
        ans_count_1 = conn.execute(text("SELECT count(*) FROM custom_field_answers")).scalar()
        
    # Second submit (offline queue replay)
    res2 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res2.status_code == 201
    
    # Assert visit ID is the same
    assert res2.json()["visit_id"] == res1.json()["visit_id"]

    with engine.connect() as conn:
        visit_count_2 = conn.execute(text("SELECT count(*) FROM visits WHERE user_id = :u"), {"u": FO_ID}).scalar()
        ans_count_2 = conn.execute(text("SELECT count(*) FROM custom_field_answers")).scalar()
        
        assert visit_count_2 == visit_count_1
        assert ans_count_2 == ans_count_1
        assert visit_count_2 == 1
        assert ans_count_2 == 1

def test_type_validation_rejects_invalid(engine, client):
    """
    Submitting an invalid value for a strongly-typed field (like number) is rejected.
    """
    admin_token = get_admin_token(ADMIN_ID)
    client.post("/api/v1/admin/custom-fields/day_closure", json={
        "section": "default", "label": "Number Key", "field_type": "number",
        "is_required": False, "is_enabled": True, "visible_to_field_officer": True,
        "visible_to_sales_officer": True
    }, headers={"Authorization": f"Bearer {admin_token}"})
    
    res = client.get("/api/v1/custom-fields/day_closure", headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    server_version = res.json()["version"]
    key = [f for f in res.json()["fields"] if f["label"] == "Number Key"][0]["field_key"]

    payload = _build_fo_closure_payload()
    payload["config_version"] = server_version
    payload["custom_field_answers"] = {key: "not-a-number"}
    
    res1 = client.post("/api/v1/day-closure", json=payload, headers={"Authorization": f"Bearer {get_token(FO_ID)}"})
    assert res1.status_code == 400
    assert "Invalid number" in res1.text

import re
import ast


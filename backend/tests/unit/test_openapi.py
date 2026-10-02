from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_openapi_schema_generates_without_errors():
    """Ensure app.openapi() generates cleanly without raising Pydantic/schema errors."""
    schema = app.openapi()
    assert schema is not None
    assert "paths" in schema


def test_openapi_endpoint_status_200():
    """Ensure /openapi.json endpoint responds with 200 OK."""
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.status_code == 200

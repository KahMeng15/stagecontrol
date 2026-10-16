import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

# In-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def test_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def client(test_db):
    def override_get_db():
        try:
            yield test_db
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

def test_public_pin_workflow(client):
    # 1. Register Admin and create an event
    res_admin = client.post("/api/auth/register", json={
        "username": "eventlead",
        "email": "lead@event.org",
        "full_name": "Event Lead",
        "password": "Password123!"
    })
    admin_token = res_admin.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    create_res = client.post("/api/events", json={
        "name": "Spring Commencement 2026",
        "slug": "commencement-26"
    }, headers=admin_headers)
    assert create_res.status_code == 201
    event_id = create_res.json()["id"]

    # 2. Admin enables and generates a 6-digit public PIN
    pin_res = client.post(f"/api/events/{event_id}/public-pin", headers=admin_headers)
    assert pin_res.status_code == 200
    pin_data = pin_res.json()
    assert pin_data["public_pin_enabled"] is True
    pin = pin_data["public_pin"]
    assert pin is not None
    assert len(pin) == 6
    assert pin.isdigit()

    # 3. Guest checks public info without any auth header
    info_res = client.get(f"/api/events/public/info/{pin}")
    assert info_res.status_code == 200
    assert info_res.json()["name"] == "Spring Commencement 2026"

    # 4. Guest joins using the 6-digit PIN and nickname (no registration required)
    guest_join_res = client.post("/api/events/public/join", json={
        "pin": pin,
        "display_name": "Audience - Hall A"
    })
    assert guest_join_res.status_code == 200
    guest_data = guest_join_res.json()
    assert "access_token" in guest_data
    assert guest_data["display_name"] == "Audience - Hall A"
    guest_token = guest_data["access_token"]
    guest_headers = {"Authorization": f"Bearer {guest_token}"}

    # 5. Guest accesses event control room / view page
    guest_event_res = client.get(f"/api/events/{event_id}", headers=guest_headers)
    assert guest_event_res.status_code == 200
    ev = guest_event_res.json()
    assert ev["user_role"] == "viewer"
    assert ev["stream_key"] is None      # Secret stream key is protected
    assert ev["public_pin"] is None      # Admin PIN management is hidden

    # 6. Guest attempts to invite a member (Forbidden 403)
    guest_invite_res = client.post(f"/api/events/{event_id}/members", json={
        "username_or_email": "someone",
        "role": "crew"
    }, headers=guest_headers)
    assert guest_invite_res.status_code == 403

    # 7. Admin revokes the 6-digit public PIN
    revoke_res = client.delete(f"/api/events/{event_id}/public-pin", headers=admin_headers)
    assert revoke_res.status_code == 200
    assert revoke_res.json()["public_pin_enabled"] is False
    assert revoke_res.json()["public_pin"] is None

    # 8. Check that join with old PIN now fails (404)
    old_pin_join = client.post("/api/events/public/join", json={
        "pin": pin,
        "display_name": "Late Guest"
    })
    assert old_pin_join.status_code == 404

    # 9. Existing guest token is now rejected because PIN access is revoked (403)
    revoked_guest_res = client.get(f"/api/events/{event_id}", headers=guest_headers)
    assert revoked_guest_res.status_code == 403
    assert "revoked" in revoked_guest_res.json()["detail"].lower()

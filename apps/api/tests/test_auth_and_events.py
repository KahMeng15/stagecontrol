import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, get_db
from app.main import app

from sqlalchemy.pool import StaticPool

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

def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

def test_register_and_login(client):
    # 1. Register first user (should automatically be superadmin)
    res = client.post("/api/auth/register", json={
        "username": "stagemanager",
        "email": "sm@example.com",
        "full_name": "Stage Manager Lead",
        "password": "Password123!"
    })
    assert res.status_code == 201
    data = res.json()
    assert "access_token" in data
    assert data["user"]["username"] == "stagemanager"
    assert data["user"]["is_superadmin"] is True

    # 2. Login with valid password
    login_res = client.post("/api/auth/login", json={
        "username_or_email": "stagemanager",
        "password": "Password123!"
    })
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]

    # 3. Access /api/auth/me
    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "sm@example.com"

    # 4. Login with wrong password
    fail_res = client.post("/api/auth/login", json={
        "username_or_email": "stagemanager",
        "password": "WrongPassword!"
    })
    assert fail_res.status_code == 401

def test_event_creation_and_rbac(client):
    # Register Admin user
    res_admin = client.post("/api/auth/register", json={
        "username": "adminuser",
        "email": "admin@example.com",
        "full_name": "Event Admin",
        "password": "AdminPassword123!"
    })
    admin_token = res_admin.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Register Crew user
    res_crew = client.post("/api/auth/register", json={
        "username": "crewmember",
        "email": "crew@example.com",
        "full_name": "Lighting Operator",
        "password": "CrewPassword123!"
    })
    crew_token = res_crew.json()["access_token"]
    crew_headers = {"Authorization": f"Bearer {crew_token}"}

    # Register Outsider user
    res_outsider = client.post("/api/auth/register", json={
        "username": "outsider",
        "email": "outsider@example.com",
        "full_name": "Random Person",
        "password": "OutsiderPassword123!"
    })
    outsider_token = res_outsider.json()["access_token"]
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    # 1. Admin creates an event
    create_res = client.post("/api/events", json={
        "name": "Annual Awards Gala",
        "slug": "gala-2026",
        "description": "Main stage university gala"
    }, headers=admin_headers)
    assert create_res.status_code == 201
    event_data = create_res.json()
    event_id = event_data["id"]
    assert event_data["name"] == "Annual Awards Gala"
    assert event_data["slug"] == "gala-2026"
    assert event_data["user_role"] == "admin"
    assert event_data["stream_key"] is not None

    # 2. Admin invites crew member as 'crew'
    invite_res = client.post(f"/api/events/{event_id}/members", json={
        "username_or_email": "crewmember",
        "role": "crew",
        "callsign": "Lights Lead"
    }, headers=admin_headers)
    assert invite_res.status_code == 201
    assert invite_res.json()["role"] == "crew"

    # 3. Crew member accesses the event: can view, but stream_key is hidden from crew
    crew_event_res = client.get(f"/api/events/{event_id}", headers=crew_headers)
    assert crew_event_res.status_code == 200
    assert crew_event_res.json()["user_role"] == "crew"
    assert crew_event_res.json()["stream_key"] is None

    # 4. Crew member attempts to delete the event (should be forbidden 403)
    crew_delete_res = client.delete(f"/api/events/{event_id}", headers=crew_headers)
    assert crew_delete_res.status_code == 403

    # 5. Outsider attempts to access the event (should be forbidden 403 - Event Isolation)
    outsider_event_res = client.get(f"/api/events/{event_id}", headers=outsider_headers)
    assert outsider_event_res.status_code == 403
    assert "access" in outsider_event_res.json()["detail"].lower()

    # 6. Crew member attempts to invite another person (should be forbidden 403)
    crew_invite_res = client.post(f"/api/events/{event_id}/members", json={
        "username_or_email": "outsider",
        "role": "viewer"
    }, headers=crew_headers)
    assert crew_invite_res.status_code == 403

    # 7. Admin updates crew member role to stage_manager
    member_id = invite_res.json()["id"]
    update_role_res = client.patch(
        f"/api/events/{event_id}/members/{member_id}",
        json={"role": "stage_manager", "callsign": "SM-2"},
        headers=admin_headers
    )
    assert update_role_res.status_code == 200
    assert update_role_res.json()["role"] == "stage_manager"
    assert update_role_res.json()["callsign"] == "SM-2"

    # Now promoted member CAN see the stream_key!
    sm_event_res = client.get(f"/api/events/{event_id}", headers=crew_headers)
    assert sm_event_res.status_code == 200
    assert sm_event_res.json()["stream_key"] is not None

    # 8. Admin regenerates stream key
    old_key = sm_event_res.json()["stream_key"]
    regen_res = client.post(f"/api/events/{event_id}/regenerate-stream-key", headers=admin_headers)
    assert regen_res.status_code == 200
    assert regen_res.json()["stream_key"] != old_key

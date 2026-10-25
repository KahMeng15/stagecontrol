import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app

TEST_DATABASE_URL = "sqlite:////storage/db/test_admin_users.db"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="module")
def test_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="module")
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

def test_registration_modes_and_admin_workflow(client):
    # 1. Register first user (automatically superadmin)
    res_admin = client.post("/api/auth/register", json={
        "email": "lead@event.org",
        "full_name": "Lead Admin",
        "password": "Password123!"
    }, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/122.0.0.0"})
    assert res_admin.status_code == 201
    admin_data = res_admin.json()
    assert admin_data["user"]["is_superadmin"] is True
    assert admin_data["user"]["approval_status"] == "approved"
    admin_token = admin_data["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Verify admin logon tracking
    assert admin_data["user"]["last_login_device"] == "macOS"
    assert admin_data["user"]["last_login_browser"] == "Chrome"

    # 2. Set registration mode to "closed"
    set_closed = client.put("/api/settings", json={"registration_mode": "closed"}, headers=admin_headers)
    assert set_closed.status_code == 200
    assert set_closed.json()["registration_mode"] == "closed"

    # Check public registration-mode endpoint
    pub_mode = client.get("/api/auth/registration-mode")
    assert pub_mode.status_code == 200
    assert pub_mode.json()["registration_mode"] == "closed"

    # Attempting to register in closed mode should fail with 403
    closed_reg = client.post("/api/auth/register", json={
        "email": "intruder@event.org",
        "full_name": "Intruder",
        "password": "Password123!"
    })
    assert closed_reg.status_code == 403
    assert "closed" in closed_reg.json()["detail"].lower()

    # 3. Set registration mode to "approval"
    set_approval = client.put("/api/settings", json={"registration_mode": "approval"}, headers=admin_headers)
    assert set_approval.status_code == 200
    assert set_approval.json()["registration_mode"] == "approval"

    # Register in approval mode
    appr_reg = client.post("/api/auth/register", json={
        "email": "applicant@event.org",
        "full_name": "Applicant Alex",
        "password": "Password123!"
    })
    assert appr_reg.status_code == 201
    appr_data = appr_reg.json()
    assert appr_data["requires_approval"] is True
    assert appr_data["access_token"] == ""
    assert appr_data["user"]["approval_status"] == "pending"
    assert appr_data["user"]["is_active"] is False
    applicant_id = appr_data["user"]["id"]

    # Attempting to login while pending approval should fail with 403
    appr_login = client.post("/api/auth/login", json={
        "email": "applicant@event.org",
        "password": "Password123!"
    })
    assert appr_login.status_code == 403
    assert "awaiting administrator approval" in appr_login.json()["detail"].lower()

    # 4. Admin approves applicant
    approve_res = client.patch(f"/api/admin/users/{applicant_id}/status", json={
        "approval_status": "approved"
    }, headers=admin_headers)
    assert approve_res.status_code == 200
    assert approve_res.json()["approval_status"] == "approved"
    assert approve_res.json()["is_active"] is True

    # Now applicant can log in!
    applicant_login = client.post("/api/auth/login", json={
        "email": "applicant@event.org",
        "password": "Password123!"
    }, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1"})
    assert applicant_login.status_code == 200
    assert applicant_login.json()["user"]["last_login_device"] == "iPhone"
    assert applicant_login.json()["user"]["last_login_browser"] == "Safari"

    # 5. Admin User CRUD
    # Admin directly creates user
    create_user_res = client.post("/api/admin/users", json={
        "email": "direct@event.org",
        "full_name": "Direct Crew Member",
        "password": "PasswordDirect123!",
        "is_superadmin": False
    }, headers=admin_headers)
    assert create_user_res.status_code == 201
    direct_user_id = create_user_res.json()["id"]

    # Test login with direct user
    direct_login = client.post("/api/auth/login", json={
        "email": "direct@event.org",
        "password": "PasswordDirect123!"
    })
    assert direct_login.status_code == 200

    # Admin views user login logs
    logs_res = client.get(f"/api/admin/users/{direct_user_id}/logs", headers=admin_headers)
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert len(logs) >= 1

    # Admin updates user name and password
    update_res = client.patch(f"/api/admin/users/{direct_user_id}", json={
        "full_name": "Updated Direct Name",
        "password": "NewPassword456!"
    }, headers=admin_headers)
    assert update_res.status_code == 200
    assert update_res.json()["full_name"] == "Updated Direct Name"

    # Verify login with new password
    new_pw_login = client.post("/api/auth/login", json={
        "email": "direct@event.org",
        "password": "NewPassword456!"
    })
    assert new_pw_login.status_code == 200

    # Admin disables user
    disable_res = client.patch(f"/api/admin/users/{direct_user_id}/status", json={
        "is_active": False
    }, headers=admin_headers)
    assert disable_res.status_code == 200
    assert disable_res.json()["is_active"] is False

    # Disabled user cannot login
    disabled_login = client.post("/api/auth/login", json={
        "email": "direct@event.org",
        "password": "NewPassword456!"
    })
    assert disabled_login.status_code == 403

    # Admin guards: cannot disable self
    admin_id = admin_data["user"]["id"]
    self_disable = client.patch(f"/api/admin/users/{admin_id}/status", json={
        "is_active": False
    }, headers=admin_headers)
    assert self_disable.status_code == 400

    # Admin guards: cannot delete self
    self_delete = client.delete(f"/api/admin/users/{admin_id}", headers=admin_headers)
    assert self_delete.status_code == 400

    # Delete the direct user
    delete_res = client.delete(f"/api/admin/users/{direct_user_id}", headers=admin_headers)
    assert delete_res.status_code == 200


import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

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

def test_settings_permissions_and_update(client):
    # 1. Register first user (automatically superadmin)
    res_admin = client.post("/api/auth/register", json={
        "username": "leadadmin",
        "email": "lead@event.org",
        "password": "Password123!"
    })
    admin_token = res_admin.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2. Register regular user (not superadmin)
    res_crew = client.post("/api/auth/register", json={
        "username": "crewregular",
        "email": "crew@event.org",
        "password": "Password123!"
    })
    crew_token = res_crew.json()["access_token"]
    crew_headers = {"Authorization": f"Bearer {crew_token}"}

    # 3. Regular user queries settings -> OK
    get_res = client.get("/api/settings", headers=crew_headers)
    assert get_res.status_code == 200
    assert "primary_domain" in get_res.json()

    # 4. Regular user attempts to update settings -> 403 Forbidden
    fail_update = client.put("/api/settings", json={
        "primary_domain": "https://hacked.com"
    }, headers=crew_headers)
    assert fail_update.status_code == 403

    # 5. Superadmin updates primary domain and alternative LAN domain
    success_update = client.put("/api/settings", json={
        "primary_domain": "stage.university.edu/",
        "alternative_domain": "http://192.168.1.100:3000/"
    }, headers=admin_headers)
    assert success_update.status_code == 200
    data = success_update.json()
    assert data["primary_domain"] == "https://stage.university.edu"
    assert data["alternative_domain"] == "http://192.168.1.100:3000"

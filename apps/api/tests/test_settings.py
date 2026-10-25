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

def test_transcription_settings_and_models(client):
    # 1. Register superadmin
    res_admin = client.post("/api/auth/register", json={
        "username": "soundengineer",
        "email": "sound@event.org",
        "password": "Password123!"
    })
    token = res_admin.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get transcription settings
    res = client.get("/api/settings/transcription", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "active_model" in data
    assert "active_model_name" in data
    assert data["singleton_shared"] is True
    assert set(data["restricted_languages"]) == {"en", "ms", "zh"}
    assert len(data["models"]) >= 6

    # Verify Mesolitica and Stock Whisper models exist in catalog
    model_ids = [m["id"] for m in data["models"]]
    assert "mesolitica-large-v3-turbo" in model_ids
    assert "whisper-large-v3-turbo" in model_ids
    assert "whisper-large-v3" in model_ids
    assert "whisper-tiny" in model_ids

    # 3. Trigger download test for tiny
    res_dl = client.post("/api/settings/transcription/download", json={
        "model_id": "whisper-tiny"
    }, headers=headers)
    assert res_dl.status_code == 200
    assert res_dl.json()["status"] == "downloading"

    # 4. Activate tiny (already on disk in test env)
    res_act = client.post("/api/settings/transcription/activate", json={
        "model_id": "whisper-tiny"
    }, headers=headers)
    assert res_act.status_code == 200
    assert "Systran/faster-whisper-tiny" in res_act.json()["active_model"]

    # 5. Cannot delete active model
    res_del = client.delete("/api/settings/transcription/models/whisper-tiny", headers=headers)
    assert res_del.status_code == 400
    assert "Cannot delete the currently active model" in res_del.json()["detail"]

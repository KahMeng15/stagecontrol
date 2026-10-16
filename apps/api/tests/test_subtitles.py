import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models.enums import EventRole
from app.models.event import Event
from app.models.membership import Membership
from app.models.subtitle import Subtitle
from app.models.user import User
from app.core.security import hash_password, create_access_token

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

def test_subtitles_crud_and_status(client, test_db):
    # Setup test user and event
    user = User(
        id="user-sm-1",
        username="stagemanager",
        email="sm@stagecontrol.io",
        full_name="StageManager",
        hashed_password=hash_password("password123")
    )
    test_db.add(user)
    
    event = Event(
        id="event-transcribe-1",
        name="Tech Rehearsal",
        slug="tech-reh-1",
        stream_key="sk_test_transcribe_key"
    )
    test_db.add(event)
    
    membership = Membership(
        id="mem-sm-1",
        user_id=user.id,
        event_id=event.id,
        role=EventRole.STAGE_MANAGER.value,
        callsign="SM Lead"
    )
    test_db.add(membership)
    test_db.commit()

    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Check initial status
    res = client.get(f"/api/events/{event.id}/subtitles/status", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["event_id"] == event.id
    assert "Mesolitica" in data["model_name"]
    assert data["subtitles_count"] == 0

    # 2. Add sample subtitles in DB
    sub1 = Subtitle(
        id="sub-1",
        event_id=event.id,
        stream_key=event.stream_key,
        text="Selamat petang semua, testing sound check satu dua.",
        language="ms",
        start_seconds=0.0,
        end_seconds=3.0,
        created_at=datetime.now(timezone.utc)
    )
    sub2 = Subtitle(
        id="sub-2",
        event_id=event.id,
        stream_key=event.stream_key,
        text="Okay boleh standby cue light sekarang.",
        language="ms",
        start_seconds=3.2,
        end_seconds=5.8,
        created_at=datetime.now(timezone.utc)
    )
    test_db.add_all([sub1, sub2])
    test_db.commit()

    # 3. Retrieve subtitles
    res = client.get(f"/api/events/{event.id}/subtitles", headers=headers)
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 2
    texts = [i["text"] for i in items]
    assert any("Selamat petang" in t for t in texts)
    assert any("standby cue" in t for t in texts)

    # 4. Search subtitles
    res = client.get(f"/api/events/{event.id}/subtitles?search=standby", headers=headers)
    assert res.status_code == 200
    filtered = res.json()
    assert len(filtered) == 1
    assert "standby cue" in filtered[0]["text"]

    # 5. Clear subtitles
    res = client.delete(f"/api/events/{event.id}/subtitles", headers=headers)
    assert res.status_code == 200
    res = client.get(f"/api/events/{event.id}/subtitles", headers=headers)
    assert len(res.json()) == 0

import pytest
import wave
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.config import WALKIE_DIR
from app.models.enums import EventRole
from app.models.event import Event
from app.models.membership import Membership
from app.models.user import User
from app.models.walkie import WalkieCall
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

def test_walkie_rbac_and_calls_crud(client, test_db, tmp_path):
    # Setup test users: SM, Crew, Viewer
    sm_user = User(
        id="user-sm-1",
        username="stagemanager",
        email="sm@stagecontrol.io",
        full_name="Stage Manager Sarah",
        hashed_password=hash_password("password123")
    )
    crew_user = User(
        id="user-crew-1",
        username="crewmember",
        email="crew@stagecontrol.io",
        full_name="Audio Op Mike",
        hashed_password=hash_password("password123")
    )
    viewer_user = User(
        id="user-viewer-1",
        username="viewer",
        email="viewer@stagecontrol.io",
        full_name="Audience Viewer",
        hashed_password=hash_password("password123")
    )
    test_db.add_all([sm_user, crew_user, viewer_user])

    event = Event(
        id="event-walkie-1",
        name="Annual Gala Rehearsal",
        slug="gala-reh",
        stream_key="sk_gala_reh_123"
    )
    test_db.add(event)

    test_db.add(Membership(
        id="mem-sm-1",
        user_id=sm_user.id,
        event_id=event.id,
        role=EventRole.STAGE_MANAGER.value
    ))
    test_db.add(Membership(
        id="mem-crew-1",
        user_id=crew_user.id,
        event_id=event.id,
        role=EventRole.CREW.value
    ))
    test_db.add(Membership(
        id="mem-viewer-1",
        user_id=viewer_user.id,
        event_id=event.id,
        role=EventRole.VIEWER.value
    ))
    test_db.commit()

    sm_token = create_access_token(sm_user.id, extra_claims={"sub": sm_user.id, "email": sm_user.email})
    crew_token = create_access_token(crew_user.id, extra_claims={"sub": crew_user.id, "email": crew_user.email})
    viewer_token = create_access_token(viewer_user.id, extra_claims={"sub": viewer_user.id, "email": viewer_user.email})

    sm_headers = {"Authorization": f"Bearer {sm_token}"}
    crew_headers = {"Authorization": f"Bearer {crew_token}"}
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    # 1. RBAC: Viewer should be FORBIDDEN (403) from accessing Walkie-Talkie
    res = client.get(f"/api/events/{event.id}/walkie-talkie/status", headers=viewer_headers)
    assert res.status_code == 403

    # 2. Crew should be ALLOWED (200)
    res = client.get(f"/api/events/{event.id}/walkie-talkie/status", headers=crew_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["event_id"] == event.id
    assert data["voice_room"] == f"{event.slug}-comms"
    assert data["total_calls"] == 0

    # 3. Create dummy call audio on disk
    event_dir = WALKIE_DIR / event.id
    event_dir.mkdir(parents=True, exist_ok=True)
    call_id = "test-call-123"
    wav_path = event_dir / f"{call_id}.wav"
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b"\x00\x00" * 16000)  # 1 second of silence

    # Add call in database
    call = WalkieCall(
        id=call_id,
        event_id=event.id,
        caller_id=crew_user.id,
        caller_name=crew_user.full_name,
        caller_role="crew",
        audio_path=f"walkie_talkie/{event.id}/{call_id}.wav",
        duration_seconds=1.0,
        file_size_bytes=wav_path.stat().st_size,
        transcription="Standby lights for cue 4",
        language="en",
        status="completed",
        created_at=datetime.now(timezone.utc)
    )
    test_db.add(call)
    test_db.commit()

    # 4. List calls as Crew
    res = client.get(f"/api/events/{event.id}/walkie-talkie/calls", headers=crew_headers)
    assert res.status_code == 200
    calls_list = res.json()
    assert len(calls_list) == 1
    assert calls_list[0]["id"] == call_id
    assert calls_list[0]["caller_name"] == "Audio Op Mike"
    assert calls_list[0]["transcription"] == "Standby lights for cue 4"
    assert calls_list[0]["duration_seconds"] == 1.0

    # 5. Stream call audio with query token
    res = client.get(f"/api/events/{event.id}/walkie-talkie/calls/{call_id}/audio?token={crew_token}")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert len(res.content) > 0

    # 6. Delete call (Stage Manager permitted, Crew forbidden)
    res = client.delete(f"/api/events/{event.id}/walkie-talkie/calls/{call_id}", headers=crew_headers)
    assert res.status_code == 403

    res = client.delete(f"/api/events/{event.id}/walkie-talkie/calls/{call_id}", headers=sm_headers)
    assert res.status_code == 200
    assert not wav_path.exists()

    # Verify call deleted
    res = client.get(f"/api/events/{event.id}/walkie-talkie/calls", headers=crew_headers)
    assert len(res.json()) == 0

def test_walkie_websocket_realtime_broadcast(client, test_db):
    user = User(
        id="user-walkie-ws",
        username="radioman",
        email="radio@stagecontrol.io",
        full_name="Radio Operator",
        hashed_password=hash_password("password123")
    )
    test_db.add(user)

    event = Event(
        id="event-ws-walkie",
        name="Show Day 1",
        slug="show-day-1",
        stream_key="sk_show_day_1"
    )
    test_db.add(event)

    test_db.add(Membership(
        id="mem-radio-1",
        user_id=user.id,
        event_id=event.id,
        role=EventRole.CREW.value
    ))
    test_db.commit()

    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email})

    # Test WebSocket connection with token
    with client.websocket_connect(f"/api/events/{event.id}/walkie-talkie/ws?token={token}") as ws:
        # Initial connect messages (presence update + connected status)
        msg1 = ws.receive_json()
        msg2 = ws.receive_json()
        types = [msg1["type"], msg2["type"]]
        assert "presence_update" in types
        assert "connected" in types

        # Ping-Pong
        ws.send_text("ping")
        assert ws.receive_text() == "pong"

        # Start Transmission
        tid = "33333333-3333-3333-3333-333333333333"
        ws.send_json({
            "type": "start_transmission",
            "transmission_id": tid
        })

        # Receive presence or incoming transmission message
        start_msg = ws.receive_json()
        assert start_msg["type"] == "incoming_transmission_start"
        assert start_msg["transmission_id"] == tid

        # Send raw audio PCM chunk (36 bytes tid + 64 bytes silence)
        audio_chunk = tid.encode("ascii") + (b"\x00\x00" * 32)
        ws.send_bytes(audio_chunk)

        # End Transmission
        ws.send_json({
            "type": "end_transmission",
            "transmission_id": tid
        })
        end_msg = ws.receive_json()
        assert end_msg["type"] == "incoming_transmission_end"
        assert end_msg["transmission_id"] == tid

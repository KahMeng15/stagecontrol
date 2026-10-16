import os
import shutil
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import RECORDINGS_DIR, settings
from app.database import Base, get_db
from app.main import app
from app.models.enums import EventRole
from app.models.event import Event, generate_stream_key
from app.models.membership import Membership
from app.models.recording import Recording
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

def test_streams_and_recordings_lifecycle(client, test_db):
    # Create test admin user
    user = User(
        username="stream_admin",
        email="stream_admin@stageflow.io",
        hashed_password=hash_password("adminpass123"),
        is_superadmin=True
    )
    test_db.add(user)
    test_db.commit()

    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email, "role": "admin"})

    # Create event
    event = Event(
        name="Annual Gala 2026",
        slug="gala-2026",
        created_by_id=user.id,
        stream_key=generate_stream_key()
    )
    test_db.add(event)
    test_db.commit()

    membership = Membership(
        user_id=user.id,
        event_id=event.id,
        role=EventRole.ADMIN.value,
        callsign="Director"
    )
    test_db.add(membership)
    test_db.commit()

    headers = {"Authorization": f"Bearer {token}"}

    # 1. Test stream status endpoint
    resp = client.get(f"/api/events/{event.id}/stream-status", headers=headers)
    assert resp.status_code == 200
    status_data = resp.json()
    assert "is_live" in status_data
    assert "webrtc_whep_url" in status_data
    assert "hls_playlist_url" in status_data
    assert "rtmp_url" in status_data
    assert status_data["stream_key"] == event.stream_key

    # 2. Simulate automated fMP4 recording written by MediaMTX to disk
    event_rec_dir = RECORDINGS_DIR / "live" / event.stream_key
    event_rec_dir.mkdir(parents=True, exist_ok=True)
    mock_file = event_rec_dir / "2026-10-16_test_take.mp4"
    # Write 100 bytes of mock video content
    mock_content = b"StageFlow Mock Video Content " * 4
    mock_file.write_bytes(mock_content)

    # 3. Test recordings list & auto-sync from filesystem
    resp = client.get(f"/api/events/{event.id}/recordings", headers=headers)
    assert resp.status_code == 200
    recordings_data = resp.json()
    assert len(recordings_data) >= 1
    rec = next(r for r in recordings_data if "test_take" in r["filename"])
    assert rec["file_size_bytes"] == len(mock_content)
    assert rec["status"] == "ready"
    assert "stream_url" in rec
    assert "download_url" in rec
    rec_id = rec["id"]

    # 4. Test HTTP 206 Partial Content Range Streaming
    range_headers = {**headers, "Range": "bytes=0-15"}
    stream_resp = client.get(f"/api/events/{event.id}/recordings/{rec_id}/stream", headers=range_headers)
    assert stream_resp.status_code == 206
    assert stream_resp.headers["Content-Range"] == f"bytes 0-15/{len(mock_content)}"
    assert stream_resp.headers["Accept-Ranges"] == "bytes"
    assert len(stream_resp.content) == 16
    assert stream_resp.content == mock_content[:16]

    # Full stream without range
    full_resp = client.get(f"/api/events/{event.id}/recordings/{rec_id}/stream", headers=headers)
    assert full_resp.status_code == 200
    assert full_resp.content == mock_content

    # 5. Test download endpoint
    dl_resp = client.get(f"/api/events/{event.id}/recordings/{rec_id}/download", headers=headers)
    assert dl_resp.status_code == 200
    assert dl_resp.content == mock_content

    # 6. Test rename recording
    rename_resp = client.patch(
        f"/api/events/{event.id}/recordings/{rec_id}",
        json={"title": "Act 1 Rehearsal Take"},
        headers=headers
    )
    assert rename_resp.status_code == 200
    assert rename_resp.json()["title"] == "Act 1 Rehearsal Take"

    # 7. Test delete recording
    del_resp = client.delete(f"/api/events/{event.id}/recordings/{rec_id}", headers=headers)
    assert del_resp.status_code == 204

    # Verify deleted from DB and disk
    list_after_del = client.get(f"/api/events/{event.id}/recordings", headers=headers).json()
    assert all(r["id"] != rec_id for r in list_after_del)
    assert not mock_file.exists()

    # Clean up mock directory
    if event_rec_dir.exists():
        shutil.rmtree(event_rec_dir, ignore_errors=True)

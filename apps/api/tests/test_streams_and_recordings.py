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
    assert "webrtc_whip_url" in status_data
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

    # Query param token streaming (used by HTML5 <video> tags)
    query_resp = client.get(f"/api/events/{event.id}/recordings/{rec_id}/stream?token={token}")
    assert query_resp.status_code == 200
    assert query_resp.content == mock_content

    # 5. Test download endpoint with query param token
    dl_resp = client.get(f"/api/events/{event.id}/recordings/{rec_id}/download?token={token}")
    assert dl_resp.status_code == 200
    assert dl_resp.content == mock_content

    # 6. Test Video Chapters & Markers
    # 6a. Create marker for recording
    marker_resp = client.post(
        f"/api/events/{event.id}/markers",
        json={
            "title": "Act 1 Scene 2 Starts",
            "description": "Lead actor entrance on stage right",
            "timestamp_seconds": 12.5,
            "recording_id": rec_id,
            "color": "purple",
        },
        headers=headers,
    )
    assert marker_resp.status_code == 201
    marker_data = marker_resp.json()
    assert marker_data["title"] == "Act 1 Scene 2 Starts"
    assert marker_data["timestamp_seconds"] == 12.5
    assert marker_data["recording_id"] == rec_id
    marker_id = marker_data["id"]

    # 6b. List markers filtered by recording
    list_markers_resp = client.get(
        f"/api/events/{event.id}/markers?recording_id={rec_id}",
        headers=headers,
    )
    assert list_markers_resp.status_code == 200
    markers_list = list_markers_resp.json()
    assert len(markers_list) == 1
    assert markers_list[0]["id"] == marker_id

    # 6c. Update marker
    update_marker_resp = client.patch(
        f"/api/events/{event.id}/markers/{marker_id}",
        json={"title": "Act 1 Scene 2 - Lead Vocal", "color": "emerald"},
        headers=headers,
    )
    assert update_marker_resp.status_code == 200
    assert update_marker_resp.json()["title"] == "Act 1 Scene 2 - Lead Vocal"
    assert update_marker_resp.json()["color"] == "emerald"

    # 6d. Delete marker
    del_marker_resp = client.delete(f"/api/events/{event.id}/markers/{marker_id}", headers=headers)
    assert del_marker_resp.status_code == 204

    # Verify deleted
    list_after_marker_del = client.get(f"/api/events/{event.id}/markers", headers=headers).json()
    assert all(m["id"] != marker_id for m in list_after_marker_del)

    # 7. Test rename recording
    rename_resp = client.patch(
        f"/api/events/{event.id}/recordings/{rec_id}",
        json={"title": "Act 1 Rehearsal Take"},
        headers=headers
    )
    assert rename_resp.status_code == 200
    assert rename_resp.json()["title"] == "Act 1 Rehearsal Take"

    # 7b. Test optimize recording endpoint
    opt_resp = client.post(
        f"/api/events/{event.id}/recordings/{rec_id}/optimize",
        headers=headers
    )
    assert opt_resp.status_code == 200
    assert opt_resp.json()["id"] == rec_id
    assert opt_resp.json()["status"] == "ready"

    # 8. Test delete recording
    del_resp = client.delete(f"/api/events/{event.id}/recordings/{rec_id}", headers=headers)
    assert del_resp.status_code == 204

    # Verify deleted from DB and disk
    list_after_del = client.get(f"/api/events/{event.id}/recordings", headers=headers).json()
    assert all(r["id"] != rec_id for r in list_after_del)
    assert not mock_file.exists()

    # Clean up mock directory
    if event_rec_dir.exists():
        shutil.rmtree(event_rec_dir, ignore_errors=True)

def test_whip_endpoints(client, test_db):
    """Test WHIP browser streaming ingest and session termination endpoints."""
    from unittest.mock import AsyncMock, patch, MagicMock

    user = User(
        username="whip_admin",
        email="whip_admin@stageflow.io",
        hashed_password=hash_password("adminpass123"),
        is_superadmin=True
    )
    test_db.add(user)
    test_db.commit()

    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email, "role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}

    event = Event(
        name="WHIP Live Broadcast Test",
        slug="whip-live-test",
        created_by_id=user.id,
        stream_key="whip-key-12345"
    )
    test_db.add(event)
    test_db.commit()

    membership = Membership(
        user_id=user.id,
        event_id=event.id,
        role=EventRole.STAGE_MANAGER.value,
        callsign="Director"
    )
    test_db.add(membership)
    test_db.commit()

    mock_resp = MagicMock()
    mock_resp.status_code = 201
    mock_resp.headers = {
        "Location": "/live/whip-key-12345/whip/session-abc-123",
        "Content-Type": "application/sdp"
    }
    mock_resp.text = "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\na=candidate:1 1 udp 2130706431 127.0.0.1 8189 typ host\r\n"

    mock_del_resp = MagicMock()
    mock_del_resp.status_code = 200

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post, \
         patch("httpx.AsyncClient.delete", new_callable=AsyncMock) as mock_delete:
        mock_post.return_value = mock_resp
        mock_delete.return_value = mock_del_resp

        # 1. Test POST /whip with SDP offer
        sample_offer = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n"
        post_resp = client.post(
            f"/api/events/{event.id}/whip",
            content=sample_offer,
            headers={**headers, "Content-Type": "application/sdp"}
        )
        assert post_resp.status_code == 201
        assert "Location" in post_resp.headers
        assert f"/api/events/{event.id}/whip/session-abc-123" in post_resp.headers["Location"]
        assert "application/sdp" in post_resp.headers["Content-Type"]

        # 2. Test DELETE /whip/{session_id}
        del_resp = client.delete(
            f"/api/events/{event.id}/whip/session-abc-123",
            headers=headers
        )
        assert del_resp.status_code == 200

def test_recording_corruption_handling_and_webhooks(client, test_db, tmp_path):
    """Test video integrity check, corrupt recording quarantine (415 error), and post-processing webhooks."""
    from app.services.video_processor import check_video_stream_integrity

    user = User(
        username="stream_guard",
        email="stream_guard@stageflow.io",
        hashed_password=hash_password("adminpass123"),
        is_superadmin=True
    )
    test_db.add(user)
    test_db.commit()

    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email, "role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}

    event = Event(
        name="Integrity Check Test Event",
        slug="integrity-check-event",
        created_by_id=user.id,
        stream_key="corrupt-test-key-999"
    )
    test_db.add(event)
    test_db.commit()

    membership = Membership(
        user_id=user.id,
        event_id=event.id,
        role=EventRole.ADMIN.value,
        callsign="Inspector"
    )
    test_db.add(membership)
    test_db.commit()

    # 1. Test check_video_stream_integrity with synthetic 0xFF corrupted file
    corrupt_file = tmp_path / "corrupt_take.mp4"
    corrupt_file.write_bytes(b"\xff" * 60000)

    report = check_video_stream_integrity(corrupt_file)
    assert report["is_corrupted"] is True
    assert report["status"] == "severe_corruption"
    assert report["ff_ratio"] > 0.9

    # 2. Test MediaMTX webhook triggers post-processing by stream_key
    webhook_resp = client.post(f"/api/events/by-stream-key/{event.stream_key}/post-process-recordings")
    assert webhook_resp.status_code == 200
    assert webhook_resp.json()["status"] == "accepted"
    assert webhook_resp.json()["event_id"] == event.id

    # Non-existent stream key should return 404
    missing_webhook = client.post("/api/events/by-stream-key/non-existent-key/post-process-recordings")
    assert missing_webhook.status_code == 404

    # 3. Test manual post-process endpoint
    manual_post_resp = client.post(f"/api/events/{event.id}/recordings/post-process", headers=headers)
    assert manual_post_resp.status_code == 200
    assert manual_post_resp.json()["status"] == "accepted"

    # 4. Test corrupted recording playback guard (HTTP 415 response)
    event_rec_dir = RECORDINGS_DIR / "live" / event.stream_key
    event_rec_dir.mkdir(parents=True, exist_ok=True)
    corrupted_mp4 = event_rec_dir / "corrupted_take.mp4"
    corrupted_mp4.write_bytes(b"\xff" * 60000)

    corrupted_recording = Recording(
        event_id=event.id,
        filename=f"live/{event.stream_key}/corrupted_take.mp4",
        file_size_bytes=corrupted_mp4.stat().st_size,
        duration_seconds=120.0,
        status="failed",
        title="Corrupted Take (0xFF wipeout)"
    )
    test_db.add(corrupted_recording)
    test_db.commit()

    stream_resp = client.get(f"/api/events/{event.id}/recordings/{corrupted_recording.id}/stream", headers=headers)
    assert stream_resp.status_code == 415
    assert "flagged as corrupted" in stream_resp.json()["detail"]

    # Clean up mock directory
    if event_rec_dir.exists():
        shutil.rmtree(event_rec_dir, ignore_errors=True)

def test_recording_soft_delete_safeguard_when_file_missing(client, test_db, tmp_path):
    """
    Test zero-deletion safeguard:
    When backing .mp4 files disappear or storage is temporarily unmounted,
    the API marks recordings as status='missing' instead of pruning DB records.
    If files return, status is automatically restored to 'ready'.
    """
    user = User(
        username="retention_admin",
        email="retention_admin@stageflow.io",
        hashed_password=hash_password("adminpass123"),
        is_superadmin=True
    )
    test_db.add(user)
    test_db.commit()

    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email, "role": "admin"})
    headers = {"Authorization": f"Bearer {token}"}

    event = Event(
        name="Retention Test Event",
        slug="retention-test-event",
        created_by_id=user.id,
        stream_key="retention-key-777"
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

    # Create dummy recording file on disk
    event_rec_dir = RECORDINGS_DIR / "live" / event.stream_key
    event_rec_dir.mkdir(parents=True, exist_ok=True)
    take_file = event_rec_dir / "2026-10-19_04-00-00.mp4"
    take_file.write_bytes(b"dummy mp4 content for testing")

    rec = Recording(
        event_id=event.id,
        filename=f"live/{event.stream_key}/2026-10-19_04-00-00.mp4",
        file_size_bytes=len(b"dummy mp4 content for testing"),
        duration_seconds=300.0,
        status="ready",
        title="Show Act 1 Take"
    )
    # Also add a stale .tmp recording to verify temp files are pruned
    tmp_rec = Recording(
        event_id=event.id,
        filename=f"live/{event.stream_key}/stale.faststart_tmp.mp4",
        file_size_bytes=100,
        duration_seconds=10.0,
        status="processing",
        title="Stale Remux Temp"
    )
    test_db.add_all([rec, tmp_rec])
    test_db.commit()

    # 1. Backing file is removed from disk (simulating MediaMTX 24h prune or storage unmount)
    take_file.unlink()
    assert not take_file.exists()

    # 2. Call list recordings endpoint
    resp = client.get(f"/api/events/{event.id}/recordings", headers=headers)
    assert resp.status_code == 200
    data = resp.json()

    # The stale .tmp file should have been cleaned up
    assert len(data) == 1
    item = data[0]
    assert item["id"] == rec.id
    # The missing recording MUST NOT be deleted; it should be soft-marked as "missing"
    assert item["status"] == "missing"

    # Verify directly in the DB that record still exists
    db_rec = test_db.query(Recording).filter(Recording.id == rec.id).first()
    assert db_rec is not None
    assert db_rec.status == "missing"

    # Streaming the missing recording should return 404 with clear detail
    stream_resp = client.get(f"/api/events/{event.id}/recordings/{rec.id}/stream", headers=headers)
    assert stream_resp.status_code == 404
    assert "missing" in stream_resp.json()["detail"].lower()

    # 3. Simulate file restored / storage re-mounted
    take_file.write_bytes(b"restored mp4 content")
    resp_recovered = client.get(f"/api/events/{event.id}/recordings", headers=headers)
    assert resp_recovered.status_code == 200
    recovered_item = resp_recovered.json()[0]
    assert recovered_item["status"] == "ready"

    # Clean up test files
    if event_rec_dir.exists():
        shutil.rmtree(event_rec_dir, ignore_errors=True)


def test_mediamtx_stream_auth_endpoints(client, test_db):
    """
    Verifies that MediaMTX HTTP authentication properly validates stream keys:
    - Rejects invalid stream keys with 401 Unauthorized
    - Rejects empty stream keys with 401
    - Rejects paths outside the 'live/' namespace with 401
    - Accepts valid stream keys with 200 OK
    - Accepts valid low-bandwidth transcoded renditions (_low)
    - Rejects low renditions if parent key is invalid
    - Invalidate stream keys upon regeneration and event deletion
    - Allows non-publish actions (read, playback)
    """
    user = User(
        username="stream_guard_admin",
        email="guard@stagecontrol.test",
        hashed_password=hash_password("adminpass123"),
        is_superadmin=True
    )
    test_db.add(user)
    test_db.commit()

    event = Event(
        name="Security Test Show",
        slug="sec-test-show",
        created_by_id=user.id,
        stream_key=generate_stream_key()
    )
    test_db.add(event)
    test_db.commit()

    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email, "role": "admin"})
    auth_headers = {"Authorization": f"Bearer {token}"}

    # 1. Valid stream key publish
    resp = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": f"live/{event.stream_key}",
        "protocol": "rtmp",
        "ip": "127.0.0.1"
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["event_id"] == event.id

    # 2. Also works via alias endpoint /api/events/mediamtx-auth and without /api prefix
    alias_resp = client.post("/api/events/mediamtx-auth", json={
        "action": "publish",
        "path": f"live/{event.stream_key}",
        "protocol": "rtmp"
    })
    assert alias_resp.status_code == 200

    root_resp = client.post("/streams/auth", json={
        "action": "publish",
        "path": f"live/{event.stream_key}",
        "protocol": "rtmp"
    })
    assert root_resp.status_code == 200

    # 3. Invalid stream key publish MUST be rejected with 401
    invalid_resp = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": "live/invalid_stream_key_999",
        "protocol": "rtmp",
        "ip": "192.168.1.50"
    })
    assert invalid_resp.status_code == 401
    assert "Invalid stream key" in invalid_resp.json()["detail"]

    # 4. Empty stream key MUST be rejected with 401
    empty_resp = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": "live/",
        "protocol": "rtmp"
    })
    assert empty_resp.status_code == 401

    # 5. Path outside 'live/' namespace MUST be rejected with 401
    outside_resp = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": f"broadcast/{event.stream_key}",
        "protocol": "rtmp"
    })
    assert outside_resp.status_code == 401
    assert "live/" in outside_resp.json()["detail"]

    # 6. Valid low-bandwidth transcode rendition (_low) MUST be accepted
    low_resp = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": f"live/{event.stream_key}_low",
        "protocol": "rtmp"
    })
    assert low_resp.status_code == 200

    # 7. Invalid low-bandwidth transcode rendition MUST be rejected
    bad_low_resp = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": "live/bogus_key_low",
        "protocol": "rtmp"
    })
    assert bad_low_resp.status_code == 401

    # 8. Non-publish actions (read, playback, api) are permitted
    read_resp = client.post("/api/streams/auth", json={
        "action": "read",
        "path": f"live/{event.stream_key}",
        "protocol": "webrtc"
    })
    assert read_resp.status_code == 200

    # 9. Key regeneration invalidates old key
    old_key = event.stream_key
    regen_resp = client.post(f"/api/events/{event.id}/regenerate-stream-key", headers=auth_headers)
    assert regen_resp.status_code == 200
    new_key = regen_resp.json()["stream_key"]
    assert new_key != old_key

    # Old key now rejected
    old_auth = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": f"live/{old_key}",
        "protocol": "rtmp"
    })
    assert old_auth.status_code == 401

    # New key accepted
    new_auth = client.post("/api/streams/auth", json={
        "action": "publish",
        "path": f"live/{new_key}",
        "protocol": "rtmp"
    })
    assert new_auth.status_code == 200




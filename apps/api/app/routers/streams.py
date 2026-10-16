import os
import httpx
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import RECORDINGS_DIR, settings
from app.core.deps import require_event_access, require_min_role
from app.core.streaming import create_range_video_response
from app.database import get_db
from app.models.enums import EventRole, has_sufficient_role
from app.models.event import Event
from app.models.membership import Membership
from app.models.recording import Recording
from app.models.settings import SystemSettings
from app.schemas.recording import (
    RecordingResponse,
    RecordingUpdate,
    StreamStatusResponse,
)

router = APIRouter(prefix="/events/{event_id}", tags=["Live Streams & Video Playback"])

def get_effective_domain(request: Request, db: Session) -> str:
    """
    Determines the best client-facing hostname / domain for stream URLs.
    Checks SystemSettings first, or falls back to the HTTP request host.
    """
    sys_settings = db.query(SystemSettings).first()
    if sys_settings and sys_settings.primary_domain:
        # If user is accessing from alternative/local domain and it's configured
        req_host = request.headers.get("host", "").lower()
        if (
            sys_settings.alternative_domain
            and sys_settings.alternative_domain.lower() in req_host
        ):
            domain = sys_settings.alternative_domain.rstrip("/")
            if not domain.startswith("http://") and not domain.startswith("https://"):
                domain = f"http://{domain}"
            return domain

        domain = sys_settings.primary_domain.rstrip("/")
        if not domain.startswith("http://") and not domain.startswith("https://"):
            domain = f"https://{domain}"
        return domain

    # Fallback to current request hostname
    host = request.url.hostname or "localhost"
    return f"http://{host}"

@router.get("/stream-status", response_model=StreamStatusResponse)
async def get_stream_status(
    request: Request,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Queries MediaMTX management API to check if OBS/source is actively publishing.
    Returns live tracks, active viewers, and protocol URLs for WebRTC & HLS.
    """
    event, membership = event_and_member
    stream_key = event.stream_key

    is_live = False
    ready = False
    readers_count = 0
    bytes_received = 0
    tracks = []

    # Query MediaMTX API
    try:
        mediamtx_api = settings.MEDIAMTX_API_URL.rstrip("/")
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(f"{mediamtx_api}/v3/paths/get/live/{stream_key}")
            if resp.status_code == 200:
                data = resp.json()
                ready = bool(data.get("ready", False))
                is_live = ready
                bytes_received = data.get("bytesReceived", 0)
                readers_count = len(data.get("readers", []))
                raw_tracks = data.get("tracks", [])
                tracks = [
                    t if isinstance(t, str) else t.get("codec", "unknown")
                    for t in raw_tracks
                ]
    except Exception as e:
        # If MediaMTX is temporarily unreachable, default to off-air
        is_live = False
        ready = False


    base_domain = get_effective_domain(request, db)
    # Extract hostname without protocol/port for RTMP
    raw_host = request.url.hostname or "localhost"

    # Port mappings
    # In production with reverse proxy, paths might be proxied; for local/dev ports are 1935, 8888, 8889
    rtmp_url = f"rtmp://{raw_host}:1935/live"
    webrtc_url = f"http://{raw_host}:8889/live/{stream_key}"
    webrtc_whep_url = f"http://{raw_host}:8889/live/{stream_key}/whep"
    hls_url = f"http://{raw_host}:8888/live/{stream_key}"
    hls_playlist_url = f"http://{raw_host}:8888/live/{stream_key}/index.m3u8"

    can_view_key = has_sufficient_role(membership.role, EventRole.STAGE_MANAGER)

    return StreamStatusResponse(
        is_live=is_live,
        ready=ready,
        readers_count=readers_count,
        bytes_received=bytes_received,
        tracks=tracks,
        rtmp_url=rtmp_url,
        webrtc_url=webrtc_url,
        webrtc_whep_url=webrtc_whep_url,
        hls_url=hls_url,
        hls_playlist_url=hls_playlist_url,
        stream_key=stream_key if can_view_key else None
    )

@router.get("/recordings", response_model=list[RecordingResponse])
def list_event_recordings(
    request: Request,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Lists all recorded sessions for this event.
    Automatically scans the filesystem directory (storage/recordings/live/{stream_key})
    and registers any newly created recording files into the database.
    """
    event, _ = event_and_member
    stream_key = event.stream_key

    # Disk scan for new files
    event_rec_dir = RECORDINGS_DIR / "live" / stream_key
    if event_rec_dir.exists() and event_rec_dir.is_dir():
        for file in event_rec_dir.glob("*.mp4"):
            rel_path = f"live/{stream_key}/{file.name}"
            existing = db.query(Recording).filter(
                Recording.event_id == event.id,
                Recording.filename == rel_path
            ).first()

            if not existing:
                file_size = file.stat().st_size
                mtime = datetime.fromtimestamp(file.stat().st_mtime, tz=timezone.utc)
                # Formulate friendly title e.g. "Take 2026-10-16 21:05"
                timestamp_str = file.stem.replace("_", " ").replace("-", ":", 2)
                title = f"Recording - {file.stem}"

                new_rec = Recording(
                    event_id=event.id,
                    title=title,
                    filename=rel_path,
                    file_size_bytes=file_size,
                    duration_seconds=0.0,
                    status="ready",
                    created_at=mtime
                )
                db.add(new_rec)
        db.commit()

    recordings = (
        db.query(Recording)
        .filter(Recording.event_id == event.id)
        .order_by(Recording.created_at.desc())
        .all()
    )

    base_api = f"{str(request.base_url).rstrip('/')}/api/events/{event.id}/recordings"
    results = []
    for r in recordings:
        resp = RecordingResponse(
            id=r.id,
            event_id=r.event_id,
            title=r.title,
            filename=r.filename,
            duration_seconds=r.duration_seconds,
            file_size_bytes=r.file_size_bytes,
            status=r.status,
            created_at=r.created_at,
            stream_url=f"{base_api}/{r.id}/stream",
            download_url=f"{base_api}/{r.id}/download"
        )
        results.append(resp)

    return results

@router.get("/recordings/{recording_id}/stream")
def stream_recording_video(
    recording_id: str,
    request: Request,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Streams the recorded MP4 file with HTTP 206 Partial Content (range requests)
    for seamless seeking, scrubbing, pause, and resume on all devices.
    """
    event, _ = event_and_member
    recording = db.query(Recording).filter(
        Recording.id == recording_id,
        Recording.event_id == event.id
    ).first()

    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )

    file_path = (RECORDINGS_DIR / recording.filename).resolve()
    # Path traversal protection
    if not str(file_path).startswith(str(RECORDINGS_DIR.resolve())):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid recording file path"
        )

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording media file missing from disk"
        )

    return create_range_video_response(file_path, request)

@router.get("/recordings/{recording_id}/download")
def download_recording_video(
    recording_id: str,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Directly downloads the recorded MP4 file as an attachment.
    """
    event, _ = event_and_member
    recording = db.query(Recording).filter(
        Recording.id == recording_id,
        Recording.event_id == event.id
    ).first()

    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )

    file_path = (RECORDINGS_DIR / recording.filename).resolve()
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording media file missing from disk"
        )

    safe_title = "".join(c for c in recording.title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        filename=f"{safe_title or 'recording'}.mp4"
    )

@router.patch("/recordings/{recording_id}", response_model=RecordingResponse)
def rename_recording(
    recording_id: str,
    update_in: RecordingUpdate,
    request: Request,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.STAGE_MANAGER)),
    db: Session = Depends(get_db)
):
    """
    Renames a recording's title (e.g. 'Opening Rehearsal', 'Act 1').
    """
    event, _ = event_and_member
    recording = db.query(Recording).filter(
        Recording.id == recording_id,
        Recording.event_id == event.id
    ).first()

    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )

    recording.title = update_in.title.strip()
    db.commit()
    db.refresh(recording)

    base_api = f"{str(request.base_url).rstrip('/')}/api/events/{event.id}/recordings"
    return RecordingResponse(
        id=recording.id,
        event_id=recording.event_id,
        title=recording.title,
        filename=recording.filename,
        duration_seconds=recording.duration_seconds,
        file_size_bytes=recording.file_size_bytes,
        status=recording.status,
        created_at=recording.created_at,
        stream_url=f"{base_api}/{recording.id}/stream",
        download_url=f"{base_api}/{recording.id}/download"
    )

@router.delete("/recordings/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recording(
    recording_id: str,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    """
    Deletes a recording record and removes the file from disk.
    Admin only.
    """
    event, _ = event_and_member
    recording = db.query(Recording).filter(
        Recording.id == recording_id,
        Recording.event_id == event.id
    ).first()

    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )

    # Delete physical file
    file_path = (RECORDINGS_DIR / recording.filename).resolve()
    if file_path.exists() and str(file_path).startswith(str(RECORDINGS_DIR.resolve())):
        try:
            file_path.unlink()
        except OSError:
            pass

    db.delete(recording)
    db.commit()
    return None

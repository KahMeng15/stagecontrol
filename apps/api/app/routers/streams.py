import os
import httpx
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.config import RECORDINGS_DIR, settings
from app.core.deps import require_event_access, require_min_role
from app.core.streaming import create_range_video_response
from app.database import get_db
from app.models.enums import EventRole, has_sufficient_role
from app.models.event import Event
from app.models.membership import Membership
from app.models.recording import Recording, VideoMarker
from app.models.subtitle import Subtitle
from app.models.settings import SystemSettings
from app.schemas.recording import (
    MarkerCreate,
    MarkerResponse,
    MarkerUpdate,
    RecordingResponse,
    RecordingUpdate,
    StreamStatusResponse,
)
from app.services.video_processor import (
    is_fragmented_mp4,
    probe_video_metadata,
    remux_to_faststart_mp4,
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
        req_host = (
            request.headers.get("x-forwarded-host")
            or request.headers.get("host")
            or ""
        ).lower()
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
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.hostname
        or "localhost"
    )
    host = host.split(":")[0]
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

    ready_time = None

    # Query MediaMTX API
    try:
        mediamtx_api = settings.MEDIAMTX_API_URL.rstrip("/")
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(f"{mediamtx_api}/v3/paths/get/live/{stream_key}")
            if resp.status_code == 200:
                data = resp.json()
                ready = bool(data.get("ready", False))
                is_live = ready
                ready_time = data.get("readyTime")
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
    # Extract client-facing hostname for RTMP, HLS, WebRTC
    try:
        from urllib.parse import urlparse
        parsed = urlparse(base_domain)
        effective_host = parsed.hostname or base_domain.replace("http://", "").replace("https://", "").split(":")[0].split("/")[0] or "localhost"
        is_https = parsed.scheme == "https"
        is_domain = not all(part.isdigit() for part in effective_host.split(".")) and effective_host != "localhost"
    except Exception:
        effective_host = request.url.hostname or "localhost"
        is_https = False
        is_domain = False

    # RTMP is always ingested on standard port 1935 (port forwarded on router)
    rtmp_url = f"rtmp://{effective_host}:1935/live"

    # Web playback URLs: When deployed behind a domain/HTTPS, route through reverse proxy (port 443).
    # Otherwise fallback to raw ports 8888, 8889 for local/LAN dev.
    if is_https or is_domain:
        proto = "https" if is_https else "http"
        webrtc_url = f"{proto}://{effective_host}/live/{stream_key}"
        webrtc_whep_url = f"{proto}://{effective_host}/live/{stream_key}/whep"
        webrtc_whip_url = f"{proto}://{effective_host}/live/{stream_key}/whip"
        hls_url = f"{proto}://{effective_host}/live/{stream_key}"
        hls_playlist_url = f"{proto}://{effective_host}/live/{stream_key}/index.m3u8"
        webrtc_low_url = f"{proto}://{effective_host}/live/{stream_key}_low"
        webrtc_low_whep_url = f"{proto}://{effective_host}/live/{stream_key}_low/whep"
        hls_low_url = f"{proto}://{effective_host}/live/{stream_key}_low"
        hls_low_playlist_url = f"{proto}://{effective_host}/live/{stream_key}_low/index.m3u8"
    else:
        webrtc_url = f"http://{effective_host}:8889/live/{stream_key}"
        webrtc_whep_url = f"http://{effective_host}:8889/live/{stream_key}/whep"
        webrtc_whip_url = f"http://{effective_host}:8889/live/{stream_key}/whip"
        hls_url = f"http://{effective_host}:8888/live/{stream_key}"
        hls_playlist_url = f"http://{effective_host}:8888/live/{stream_key}/index.m3u8"
        webrtc_low_url = f"http://{effective_host}:8889/live/{stream_key}_low"
        webrtc_low_whep_url = f"http://{effective_host}:8889/live/{stream_key}_low/whep"
        hls_low_url = f"http://{effective_host}:8888/live/{stream_key}_low"
        hls_low_playlist_url = f"http://{effective_host}:8888/live/{stream_key}_low/index.m3u8"

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
        webrtc_whip_url=webrtc_whip_url,
        hls_url=hls_url,
        hls_playlist_url=hls_playlist_url,
        hls_low_url=hls_low_url,
        hls_low_playlist_url=hls_low_playlist_url,
        webrtc_low_url=webrtc_low_url,
        webrtc_low_whep_url=webrtc_low_whep_url,
        stream_key=stream_key if can_view_key else None,
        ready_time=ready_time
    )

@router.post("/whip")
async def whip_publish(
    request: Request,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
):
    """
    WHIP (WebRTC HTTP Ingestion Protocol) endpoint to start publishing from browser / mobile.
    Proxies the SDP offer to MediaMTX WHIP ingest, and maps candidates if needed for LAN devices.
    """
    event, membership = event_and_member
    if not has_sufficient_role(membership.role, EventRole.CREW):
        raise HTTPException(status_code=403, detail="Insufficient permissions to broadcast")

    stream_key = event.stream_key
    body = await request.body()
    content_type = request.headers.get("content-type", "application/sdp")

    # Connect to MediaMTX container WHIP endpoint
    mediamtx_whip_url = f"http://mediamtx:8889/live/{stream_key}/whip"
    client_host = request.url.hostname or "localhost"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                mediamtx_whip_url,
                content=body,
                headers={"Content-Type": content_type}
            )

            resp_headers: dict[str, str] = {}
            for h in ["Location", "ETag", "ID", "Accept-Patch", "Link", "Access-Control-Expose-Headers"]:
                if h in resp.headers:
                    if h == "Location":
                        session_id = resp.headers[h].split("/")[-1]
                        resp_headers["Location"] = f"/api/events/{event.id}/whip/{session_id}"
                    else:
                        resp_headers[h] = resp.headers[h]

            # In the SDP answer, if client connected from a LAN IP or hostname,
            # duplicate 127.0.0.1 host candidates with client_host so mobile devices on LAN can resolve ICE
            sdp_answer = resp.text
            if client_host not in ["localhost", "127.0.0.1"]:
                lines = sdp_answer.splitlines()
                new_lines = []
                for line in lines:
                    new_lines.append(line)
                    if line.startswith("a=candidate:") and " 8189 typ host" in line and "127.0.0.1" in line:
                        new_lines.append(line.replace("127.0.0.1", client_host))
                sdp_answer = "\r\n".join(new_lines) + "\r\n"

            return Response(
                content=sdp_answer,
                status_code=resp.status_code,
                media_type="application/sdp",
                headers=resp_headers
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to connect to MediaMTX WHIP: {str(e)}")

@router.delete("/whip/{session_id}")
async def whip_terminate(
    session_id: str,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
):
    """Terminates an active browser WHIP publishing session."""
    event, _ = event_and_member
    stream_key = event.stream_key
    mediamtx_whip_session_url = f"http://mediamtx:8889/live/{stream_key}/whip/{session_id}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.delete(mediamtx_whip_session_url)
            return Response(status_code=resp.status_code)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to terminate WHIP session: {str(e)}")

def format_friendly_recording_title(file_stem: str, file_mtime: datetime | None = None) -> str:
    """
    Formats recording filename stems into a user-friendly title:
    e.g. '01:16:46 pm 16 Oct 2026'
    """
    dt = None
    try:
        dt = datetime.strptime(file_stem, "%Y-%m-%d_%H-%M-%S-%f")
    except Exception:
        try:
            clean_stem = file_stem.split("_")[0] + "_" + file_stem.split("_")[1].split("-")[0]
            dt = datetime.strptime(clean_stem, "%Y-%m-%d_%H-%M-%S")
        except Exception:
            if file_mtime:
                dt = file_mtime

    if dt:
        time_part = dt.strftime("%I:%M:%S %p").lower()
        return f"{time_part} {dt.day} {dt.strftime('%b %Y')}"

    return f"Take - {file_stem}"

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

    # Check whether the stream is actively live on MediaMTX
    is_live = False
    try:
        mediamtx_api = settings.MEDIAMTX_API_URL.rstrip("/")
        with httpx.Client(timeout=0.3) as client:
            resp = client.get(f"{mediamtx_api}/v3/paths/get/live/{stream_key}")
            if resp.status_code == 200:
                is_live = bool(resp.json().get("ready", False))
    except Exception:
        is_live = False

    # Disk scan for new files
    event_rec_dir = RECORDINGS_DIR / "live" / stream_key
    if event_rec_dir.exists() and event_rec_dir.is_dir():
        import re
        from datetime import timedelta
        now_utc = datetime.now(timezone.utc)

        for file in event_rec_dir.glob("*.mp4"):
            if ".tmp" in file.name or ".part" in file.name or ".faststart" in file.name or file.name.endswith("_720p.mp4"):
                continue

            rel_path = f"live/{stream_key}/{file.name}"
            existing = db.query(Recording).filter(
                Recording.event_id == event.id,
                Recording.filename == rel_path
            ).first()

            file_stat = file.stat()
            file_size = file_stat.st_size
            mtime = datetime.fromtimestamp(file_stat.st_mtime, tz=timezone.utc)
            match = re.search(r'(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})', file.stem)
            if match:
                dt_str = f"{match.group(1)} {match.group(2)}:{match.group(3)}:{match.group(4)}"
                start_dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            else:
                start_dt = mtime

            friendly_title = format_friendly_recording_title(file.stem, start_dt)

            # Check if this take is actively being written by MediaMTX
            is_active_recording = is_live and file_size >= 1024 and (now_utc - mtime).total_seconds() < 5

            if is_active_recording:
                rec_status = "recording"
                duration = max(0.0, (now_utc - start_dt).total_seconds())
            else:
                # File is settled on disk
                rec_status = "ready"
                if not existing or existing.duration_seconds <= 0.0 or existing.status != "ready":
                    from app.services.video_processor import repair_corrupted_mvhd
                    repair_corrupted_mvhd(file)
                    meta = probe_video_metadata(file)
                    duration = meta.get("duration") or max(0.0, (mtime - start_dt).total_seconds())
                else:
                    duration = existing.duration_seconds

            # Check if an optimized 720p proxy exists on disk
            proxy_file = file.with_name(f"{file.stem}_720p.mp4")
            proxy_rel = None
            proxy_size = None
            if proxy_file.exists() and proxy_file.stat().st_size > 1024:
                proxy_rel = f"live/{stream_key}/{proxy_file.name}"
                proxy_size = proxy_file.stat().st_size

            rec_target = None
            if not existing:
                new_rec = Recording(
                    event_id=event.id,
                    title=friendly_title,
                    filename=rel_path,
                    file_size_bytes=file_size,
                    duration_seconds=round(duration, 1),
                    status=rec_status,
                    created_at=start_dt,
                    proxy_filename=proxy_rel,
                    proxy_size_bytes=proxy_size,
                    is_optimized=1 if proxy_rel else 0
                )
                db.add(new_rec)
                db.flush()
                rec_target = new_rec
            else:
                existing.duration_seconds = round(duration, 1)
                existing.file_size_bytes = file_size
                existing.status = rec_status
                if proxy_rel:
                    existing.proxy_filename = proxy_rel
                    existing.proxy_size_bytes = proxy_size
                    existing.is_optimized = 1
                if existing.title.startswith("Recording - 202") or existing.title.startswith("Take - 202"):
                    existing.title = friendly_title
                rec_target = existing

            # Link all subtitles within this recording's time window
            if rec_target and rec_status == "ready":
                window_subs = db.query(Subtitle).filter(
                    Subtitle.event_id == event.id,
                    Subtitle.created_at >= start_dt - timedelta(seconds=2),
                    Subtitle.created_at <= mtime + timedelta(seconds=5)
                ).all()
                for s in window_subs:
                    if s.recording_id != rec_target.id:
                        s.recording_id = rec_target.id
                    if s.created_at:
                        s_dt = s.created_at if s.created_at.tzinfo else s.created_at.replace(tzinfo=timezone.utc)
                        diff = max(0.0, (s_dt - start_dt).total_seconds())
                        s.start_seconds = round(diff, 1)
                        s.end_seconds = round(diff + 3.0, 1)

        db.commit()

    recordings = (
        db.query(Recording)
        .filter(Recording.event_id == event.id)
        .order_by(Recording.created_at.desc())
        .all()
    )

    valid_recordings = []
    has_orphans = False
    for r in recordings:
        if r.filename.endswith(".faststart_tmp.mp4") or ".tmp" in r.filename:
            db.delete(r)
            has_orphans = True
            continue
        file_path = (RECORDINGS_DIR / r.filename).resolve()
        if not file_path.exists():
            alt_path = Path("/storage/recordings") / r.filename
            if not alt_path.exists():
                db.delete(r)
                has_orphans = True
                continue
        valid_recordings.append(r)
    if has_orphans:
        db.commit()

    results = []
    for r in valid_recordings:
        resp = RecordingResponse(
            id=r.id,
            event_id=r.event_id,
            title=r.title,
            filename=r.filename,
            duration_seconds=r.duration_seconds,
            file_size_bytes=r.file_size_bytes,
            status=r.status,
            created_at=r.created_at,
            stream_url=f"/api/events/{event.id}/recordings/{r.id}/stream",
            master_stream_url=f"/api/events/{event.id}/recordings/{r.id}/stream?quality=source",
            download_url=f"/api/events/{event.id}/recordings/{r.id}/download",
            proxy_filename=r.proxy_filename,
            proxy_size_bytes=r.proxy_size_bytes,
            is_optimized=bool(r.is_optimized)
        )
        results.append(resp)

    return results

@router.get("/recordings/{recording_id}/stream")
def stream_recording_video(
    recording_id: str,
    request: Request,
    quality: Optional[str] = None,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Streams the recorded MP4 file with HTTP 206 Partial Content (range requests)
    for seamless seeking, scrubbing, pause, and resume on all devices.
    Automatically serves 720p web proxy by default (unless quality=source requested).
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

    # Determine whether to serve 720p proxy (default for low bandwidth) or master
    target_path = file_path
    if quality not in ("source", "master") and recording.proxy_filename:
        proxy_path = (RECORDINGS_DIR / recording.proxy_filename).resolve()
        if proxy_path.exists() and proxy_path.stat().st_size > 1024:
            target_path = proxy_path

    # Ensure mvhd box is healthy before serving to browser
    now_utc = datetime.now(timezone.utc)
    mtime = datetime.fromtimestamp(target_path.stat().st_mtime, tz=timezone.utc)
    if (now_utc - mtime).total_seconds() >= 4:
        from app.services.video_processor import repair_corrupted_mvhd
        if repair_corrupted_mvhd(target_path):
            meta = probe_video_metadata(target_path)
            if meta.get("duration", 0.0) > 0 and target_path == file_path:
                recording.duration_seconds = round(meta["duration"], 1)
                recording.file_size_bytes = target_path.stat().st_size
                recording.status = "ready"
                db.commit()

    # If the file being streamed is settled and still an unindexed fragmented MP4, faststart remux it
    if (now_utc - mtime).total_seconds() >= 4 and is_fragmented_mp4(target_path):
        success, exact_dur, new_size = remux_to_faststart_mp4(target_path)
        if success and target_path == file_path:
            recording.duration_seconds = round(exact_dur, 1)
            recording.file_size_bytes = new_size
            recording.status = "ready"
            db.commit()

    return create_range_video_response(target_path, request)

@router.post("/recordings/{recording_id}/optimize", response_model=RecordingResponse)
def optimize_single_recording(
    recording_id: str,
    request: Request,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Explicitly triggers faststart remux and ffprobe metadata probe on a specific recording.
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

    from app.services.video_processor import repair_corrupted_mvhd
    repair_corrupted_mvhd(file_path)

    if is_fragmented_mp4(file_path):
        success, exact_dur, new_size = remux_to_faststart_mp4(file_path)
        if success:
            recording.duration_seconds = round(exact_dur, 1)
            recording.file_size_bytes = new_size
            recording.status = "ready"
    else:
        meta = probe_video_metadata(file_path)
        if meta.get("duration"):
            recording.duration_seconds = round(meta["duration"], 1)
        recording.file_size_bytes = file_path.stat().st_size
        recording.status = "ready"

    # Generate 720p 800k faststart web proxy
    from app.services.video_processor import generate_compressed_proxy
    proxy_success, proxy_path, proxy_size = generate_compressed_proxy(file_path)
    if proxy_success and proxy_path:
        parts = recording.filename.split("/")
        stream_key = parts[1] if len(parts) > 1 else event.stream_key
        recording.proxy_filename = f"live/{stream_key}/{proxy_path.name}"
        recording.proxy_size_bytes = proxy_size
        recording.is_optimized = 1

    db.commit()
    db.refresh(recording)
    return RecordingResponse(
        id=recording.id,
        event_id=recording.event_id,
        title=recording.title,
        filename=recording.filename,
        duration_seconds=recording.duration_seconds,
        file_size_bytes=recording.file_size_bytes,
        status=recording.status,
        created_at=recording.created_at,
        stream_url=f"/api/events/{event.id}/recordings/{recording.id}/stream",
        master_stream_url=f"/api/events/{event.id}/recordings/{recording.id}/stream?quality=source",
        download_url=f"/api/events/{event.id}/recordings/{recording.id}/download",
        proxy_filename=recording.proxy_filename,
        proxy_size_bytes=recording.proxy_size_bytes,
        is_optimized=bool(recording.is_optimized)
    )

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

    return RecordingResponse(
        id=recording.id,
        event_id=recording.event_id,
        title=recording.title,
        filename=recording.filename,
        duration_seconds=recording.duration_seconds,
        file_size_bytes=recording.file_size_bytes,
        status=recording.status,
        created_at=recording.created_at,
        stream_url=f"/api/events/{event.id}/recordings/{recording.id}/stream",
        master_stream_url=f"/api/events/{event.id}/recordings/{recording.id}/stream?quality=source",
        download_url=f"/api/events/{event.id}/recordings/{recording.id}/download",
        proxy_filename=recording.proxy_filename,
        proxy_size_bytes=recording.proxy_size_bytes,
        is_optimized=bool(recording.is_optimized)
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

    # Delete physical master file
    file_path = (RECORDINGS_DIR / recording.filename).resolve()
    if file_path.exists() and str(file_path).startswith(str(RECORDINGS_DIR.resolve())):
        try:
            file_path.unlink()
        except OSError:
            pass

    # Delete physical proxy file if present
    if recording.proxy_filename:
        proxy_path = (RECORDINGS_DIR / recording.proxy_filename).resolve()
        if proxy_path.exists() and str(proxy_path).startswith(str(RECORDINGS_DIR.resolve())):
            try:
                proxy_path.unlink()
            except OSError:
                pass

    db.delete(recording)
    db.commit()
    return None

# =========================================================================
# Video Timeline Markers & Chapters
# =========================================================================

@router.get("/markers", response_model=list[MarkerResponse])
def list_markers(
    recording_id: str | None = None,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Returns all video chapter markers for this event.
    Optionally filters by recording_id.
    """
    event, _ = event_and_member
    query = db.query(VideoMarker).filter(VideoMarker.event_id == event.id)
    if recording_id:
        query = query.filter(VideoMarker.recording_id == recording_id)
    
    markers = query.order_by(
        VideoMarker.timestamp_seconds.asc(),
        VideoMarker.created_at.asc()
    ).all()
    return markers

@router.post("/markers", response_model=MarkerResponse, status_code=status.HTTP_201_CREATED)
def create_marker(
    marker_in: MarkerCreate,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.CREW)),
    db: Session = Depends(get_db)
):
    """
    Creates a new chapter / moment marker on the video timeline.
    Can be created during a live stream (auto-linked to active take) or in replay.
    """
    event, member = event_and_member
    recording_id = marker_in.recording_id
    timestamp_seconds = marker_in.timestamp_seconds

    # If created live without explicit recording_id, try linking to the currently active recording
    if not recording_id:
        stream_key = event.stream_key
        event_rec_dir = RECORDINGS_DIR / "live" / stream_key
        if event_rec_dir.exists():
            files = sorted(event_rec_dir.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
            if files:
                latest_file = files[0]
                # Check if file was modified recently (within 60 seconds -> active live stream recording)
                is_active = (datetime.now(timezone.utc).timestamp() - latest_file.stat().st_mtime) < 60
                rel_path = f"live/{stream_key}/{latest_file.name}"
                rec = db.query(Recording).filter(Recording.filename == rel_path).first()
                if not rec:
                    rec = Recording(
                        event_id=event.id,
                        title=format_friendly_recording_title(latest_file.stem),
                        filename=rel_path,
                        file_size_bytes=latest_file.stat().st_size,
                        duration_seconds=0.0,
                        status="recording" if is_active else "ready"
                    )
                    db.add(rec)
                    db.commit()
                    db.refresh(rec)
                recording_id = rec.id

                # If timestamp_seconds wasn't provided, calculate offset from start of file
                if timestamp_seconds is None:
                    try:
                        # File format: YYYY-MM-DD_HH-MM-SS-ffffff.mp4
                        stem = latest_file.stem
                        start_time = datetime.strptime(stem, "%Y-%m-%d_%H-%M-%S-%f").replace(tzinfo=timezone.utc)
                        timestamp_seconds = max(0.0, (datetime.now(timezone.utc) - start_time).total_seconds())
                    except Exception:
                        timestamp_seconds = 0.0

    marker = VideoMarker(
        event_id=event.id,
        recording_id=recording_id,
        title=marker_in.title.strip(),
        description=marker_in.description.strip() if marker_in.description else None,
        timestamp_seconds=timestamp_seconds,
        color=marker_in.color or "blue",
        created_by_id=member.user_id if member.user_id and not member.id.startswith("guest_") else None,
        creator_callsign=member.callsign or (member.user.full_name or member.user.username if member.user else "Crew")
    )
    db.add(marker)
    db.commit()
    db.refresh(marker)
    return marker

@router.patch("/markers/{marker_id}", response_model=MarkerResponse)
def update_marker(
    marker_id: str,
    marker_in: MarkerUpdate,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    event, member = event_and_member
    marker = db.query(VideoMarker).filter(VideoMarker.id == marker_id, VideoMarker.event_id == event.id).first()
    if not marker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Marker not found")

    # Only creator, SM or Admin can edit
    can_edit = has_sufficient_role(member.role, EventRole.STAGE_MANAGER) or (marker.created_by_id and marker.created_by_id == member.user_id)
    if not can_edit:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to edit this marker")

    if marker_in.title is not None:
        marker.title = marker_in.title.strip()
    if marker_in.description is not None:
        marker.description = marker_in.description.strip() if marker_in.description else None
    if marker_in.timestamp_seconds is not None:
        marker.timestamp_seconds = marker_in.timestamp_seconds
    if marker_in.color is not None:
        marker.color = marker_in.color

    marker.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(marker)
    return marker

@router.delete("/markers/{marker_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_marker(
    marker_id: str,
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    event, member = event_and_member
    marker = db.query(VideoMarker).filter(VideoMarker.id == marker_id, VideoMarker.event_id == event.id).first()
    if not marker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Marker not found")

    can_delete = has_sufficient_role(member.role, EventRole.STAGE_MANAGER) or (marker.created_by_id and marker.created_by_id == member.user_id)
    if not can_delete:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to delete this marker")

    db.delete(marker)
    db.commit()
    return None

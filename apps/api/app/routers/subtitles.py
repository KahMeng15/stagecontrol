import logging
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.core.deps import require_event_access, require_min_role
from app.core.security import decode_access_token
from app.database import get_db, SessionLocal
from app.models.enums import EventRole
from app.models.event import Event
from app.models.membership import Membership
from app.models.subtitle import Subtitle
from app.schemas.subtitle import SubtitleResponse, SubtitleStatusResponse
from app.services.transcription import transcription_service

logger = logging.getLogger("stagecontrol.subtitles")
router = APIRouter(prefix="/events/{event_id}/subtitles", tags=["subtitles"])

@router.get("", response_model=list[SubtitleResponse])
def get_event_subtitles(
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    limit: int = Query(100, ge=1, le=500),
    recording_id: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db)
):
    """
    Returns transcription lines / closed captions for this event.
    If recording_id is provided, returns all subtitles synchronized to that recording take,
    ordered chronologically (00:00 -> end of take) for seamless replay scrubbing.
    Otherwise returns live event subtitles (top newest first).
    """
    from datetime import timedelta
    from app.models.recording import Recording

    event, _ = event_and_member

    if recording_id:
        recording = db.query(Recording).filter(
            Recording.id == recording_id,
            Recording.event_id == event.id
        ).first()

        if not recording:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")

        query = db.query(Subtitle).filter(Subtitle.event_id == event.id)
        if search:
            query = query.filter(Subtitle.text.ilike(f"%{search}%"))

        # 1. First check subtitles explicitly tagged with this recording_id
        explicit_subs = query.filter(Subtitle.recording_id == recording.id).all()
        if explicit_subs:
            return sorted(explicit_subs, key=lambda s: s.start_seconds or 0.0)

        # 2. Fallback to time-window matching for previously recorded takes
        rec_start = recording.created_at
        rec_duration = recording.duration_seconds if recording.duration_seconds > 0 else 7200.0
        time_subs = query.filter(
            Subtitle.created_at >= rec_start - timedelta(seconds=5),
            Subtitle.created_at <= rec_start + timedelta(seconds=rec_duration + 10)
        ).order_by(Subtitle.created_at.asc()).limit(limit).all()

        for sub in time_subs:
            if sub.start_seconds is None or sub.start_seconds == 0.0:
                diff = max(0.0, (sub.created_at - rec_start).total_seconds())
                sub.start_seconds = round(diff, 1)
                sub.end_seconds = round(diff + 3.0, 1)

        return sorted(time_subs, key=lambda s: s.start_seconds or 0.0)

    # Standard live mode: return top newest first
    query = db.query(Subtitle).filter(Subtitle.event_id == event.id)
    if search:
        query = query.filter(Subtitle.text.ilike(f"%{search}%"))
    
    subtitles = query.order_by(Subtitle.created_at.desc()).limit(limit).all()
    return subtitles

@router.get("/status", response_model=SubtitleStatusResponse)
def get_transcription_status(
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    """
    Returns the real-time status of the transcription worker for this event.
    """
    event, _ = event_and_member
    is_active = transcription_service.is_transcribing(event.id)
    count = db.query(Subtitle).filter(Subtitle.event_id == event.id).count()
    return SubtitleStatusResponse(
        is_active=is_active,
        event_id=event.id,
        model_name="Mesolitica Malaysian Whisper Small (INT8)",
        subtitles_count=count
    )

@router.post("/toggle")
async def toggle_transcription(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.STAGE_MANAGER)),
    db: Session = Depends(get_db)
):
    """
    Stage Manager or Admin manual toggle to start or stop live transcription.
    """
    event, _ = event_and_member
    currently_active = transcription_service.is_transcribing(event.id)
    if currently_active:
        await transcription_service.stop_event_transcription(event.id)
        return {"is_active": False, "message": "Transcription stopped"}
    else:
        await transcription_service.start_event_transcription(event.id, event.stream_key)
        return {"is_active": True, "message": "Transcription started"}

@router.delete("")
def clear_event_subtitles(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.STAGE_MANAGER)),
    db: Session = Depends(get_db)
):
    """
    Clears all recorded subtitle lines for this event.
    """
    event, _ = event_and_member
    db.query(Subtitle).filter(Subtitle.event_id == event.id).delete()
    db.commit()
    return {"message": "Subtitles cleared successfully"}

@router.websocket("/ws")
async def subtitle_websocket(
    websocket: WebSocket,
    event_id: str,
    token: str | None = Query(None)
):
    """
    Real-time WebSocket endpoint that streams closed captions and transcript lines
    directly to player overlays and the live transcript panel.
    """
    # Authenticate token from query param or headers
    auth_token = token
    if not auth_token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            auth_token = auth_header.split(" ", 1)[1]
    
    if not auth_token:
        # Check cookies
        auth_token = websocket.cookies.get("access_token")

    if not auth_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    payload = decode_access_token(auth_token)
    if not payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    db = SessionLocal()
    try:
        event = db.query(Event).filter((Event.id == event_id) | (Event.slug == event_id)).first()
        if not event:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        actual_event_id = event.id
    finally:
        db.close()

    await websocket.accept()
    await transcription_service.register_subscriber(actual_event_id, websocket)

    try:
        # Send initial connected status
        await websocket.send_json({
            "type": "connected",
            "event_id": actual_event_id,
            "is_transcribing": transcription_service.is_transcribing(actual_event_id)
        })

        # Keep connection open and respond to pings
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await transcription_service.unregister_subscriber(actual_event_id, websocket)

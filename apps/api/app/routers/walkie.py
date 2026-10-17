import json
import logging
import os
import secrets
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.config import WALKIE_DIR
from app.core.deps import require_event_access, require_min_role, get_current_user
from app.core.security import decode_access_token
from app.database import get_db, SessionLocal
from app.models.enums import EventRole, has_sufficient_role
from app.models.event import Event
from app.models.membership import Membership
from app.models.user import User
from app.models.walkie import WalkieCall
from app.schemas.walkie import WalkieCallResponse, WalkieStatusResponse, WalkiePresenceUser, WalkieActiveSpeaker
from app.services.walkie import walkie_service

logger = logging.getLogger("stagecontrol.walkie")
router = APIRouter(prefix="/events/{event_id}/walkie-talkie", tags=["walkie-talkie"])

def get_event_member_for_user(db: Session, event_id: str, user: User) -> Optional[Membership]:
    if user.is_superadmin:
        return Membership(user_id=user.id, event_id=event_id, role=EventRole.ADMIN)
    return db.query(Membership).filter(
        Membership.event_id == event_id,
        Membership.user_id == user.id
    ).first()

@router.get("/status", response_model=WalkieStatusResponse)
def get_walkie_status(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.CREW)),
    db: Session = Depends(get_db)
):
    """Returns current voice room status, connected crew members, and total calls."""
    event, _ = event_and_member
    users = walkie_service.get_connected_users(event.id)
    speaker_dict = walkie_service.active_speakers.get(event.id)
    speaker = WalkieActiveSpeaker(**speaker_dict) if speaker_dict else None
    count = db.query(WalkieCall).filter(WalkieCall.event_id == event.id).count()

    return WalkieStatusResponse(
        event_id=event.id,
        voice_room=f"{event.slug}-comms",
        connected_users=[WalkiePresenceUser(**u) for u in users],
        active_speaker=speaker,
        total_calls=count
    )

@router.get("/calls", response_model=list[WalkieCallResponse])
def get_walkie_calls(
    request: Request,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.CREW)),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Returns recorded push-to-talk calls for this event ordered newest first,
    including durations, audio URLs, and AI transcriptions.
    """
    event, _ = event_and_member
    query = db.query(WalkieCall).filter(WalkieCall.event_id == event.id)
    if search:
        query = query.filter(
            (WalkieCall.caller_name.ilike(f"%{search}%")) |
            (WalkieCall.transcription.ilike(f"%{search}%"))
        )

    calls = query.order_by(WalkieCall.created_at.desc()).limit(limit).all()

    base_api = str(request.base_url).rstrip('/')
    res = []
    for c in calls:
        res.append(WalkieCallResponse(
            id=c.id,
            event_id=c.event_id,
            caller_id=c.caller_id,
            caller_name=c.caller_name,
            caller_role=c.caller_role,
            audio_url=f"{base_api}/api/events/{event.id}/walkie-talkie/calls/{c.id}/audio",
            duration_seconds=c.duration_seconds,
            file_size_bytes=c.file_size_bytes,
            transcription=c.transcription,
            language=c.language,
            status=c.status,
            created_at=c.created_at
        ))
    return res

@router.get("/calls/{call_id}/audio")
def get_call_audio(
    request: Request,
    event_id: str,
    call_id: str,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Streams the recorded WAV audio file for browser replay with Range support.
    """
    auth_token = token
    if not auth_token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            auth_token = auth_header.split(" ", 1)[1]
    if not auth_token:
        auth_token = request.cookies.get("access_token")

    user = None
    if auth_token:
        payload = decode_access_token(auth_token)
        if payload and "sub" in payload:
            user = db.query(User).filter(User.id == payload["sub"]).first()
    
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    event = db.query(Event).filter((Event.id == event_id) | (Event.slug == event_id)).first()
    actual_event_id = event.id if event else event_id

    membership = get_event_member_for_user(db, actual_event_id, user)
    if not membership or not has_sufficient_role(membership.role, EventRole.CREW):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to walkie audio")

    call = db.query(WalkieCall).filter(
        WalkieCall.id == call_id,
        (WalkieCall.event_id == actual_event_id) | (WalkieCall.event_id == event_id)
    ).first()

    if not call:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Call recording not found")

    from pathlib import Path
    file_candidates = [
        WALKIE_DIR / actual_event_id / f"{call_id}.wav",
        WALKIE_DIR / event_id / f"{call_id}.wav",
        Path("/storage/walkie_talkie") / actual_event_id / f"{call_id}.wav",
        Path("/storage/walkie_talkie") / event_id / f"{call_id}.wav",
        Path("storage/walkie_talkie") / actual_event_id / f"{call_id}.wav",
        Path("storage/walkie_talkie") / event_id / f"{call_id}.wav",
    ]
    file_path = next((f for f in file_candidates if f.exists()), None)
    if not file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file missing on disk")

    return FileResponse(
        path=str(file_path),
        media_type="audio/wav",
        filename=f"walkie_{call_id[:8]}.wav"
    )

@router.delete("/calls/{call_id}")
def delete_walkie_call(
    call_id: str,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.STAGE_MANAGER)),
    db: Session = Depends(get_db)
):
    """Stage Manager or Admin deletion of an individual walkie call recording."""
    event, _ = event_and_member
    call = db.query(WalkieCall).filter(
        WalkieCall.id == call_id,
        WalkieCall.event_id == event.id
    ).first()

    if not call:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Call not found")

    file_path = WALKIE_DIR / event.id / f"{call_id}.wav"
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception:
            pass

    db.delete(call)
    db.commit()
    return {"message": "Call recording deleted successfully"}

@router.delete("/calls")
def clear_all_walkie_calls(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.STAGE_MANAGER)),
    db: Session = Depends(get_db)
):
    """Stage Manager or Admin clearing of all walkie recordings for this event."""
    event, _ = event_and_member
    calls = db.query(WalkieCall).filter(WalkieCall.event_id == event.id).all()
    for c in calls:
        p = WALKIE_DIR / event.id / f"{c.id}.wav"
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
        db.delete(c)
    db.commit()
    return {"message": "All walkie call recordings cleared"}

@router.websocket("/ws")
async def walkie_websocket(
    websocket: WebSocket,
    event_id: str,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Real-time Walkie-Talkie WebSocket:
    - Authenticates crew membership (Admin, Stage Manager, Crew only).
    - Bi-directional raw PCM binary voice streaming with ultra-low latency.
    - Live speaker state synchronization and automatic call archival.
    """
    auth_token = token
    if not auth_token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            auth_token = auth_header.split(" ", 1)[1]
    if not auth_token:
        auth_token = websocket.cookies.get("access_token")

    event = db.query(Event).filter((Event.id == event_id) | (Event.slug == event_id)).first()
    if not event:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    actual_event_id = event.id

    user = None
    role_val = EventRole.VIEWER.value
    caller_display_name = "Guest"

    if auth_token:
        payload = decode_access_token(auth_token)
        if payload and "sub" in payload:
            sub = payload["sub"]
            if payload.get("is_guest"):
                caller_display_name = payload.get("guest_name") or "Guest"
                role_val = payload.get("role") or EventRole.VIEWER.value
            else:
                user = db.query(User).filter(User.id == sub).first()
                if user:
                    membership = get_event_member_for_user(db, actual_event_id, user)
                    if membership and has_sufficient_role(membership.role, EventRole.CREW):
                        role_val = membership.role.value if hasattr(membership.role, "value") else str(membership.role)
                    elif user.is_superadmin:
                        role_val = EventRole.ADMIN.value
                    else:
                        role_val = EventRole.VIEWER.value
                    
                    # Prioritize logged in user's full_name or username (not email!)
                    caller_display_name = user.full_name or user.username or "Guest"

    if not user:
        # Not logged in / guest user
        guest_id = f"guest_{secrets.token_hex(4)}"
        user_info = {
            "user_id": guest_id,
            "caller_name": caller_display_name,
            "caller_role": role_val
        }
    else:
        user_info = {
            "user_id": user.id,
            "caller_name": caller_display_name,
            "caller_role": role_val
        }

    await websocket.accept()
    await walkie_service.register_connection(actual_event_id, websocket, user_info)

    try:
        # Send initial status
        speaker_dict = walkie_service.active_speakers.get(actual_event_id)
        await websocket.send_json({
            "type": "connected",
            "event_id": actual_event_id,
            "voice_room": f"{event.slug}-comms",
            "user": user_info,
            "active_speaker": speaker_dict,
            "connected_users": walkie_service.get_connected_users(actual_event_id)
        })

        while True:
            # Receive either binary audio data or text/json control frames
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                # Binary audio chunk from the transmitting mic
                await walkie_service.handle_audio_chunk(actual_event_id, websocket, message["bytes"])
            elif "text" in message and message["text"]:
                text_data = message["text"]
                if text_data == "ping":
                    await websocket.send_text("pong")
                    continue
                try:
                    data = json.loads(text_data)
                    msg_type = data.get("type")
                    if msg_type == "start_transmission":
                        tid = data.get("transmission_id")
                        if tid:
                            await walkie_service.handle_start_transmission(actual_event_id, websocket, tid, user_info)
                    elif msg_type == "end_transmission":
                        tid = data.get("transmission_id")
                        if tid:
                            await walkie_service.handle_end_transmission(actual_event_id, tid)
                except Exception as parse_err:
                    logger.debug(f"JSON parse error on walkie ws: {parse_err}")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"Walkie WebSocket closed with exception: {e}")
    finally:
        await walkie_service.unregister_connection(actual_event_id, websocket)

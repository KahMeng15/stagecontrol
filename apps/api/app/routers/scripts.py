import logging
import time
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.enums import EventRole, has_sufficient_role
from app.models.event import Event
from app.models.membership import Membership
from app.models.script import Script, ScriptSection, ScriptBlock
from app.models.user import User
from app.schemas.script import (
    ScriptResponse,
    ScriptSectionResponse,
    ScriptBlockResponse,
    ScriptBlockUpdate,
    ScriptTextImportRequest,
    ScriptJumpRequest,
    ScriptAutoJumpRequest,
)
from app.services.script_parser import parse_docx_bytes, parse_raw_text
from app.services.transcription import transcription_service

logger = logging.getLogger("stagecontrol.scripts")
router = APIRouter(prefix="/events/{event_id}/script", tags=["scripts"])

# In-memory tracking of currently active block, last match time, and auto-jump toggle per event
event_active_blocks: dict[str, str] = {}
event_last_script_match_time: dict[str, float] = {}
event_auto_jump: dict[str, bool] = {}

def resolve_event_and_membership(db: Session, event_id: str, user: User) -> tuple[Event, Membership]:
    event = db.query(Event).filter((Event.id == event_id) | (Event.slug == event_id)).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if user.is_superadmin:
        return event, Membership(user_id=user.id, event_id=event.id, role=EventRole.ADMIN)
    if user.id.startswith("guest_"):
        return event, Membership(user_id=user.id, event_id=event.id, role=EventRole.VIEWER)
    membership = db.query(Membership).filter(
        Membership.event_id == event.id,
        Membership.user_id == user.id
    ).first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return event, membership

@router.get("", response_model=Optional[ScriptResponse])
def get_event_script(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetches the active script for this event along with its sections and blocks."""
    event, _ = resolve_event_and_membership(db, event_id, current_user)
    actual_event_id = event.id

    script = db.query(Script).filter(
        Script.event_id == actual_event_id,
        Script.is_active == 1
    ).order_by(Script.version.desc()).first()

    if not script:
        return None

    # Compute total blocks
    total_blocks = sum(len(s.blocks) for s in script.sections)
    active_block = event_active_blocks.get(actual_event_id) or event_active_blocks.get(event_id)
    if actual_event_id in event_auto_jump:
        auto_jump = event_auto_jump[actual_event_id]
    elif event_id in event_auto_jump:
        auto_jump = event_auto_jump[event_id]
    else:
        auto_jump = bool(getattr(script, "auto_jump", False))
        event_auto_jump[actual_event_id] = auto_jump
        event_auto_jump[event_id] = auto_jump

    return ScriptResponse(
        id=script.id,
        event_id=script.event_id,
        title=script.title,
        version=script.version,
        is_active=script.is_active,
        created_at=script.created_at,
        updated_at=script.updated_at,
        sections=script.sections,
        total_blocks=total_blocks,
        active_block_id=active_block,
        auto_jump=auto_jump
    )

@router.post("/upload", response_model=ScriptResponse)
async def upload_script_file(
    event_id: str,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Uploads a .docx or text script file, parses columns (Speaker, Cues, Dialogue), and replaces active script."""
    event, membership = resolve_event_and_membership(db, event_id, current_user)
    if not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")
    actual_event_id = event.id

    content = await file.read()
    filename = file.filename or "script.docx"
    doc_title = title or filename.rsplit(".", 1)[0]

    try:
        if filename.lower().endswith((".docx", ".doc")):
            parsed_data = parse_docx_bytes(content, default_title=doc_title)
        else:
            # Plain text, markdown, CSV, TSV
            text_str = content.decode("utf-8", errors="replace")
            parsed_data = parse_raw_text(text_str, default_title=doc_title)
    except Exception as e:
        logger.error(f"Failed to parse uploaded script {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to parse document: {str(e)}")

    res = _persist_parsed_script(db, actual_event_id, parsed_data)
    await transcription_service.broadcast_subtitle(actual_event_id, {"type": "script_updated", "event_id": actual_event_id})
    if event_id != actual_event_id:
        await transcription_service.broadcast_subtitle(event_id, {"type": "script_updated", "event_id": event_id})
    return res

@router.post("/import-text", response_model=ScriptResponse)
def import_script_text(
    event_id: str,
    payload: ScriptTextImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Imports raw text (table-pasted, dialogue lines, or TSV) into structured script."""
    event, membership = resolve_event_and_membership(db, event_id, current_user)
    if not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")
    actual_event_id = event.id

    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Script text cannot be empty")

    parsed_data = parse_raw_text(payload.text, default_title=payload.title or "Imported Script")
    res = _persist_parsed_script(db, actual_event_id, parsed_data)
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(transcription_service.broadcast_subtitle(actual_event_id, {"type": "script_updated", "event_id": actual_event_id}))
        if event_id != actual_event_id:
            loop.create_task(transcription_service.broadcast_subtitle(event_id, {"type": "script_updated", "event_id": event_id}))
    except RuntimeError:
        pass
    return res

@router.post("/jump")
async def jump_script_block(
    event_id: str,
    payload: ScriptJumpRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Manual jump: sets the active script block and broadcasts to all connected viewers and crew."""
    event, membership = resolve_event_and_membership(db, event_id, current_user)
    if not has_sufficient_role(membership.role, EventRole.CREW):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Crew, Stage Manager or Admin permissions required")
    actual_event_id = event.id

    block = db.query(ScriptBlock).filter(ScriptBlock.id == payload.block_id).first()
    if not block:
        raise HTTPException(status_code=404, detail="Script block not found")

    event_active_blocks[actual_event_id] = payload.block_id
    event_active_blocks[event_id] = payload.block_id
    now_ts = time.time()
    event_last_script_match_time[actual_event_id] = now_ts
    event_last_script_match_time[event_id] = now_ts

    # Broadcast to all connected viewers & crew via transcription service WebSocket
    broadcast_payload = {
        "type": "script_jump",
        "event_id": actual_event_id,
        "block_id": payload.block_id,
        "section_id": block.section_id,
        "order_index": block.order_index,
        "speaker": block.speaker,
        "dialogue": block.dialogue,
        "cue": block.cue,
        "triggered_by": current_user.username or current_user.email
    }
    await transcription_service.broadcast_subtitle(actual_event_id, broadcast_payload)
    if event_id != actual_event_id:
        await transcription_service.broadcast_subtitle(event_id, broadcast_payload)

    return {"status": "ok", "active_block_id": payload.block_id}

@router.post("/auto-jump")
async def toggle_script_auto_jump(
    event_id: str,
    payload: ScriptAutoJumpRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toggles whether automatic speech sync can jump across scenes beyond ±5 lines."""
    event, membership = resolve_event_and_membership(db, event_id, current_user)
    if not has_sufficient_role(membership.role, EventRole.CREW):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Crew, Stage Manager or Admin permissions required")
    actual_event_id = event.id

    event_auto_jump[actual_event_id] = payload.enabled
    event_auto_jump[event_id] = payload.enabled

    # Persist in database on all scripts for this event
    scripts = db.query(Script).filter(Script.event_id == actual_event_id).all()
    for s in scripts:
        s.auto_jump = payload.enabled
    db.commit()

    broadcast_payload = {
        "type": "script_auto_jump_toggled",
        "event_id": actual_event_id,
        "enabled": payload.enabled,
        "triggered_by": current_user.username or current_user.email
    }
    await transcription_service.broadcast_subtitle(actual_event_id, broadcast_payload)
    if event_id != actual_event_id:
        await transcription_service.broadcast_subtitle(event_id, broadcast_payload)

    return {"status": "ok", "auto_jump": payload.enabled}

@router.delete("")
async def delete_event_script(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Deletes the active script for this event."""
    event, membership = resolve_event_and_membership(db, event_id, current_user)
    if not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")
    actual_event_id = event.id

    scripts = db.query(Script).filter(Script.event_id == actual_event_id).all()
    for s in scripts:
        db.delete(s)
    db.commit()

    event_active_blocks.pop(actual_event_id, None)
    event_active_blocks.pop(event_id, None)
    event_last_script_match_time.pop(actual_event_id, None)
    event_last_script_match_time.pop(event_id, None)
    event_auto_jump.pop(actual_event_id, None)
    event_auto_jump.pop(event_id, None)

    await transcription_service.broadcast_subtitle(actual_event_id, {
        "type": "script_deleted",
        "event_id": actual_event_id
    })
    if event_id != actual_event_id:
        await transcription_service.broadcast_subtitle(event_id, {
            "type": "script_deleted",
            "event_id": event_id
        })

    return {"status": "ok", "message": "Script removed"}

@router.post("/blocks/{block_id}/toggle-performance", response_model=ScriptBlockResponse)
async def toggle_block_performance(
    event_id: str,
    block_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toggles persistent performance/musical act state for a script line."""
    event, membership = resolve_event_and_membership(db, event_id, current_user)
    if not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")
    actual_event_id = event.id

    block = db.query(ScriptBlock).join(ScriptSection).join(Script).filter(
        Script.event_id == actual_event_id,
        ScriptBlock.id == block_id
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Script block not found")

    block.is_performance = not bool(block.is_performance)
    db.commit()
    db.refresh(block)

    # Broadcast update so all live viewers immediately reflect the persistent performance state
    update_msg = {
        "type": "script_updated",
        "event_id": actual_event_id,
        "block_id": block.id,
        "is_performance": block.is_performance
    }
    await transcription_service.broadcast_subtitle(actual_event_id, update_msg)
    if event_id != actual_event_id:
        await transcription_service.broadcast_subtitle(event_id, update_msg)

    return block

@router.patch("/blocks/{block_id}", response_model=ScriptBlockResponse)
async def update_script_block(
    event_id: str,
    block_id: str,
    payload: ScriptBlockUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Updates fields (including is_performance) on a script block."""
    event, membership = resolve_event_and_membership(db, event_id, current_user)
    if not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")
    actual_event_id = event.id

    block = db.query(ScriptBlock).join(ScriptSection).join(Script).filter(
        Script.event_id == actual_event_id,
        ScriptBlock.id == block_id
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Script block not found")

    if payload.is_performance is not None:
        block.is_performance = payload.is_performance
    if payload.speaker is not None:
        block.speaker = payload.speaker
    if payload.cue is not None:
        block.cue = payload.cue
    if payload.dialogue is not None:
        block.dialogue = payload.dialogue
    if payload.notes is not None:
        block.notes = payload.notes

    db.commit()
    db.refresh(block)

    update_msg = {
        "type": "script_updated",
        "event_id": actual_event_id,
        "block_id": block.id,
        "is_performance": block.is_performance
    }
    await transcription_service.broadcast_subtitle(actual_event_id, update_msg)
    if event_id != actual_event_id:
        await transcription_service.broadcast_subtitle(event_id, update_msg)

    return block

def _persist_parsed_script(db: Session, event_id: str, parsed_data: dict) -> ScriptResponse:
    """Helper to save parsed sections and blocks to SQLite database."""
    # Archive/deactivate previous scripts
    previous_scripts = db.query(Script).filter(Script.event_id == event_id).all()
    next_version = len(previous_scripts) + 1
    prev_active = next((ps for ps in previous_scripts if ps.is_active == 1), None)
    auto_jump_setting = bool(getattr(prev_active, "auto_jump", False)) if prev_active else (
        event_auto_jump.get(event_id, False)
    )
    for ps in previous_scripts:
        ps.is_active = 0

    script = Script(
        id=str(uuid.uuid4()),
        event_id=event_id,
        title=parsed_data.get("title", "Imported Script"),
        version=next_version,
        is_active=1,
        auto_jump=auto_jump_setting
    )
    db.add(script)
    db.flush()

    total_blocks = 0
    for s_idx, sec_data in enumerate(parsed_data.get("sections", [])):
        section = ScriptSection(
            id=str(uuid.uuid4()),
            script_id=script.id,
            title=sec_data.get("title", f"Section {s_idx + 1}"),
            order_index=s_idx
        )
        db.add(section)
        db.flush()

        for b_idx, blk_data in enumerate(sec_data.get("blocks", [])):
            block = ScriptBlock(
                id=str(uuid.uuid4()),
                section_id=section.id,
                order_index=blk_data.get("order_index", total_blocks),
                speaker=blk_data.get("speaker"),
                cue=blk_data.get("cue"),
                dialogue=blk_data.get("dialogue"),
                notes=blk_data.get("notes"),
                is_performance=bool(blk_data.get("is_performance", False))
            )
            db.add(block)
            total_blocks += 1

    db.commit()
    db.refresh(script)

    # Reset active block to first block if available
    first_block_id = None
    if script.sections and script.sections[0].blocks:
        first_block_id = script.sections[0].blocks[0].id
        event_active_blocks[event_id] = first_block_id

    # Refresh full tree
    script = db.query(Script).filter(Script.id == script.id).first()

    return ScriptResponse(
        id=script.id,
        event_id=script.event_id,
        title=script.title,
        version=script.version,
        is_active=script.is_active,
        created_at=script.created_at,
        updated_at=script.updated_at,
        sections=script.sections,
        total_blocks=total_blocks,
        active_block_id=first_block_id,
        auto_jump=bool(getattr(script, "auto_jump", auto_jump_setting))
    )

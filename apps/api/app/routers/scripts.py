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
)
from app.services.script_parser import parse_docx_bytes, parse_raw_text
from app.services.transcription import transcription_service

logger = logging.getLogger("stagecontrol.scripts")
router = APIRouter(prefix="/events/{event_id}/script", tags=["scripts"])

# In-memory tracking of currently active block and last match time per event
event_active_blocks: dict[str, str] = {}
event_last_script_match_time: dict[str, float] = {}

def get_event_membership(db: Session, event_id: str, user: User) -> Optional[Membership]:
    if user.is_superadmin:
        return Membership(user_id=user.id, event_id=event_id, role=EventRole.ADMIN)
    return db.query(Membership).filter(
        Membership.event_id == event_id,
        Membership.user_id == user.id
    ).first()

@router.get("", response_model=Optional[ScriptResponse])
def get_event_script(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetches the active script for this event along with its sections and blocks."""
    membership = get_event_membership(db, event_id, current_user)
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    script = db.query(Script).filter(
        Script.event_id == event_id,
        Script.is_active == 1
    ).order_by(Script.version.desc()).first()

    if not script:
        return None

    # Compute total blocks
    total_blocks = sum(len(s.blocks) for s in script.sections)
    active_block = event_active_blocks.get(event_id)

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
        active_block_id=active_block
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
    membership = get_event_membership(db, event_id, current_user)
    if not membership or not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")

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

    return _persist_parsed_script(db, event_id, parsed_data)

@router.post("/import-text", response_model=ScriptResponse)
def import_script_text(
    event_id: str,
    payload: ScriptTextImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Imports raw text (table-pasted, dialogue lines, or TSV) into structured script."""
    membership = get_event_membership(db, event_id, current_user)
    if not membership or not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")

    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Script text cannot be empty")

    parsed_data = parse_raw_text(payload.text, default_title=payload.title or "Imported Script")
    return _persist_parsed_script(db, event_id, parsed_data)

@router.post("/jump")
async def jump_script_block(
    event_id: str,
    payload: ScriptJumpRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Stage Manager manual jump: sets the active script block and broadcasts to all connected crew."""
    membership = get_event_membership(db, event_id, current_user)
    if not membership or not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")

    block = db.query(ScriptBlock).filter(ScriptBlock.id == payload.block_id).first()
    if not block:
        raise HTTPException(status_code=404, detail="Script block not found")

    event_active_blocks[event_id] = payload.block_id
    event_last_script_match_time[event_id] = time.time()

    # Broadcast to all crew via transcription service WebSocket
    broadcast_payload = {
        "type": "script_jump",
        "event_id": event_id,
        "block_id": payload.block_id,
        "section_id": block.section_id,
        "order_index": block.order_index,
        "speaker": block.speaker,
        "dialogue": block.dialogue,
        "cue": block.cue,
        "triggered_by": current_user.username or current_user.email
    }
    await transcription_service.broadcast_subtitle(event_id, broadcast_payload)

    return {"status": "ok", "active_block_id": payload.block_id}

@router.delete("")
async def delete_event_script(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Deletes the active script for this event."""
    membership = get_event_membership(db, event_id, current_user)
    if not membership or not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")

    scripts = db.query(Script).filter(Script.event_id == event_id).all()
    for s in scripts:
        db.delete(s)
    db.commit()

    event_active_blocks.pop(event_id, None)
    event_last_script_match_time.pop(event_id, None)

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
    membership = get_event_membership(db, event_id, current_user)
    if not membership or not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")

    block = db.query(ScriptBlock).join(ScriptSection).join(Script).filter(
        Script.event_id == event_id,
        ScriptBlock.id == block_id
    ).first()
    if not block:
        raise HTTPException(status_code=404, detail="Script block not found")

    block.is_performance = not bool(block.is_performance)
    db.commit()
    db.refresh(block)

    # Broadcast update so all live viewers immediately reflect the persistent performance state
    await transcription_service.broadcast_subtitle(event_id, {
        "type": "script_updated",
        "event_id": event_id,
        "block_id": block.id,
        "is_performance": block.is_performance
    })

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
    membership = get_event_membership(db, event_id, current_user)
    if not membership or not has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage Manager or Admin permissions required")

    block = db.query(ScriptBlock).join(ScriptSection).join(Script).filter(
        Script.event_id == event_id,
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

    await transcription_service.broadcast_subtitle(event_id, {
        "type": "script_updated",
        "event_id": event_id,
        "block_id": block.id,
        "is_performance": block.is_performance
    })

    return block

def _persist_parsed_script(db: Session, event_id: str, parsed_data: dict) -> ScriptResponse:
    """Helper to save parsed sections and blocks to SQLite database."""
    # Archive/deactivate previous scripts
    previous_scripts = db.query(Script).filter(Script.event_id == event_id).all()
    next_version = len(previous_scripts) + 1
    for ps in previous_scripts:
        ps.is_active = 0

    script = Script(
        id=str(uuid.uuid4()),
        event_id=event_id,
        title=parsed_data.get("title", "Imported Script"),
        version=next_version,
        is_active=1
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
        active_block_id=first_block_id
    )

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict

class ScriptBlockBase(BaseModel):
    order_index: int
    speaker: Optional[str] = None
    cue: Optional[str] = None
    dialogue: Optional[str] = None
    notes: Optional[str] = None

class ScriptBlockResponse(ScriptBlockBase):
    id: str
    section_id: str
    model_config = ConfigDict(from_attributes=True)

class ScriptSectionResponse(BaseModel):
    id: str
    script_id: str
    title: str
    order_index: int
    blocks: List[ScriptBlockResponse] = []
    model_config = ConfigDict(from_attributes=True)

class ScriptResponse(BaseModel):
    id: str
    event_id: str
    title: str
    version: int
    is_active: int
    created_at: datetime
    updated_at: datetime
    sections: List[ScriptSectionResponse] = []
    total_blocks: int = 0
    active_block_id: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

class ScriptTextImportRequest(BaseModel):
    text: str
    title: Optional[str] = "Imported Script"

class ScriptJumpRequest(BaseModel):
    block_id: str

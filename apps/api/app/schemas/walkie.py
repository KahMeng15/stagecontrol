from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, ConfigDict, field_serializer

class WalkieCallResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    caller_id: Optional[str] = None
    caller_name: str
    caller_role: str
    audio_url: str
    duration_seconds: float
    file_size_bytes: int
    transcription: Optional[str] = None
    language: str = "en"
    status: str = "completed"
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, dt: datetime, _info):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()

class WalkiePresenceUser(BaseModel):
    user_id: str
    caller_name: str
    caller_role: str

class WalkieActiveSpeaker(BaseModel):
    user_id: str
    caller_name: str
    caller_role: str
    transmission_id: str
    started_at: float

class WalkieStatusResponse(BaseModel):
    event_id: str
    voice_room: str
    connected_users: list[WalkiePresenceUser]
    active_speaker: Optional[WalkieActiveSpeaker] = None
    total_calls: int

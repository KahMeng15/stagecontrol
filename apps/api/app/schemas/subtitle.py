from datetime import datetime
from pydantic import BaseModel, ConfigDict

class SubtitleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    stream_key: str | None = None
    text: str
    language: str = "ms"
    start_seconds: float | None = None
    end_seconds: float | None = None
    confidence: float | None = None
    recording_id: str | None = None
    created_at: datetime

class SubtitleStatusResponse(BaseModel):
    is_active: bool
    event_id: str
    model_name: str
    subtitles_count: int

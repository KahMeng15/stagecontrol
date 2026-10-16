from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional

class StreamTrackInfo(BaseModel):
    codec: str
    type: str # "video" or "audio"

class StreamStatusResponse(BaseModel):
    is_live: bool
    ready: bool
    readers_count: int = 0
    bytes_received: int = 0
    tracks: list[str] = []
    rtmp_url: str
    webrtc_url: str
    webrtc_whep_url: str
    hls_url: str
    hls_playlist_url: str
    stream_key: Optional[str] = None

class RecordingResponse(BaseModel):
    id: str
    event_id: str
    title: str
    filename: str
    duration_seconds: float
    file_size_bytes: int
    status: str
    created_at: datetime
    stream_url: str
    download_url: str

    model_config = ConfigDict(from_attributes=True)

class RecordingUpdate(BaseModel):
    title: str

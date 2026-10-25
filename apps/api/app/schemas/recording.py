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
    webrtc_whip_url: Optional[str] = None
    hls_url: str
    hls_playlist_url: str
    hls_low_url: Optional[str] = None
    hls_low_playlist_url: Optional[str] = None
    webrtc_low_url: Optional[str] = None
    webrtc_low_whep_url: Optional[str] = None
    stream_key: Optional[str] = None
    ready_time: Optional[str] = None

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
    master_stream_url: Optional[str] = None
    download_url: str
    proxy_filename: Optional[str] = None
    proxy_size_bytes: Optional[int] = None
    is_optimized: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)

class MediaMTXAuthRequest(BaseModel):
    user: Optional[str] = ""
    password: Optional[str] = ""
    ip: Optional[str] = ""
    action: str = "publish"
    path: str = ""
    protocol: Optional[str] = ""
    id: Optional[str] = None
    query: Optional[str] = ""

    model_config = ConfigDict(extra="ignore")

class RecordingUpdate(BaseModel):
    title: str

class MarkerCreate(BaseModel):
    title: str
    description: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    recording_id: Optional[str] = None
    color: Optional[str] = "blue"

class MarkerUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    color: Optional[str] = None

class MarkerResponse(BaseModel):
    id: str
    event_id: str
    recording_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    color: str
    created_by_id: Optional[str] = None
    creator_callsign: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

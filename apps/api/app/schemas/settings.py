from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class SystemSettingsBase(BaseModel):
    primary_domain: str | None = Field(None, max_length=255, description="Primary domain used for public links, e.g. https://stage.example.edu")
    alternative_domain: str | None = Field(None, max_length=255, description="Alternative or local LAN domain, e.g. http://192.168.1.50:3000")
    registration_mode: str = Field("open", description="Registration policy: 'open', 'approval', or 'closed'")
    transcription_model: str = Field("SeamlessX/malaysian-faster-whisper-large-v3-turbo-v3-ct2", description="Active speech-to-text model identifier")
    transcription_languages: str = Field("en,ms,zh", description="Comma-separated allowed languages for transcription")

class SystemSettingsUpdate(BaseModel):
    primary_domain: str | None = None
    alternative_domain: str | None = None
    registration_mode: str | None = None
    transcription_model: str | None = None
    transcription_languages: str | None = None

class SystemSettingsResponse(SystemSettingsBase):
    id: str
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class TranscriptionModelInfo(BaseModel):
    id: str
    name: str
    repo_id: str
    category: str
    description: str
    size_estimate: str
    recommended: bool = False
    is_downloaded: bool = False
    size_on_disk: str | None = None
    size_bytes: int | None = None
    is_active: bool = False
    download_status: str = "idle"  # "idle" | "downloading" | "completed" | "failed"
    download_error: str | None = None

class TranscriptionSettingsResponse(BaseModel):
    active_model: str
    active_model_name: str
    is_loading: bool = False
    restricted_languages: list[str] = ["en", "ms", "zh"]
    restricted_language_names: list[str] = ["English (en)", "Bahasa Melayu / Malaysia (ms)", "Mandarin Chinese (zh)"]
    singleton_shared: bool = True
    models: list[TranscriptionModelInfo]

class DownloadModelRequest(BaseModel):
    model_id: str
    custom_repo: str | None = None

class ActivateModelRequest(BaseModel):
    model_id: str

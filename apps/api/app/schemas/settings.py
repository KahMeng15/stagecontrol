from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class SystemSettingsBase(BaseModel):
    primary_domain: str | None = Field(None, max_length=255, description="Primary domain used for public links, e.g. https://stage.example.edu")
    alternative_domain: str | None = Field(None, max_length=255, description="Alternative or local LAN domain, e.g. http://192.168.1.50:3000")
    registration_mode: str = Field("open", description="Registration policy: 'open', 'approval', or 'closed'")

class SystemSettingsUpdate(BaseModel):
    primary_domain: str | None = None
    alternative_domain: str | None = None
    registration_mode: str | None = None

class SystemSettingsResponse(SystemSettingsBase):
    id: str
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

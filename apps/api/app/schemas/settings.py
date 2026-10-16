from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class SystemSettingsBase(BaseModel):
    primary_domain: str | None = Field(None, max_length=255, description="Primary domain used for public links, e.g. https://stage.example.edu")
    alternative_domain: str | None = Field(None, max_length=255, description="Alternative or local LAN domain, e.g. http://192.168.1.50:3000")

class SystemSettingsUpdate(SystemSettingsBase):
    pass

class SystemSettingsResponse(SystemSettingsBase):
    id: str
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

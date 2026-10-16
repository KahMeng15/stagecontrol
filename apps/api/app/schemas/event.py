from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from app.models.enums import EventRole, EventStatus
from app.schemas.membership import MembershipResponse

class EventBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    description: str | None = None
    status: EventStatus = EventStatus.DRAFT

class EventCreate(EventBase):
    slug: str | None = Field(None, min_length=3, max_length=50)

class EventUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=150)
    description: str | None = None
    status: EventStatus | None = None

class EventResponse(EventBase):
    id: str
    slug: str
    created_by_id: str | None
    created_at: datetime
    updated_at: datetime
    user_role: EventRole | None = None
    stream_key: str | None = None  # Returned only for admins / stage managers
    public_pin: str | None = None  # Returned for admins / stage managers
    public_pin_enabled: bool = False

    model_config = ConfigDict(from_attributes=True)

class EventDetailResponse(EventResponse):
    memberships: list[MembershipResponse] = []

class PublicEventInfo(BaseModel):
    id: str
    name: str
    slug: str
    description: str | None = None
    status: EventStatus
    public_pin_enabled: bool

    model_config = ConfigDict(from_attributes=True)

class GuestPinLogin(BaseModel):
    pin: str = Field(..., min_length=6, max_length=6)
    display_name: str | None = Field(None, max_length=50)

class GuestAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    event: EventResponse
    display_name: str

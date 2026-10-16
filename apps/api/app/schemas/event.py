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

    model_config = ConfigDict(from_attributes=True)

class EventDetailResponse(EventResponse):
    memberships: list[MembershipResponse] = []

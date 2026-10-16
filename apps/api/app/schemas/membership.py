from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from app.models.enums import EventRole
from app.schemas.user import UserResponse

class MembershipBase(BaseModel):
    role: EventRole = EventRole.CREW
    callsign: str | None = None

class MembershipCreate(MembershipBase):
    username_or_email: str

class MembershipUpdate(BaseModel):
    role: EventRole | None = None
    callsign: str | None = None

class MembershipResponse(MembershipBase):
    id: str
    user_id: str
    event_id: str
    created_at: datetime
    updated_at: datetime
    user: UserResponse | None = None

    model_config = ConfigDict(from_attributes=True)

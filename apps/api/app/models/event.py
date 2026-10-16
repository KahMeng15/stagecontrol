import secrets
import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.enums import EventStatus

def generate_stream_key() -> str:
    return f"sk_{secrets.token_urlsafe(16)}"

def generate_slug() -> str:
    return secrets.token_hex(4)

def generate_public_pin() -> str:
    # 6-digit random number between 100000 and 999999
    return f"{secrets.randbelow(900000) + 100000}"

class Event(Base):
    __tablename__ = "events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(150), nullable=False)
    slug = Column(String(50), unique=True, index=True, default=generate_slug, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(30), default=EventStatus.DRAFT.value, nullable=False)
    
    stream_key = Column(String(64), unique=True, index=True, default=generate_stream_key, nullable=False)
    created_by_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # 6-digit public viewer PIN (revocable anytime)
    public_pin = Column(String(6), index=True, nullable=True)
    public_pin_enabled = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    creator = relationship("User", back_populates="created_events")
    memberships = relationship("Membership", back_populates="event", cascade="all, delete-orphan")
    scripts = relationship("Script", back_populates="event", cascade="all, delete-orphan")
    recordings = relationship("Recording", back_populates="event", cascade="all, delete-orphan")
    markers = relationship("VideoMarker", back_populates="event", cascade="all, delete-orphan")

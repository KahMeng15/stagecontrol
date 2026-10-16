import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.enums import EventRole

class Membership(Base):
    __tablename__ = "memberships"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(30), default=EventRole.CREW.value, nullable=False)
    callsign = Column(String(50), nullable=True)  # e.g., "SM 1", "Audio Op", "Presenter"

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "event_id", name="uq_membership_user_event"),
    )

    # Relationships
    user = relationship("User", back_populates="memberships")
    event = relationship("Event", back_populates="memberships")

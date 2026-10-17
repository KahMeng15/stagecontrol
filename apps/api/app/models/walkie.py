import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from app.database import Base

class WalkieCall(Base):
    __tablename__ = "walkie_calls"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    caller_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    
    caller_name = Column(String(100), nullable=False)
    caller_role = Column(String(30), default="crew", nullable=False)
    
    audio_path = Column(String(255), nullable=False)
    duration_seconds = Column(Float, default=0.0, nullable=False)
    file_size_bytes = Column(Integer, default=0, nullable=False)
    
    transcription = Column(Text, nullable=True)
    language = Column(String(10), default="en", nullable=False)
    status = Column(String(30), default="completed", nullable=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    event = relationship("Event", back_populates="walkie_calls")
    caller = relationship("User")

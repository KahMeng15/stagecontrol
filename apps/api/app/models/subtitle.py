import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import relationship
from app.database import Base

class Subtitle(Base):
    __tablename__ = "subtitles"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    stream_key = Column(String(64), nullable=True, index=True)
    text = Column(Text, nullable=False)
    language = Column(String(10), default="ms", nullable=False)
    start_seconds = Column(Float, nullable=True)
    end_seconds = Column(Float, nullable=True)
    confidence = Column(Float, nullable=True)

    recording_id = Column(String(36), ForeignKey("recordings.id", ondelete="SET NULL"), nullable=True, index=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    event = relationship("Event", back_populates="subtitles")
    recording = relationship("Recording", back_populates="subtitles")

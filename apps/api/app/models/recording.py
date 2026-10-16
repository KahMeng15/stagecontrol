import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from app.database import Base

class Recording(Base):
    __tablename__ = "recordings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(150), nullable=False)
    filename = Column(String(255), nullable=False)  # Relative to storage/recordings
    hls_path = Column(String(255), nullable=True)   # HLS master playlist path if generated
    duration_seconds = Column(Float, default=0.0, nullable=False)
    file_size_bytes = Column(Integer, default=0, nullable=False)
    status = Column(String(30), default="ready", nullable=False) # "recording", "processing", "ready", "failed"
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    event = relationship("Event", back_populates="recordings")

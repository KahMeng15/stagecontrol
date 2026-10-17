import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from app.database import Base

class Script(Base):
    __tablename__ = "scripts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(150), nullable=False)
    version = Column(Integer, default=1, nullable=False)
    is_active = Column(Integer, default=1, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    event = relationship("Event", back_populates="scripts")
    sections = relationship("ScriptSection", back_populates="script", cascade="all, delete-orphan", order_by="ScriptSection.order_index")

class ScriptSection(Base):
    __tablename__ = "script_sections"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    script_id = Column(String(36), ForeignKey("scripts.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(150), nullable=False)
    order_index = Column(Integer, default=0, nullable=False)

    script = relationship("Script", back_populates="sections")
    blocks = relationship("ScriptBlock", back_populates="section", cascade="all, delete-orphan", order_by="ScriptBlock.order_index")

class ScriptBlock(Base):
    __tablename__ = "script_blocks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    section_id = Column(String(36), ForeignKey("script_sections.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index = Column(Integer, default=0, nullable=False)
    speaker = Column(String(100), nullable=True) # e.g. "Host", "Dean", "MC"
    cue = Column(String(100), nullable=True)     # e.g. "LIGHTS UP", "MIC 1 LIVE", "SLIDE 4"
    dialogue = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    is_performance = Column(Boolean, default=False, nullable=False)

    section = relationship("ScriptSection", back_populates="blocks")

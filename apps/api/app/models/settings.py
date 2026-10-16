from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, String
from app.database import Base

class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(String(20), primary_key=True, default="default")
    primary_domain = Column(String(255), nullable=True, default="http://localhost:3000")
    alternative_domain = Column(String(255), nullable=True)
    
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

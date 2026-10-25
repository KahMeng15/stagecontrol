import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(255), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(100), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superadmin = Column(Boolean, default=False, nullable=False)
    approval_status = Column(String(20), default="approved", nullable=False)  # approved, pending, rejected

    last_login_at = Column(DateTime, nullable=True)
    last_login_ip = Column(String(45), nullable=True)
    last_login_device = Column(String(100), nullable=True)
    last_login_browser = Column(String(100), nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan")
    created_events = relationship("Event", back_populates="creator")
    login_logs = relationship("UserLoginLog", back_populates="user", cascade="all, delete-orphan", order_by="desc(UserLoginLog.created_at)")

class UserLoginLog(Base):
    __tablename__ = "user_login_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    device = Column(String(100), nullable=True)
    browser = Column(String(100), nullable=True)
    status = Column(String(20), default="success", nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

    user = relationship("User", back_populates="login_logs")


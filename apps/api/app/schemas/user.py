from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field

class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=100)
    username: str | None = None

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    full_name: str | None = None
    username: str | None = None  # Optional backwards compatibility; if omitted, defaults to email

class UserLogin(BaseModel):
    email: str | None = None
    username_or_email: str | None = None
    password: str

    @property
    def identifier(self) -> str:
        ident = self.email or self.username_or_email or ""
        return ident.strip().lower()

class UserResponse(BaseModel):
    id: str
    email: str
    username: str | None = None
    full_name: str | None = None
    is_active: bool
    is_superadmin: bool
    approval_status: str = "approved"
    last_login_at: datetime | None = None
    last_login_ip: str | None = None
    last_login_device: str | None = None
    last_login_browser: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class AdminUserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=6)
    is_superadmin: bool = False

class AdminUserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    is_superadmin: bool | None = None
    password: str | None = None

class UserStatusUpdate(BaseModel):
    is_active: bool | None = None
    approval_status: str | None = None  # "approved", "pending", "rejected"

class LoginLogResponse(BaseModel):
    id: str
    user_id: str
    ip_address: str | None = None
    device: str | None = None
    browser: str | None = None
    user_agent: str | None = None
    status: str = "success"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

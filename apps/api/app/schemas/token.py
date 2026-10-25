from pydantic import BaseModel
from app.schemas.user import UserResponse

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
    requires_approval: bool = False
    message: str | None = None

class TokenPayload(BaseModel):
    sub: str | None = None
    exp: int | None = None

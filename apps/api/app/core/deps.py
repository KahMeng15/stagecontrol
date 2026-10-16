from typing import Annotated, Callable
from fastapi import Depends, HTTPException, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.database import get_db
from app.models.enums import EventRole, has_sufficient_role
from app.models.event import Event
from app.models.membership import Membership
from app.models.user import User

security_scheme = HTTPBearer(auto_error=False)

def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security_scheme)]
) -> User:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = decode_access_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload["sub"]
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
        
    return user

def require_event_access(
    event_id: Annotated[str, Path(...)],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)]
) -> tuple[Event, Membership]:
    # Check if event_id is either UUID or slug
    event = db.query(Event).filter(
        (Event.id == event_id) | (Event.slug == event_id)
    ).first()
    
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )
    
    # If superadmin, grant synthetic admin access if not an explicit member
    membership = db.query(Membership).filter(
        Membership.event_id == event.id,
        Membership.user_id == current_user.id
    ).first()

    if not membership:
        if current_user.is_superadmin:
            # Synthetic membership for superadmin
            membership = Membership(
                id="superadmin",
                user_id=current_user.id,
                event_id=event.id,
                role=EventRole.ADMIN.value,
                callsign="Superadmin"
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this event"
            )

    return event, membership

def require_min_role(min_role: EventRole) -> Callable:
    def dependency(
        event_and_member: Annotated[tuple[Event, Membership], Depends(require_event_access)]
    ) -> tuple[Event, Membership]:
        event, membership = event_and_member
        if not has_sufficient_role(membership.role, min_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Action requires minimum '{min_role.value}' role (your role: '{membership.role}')"
            )
        return event, membership
    return dependency

import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from app.core.deps import get_current_user, require_event_access, require_min_role
from app.core.security import create_access_token
from app.database import get_db
from app.models.enums import EventRole, has_sufficient_role
from app.models.event import Event, generate_stream_key
from app.models.membership import Membership
from app.models.user import User
from app.schemas.event import (
    EventCreate,
    EventDetailResponse,
    EventResponse,
    EventUpdate,
    GuestAuthResponse,
    GuestPinLogin,
    PublicEventInfo,
)
from app.schemas.membership import MembershipCreate, MembershipResponse, MembershipUpdate

router = APIRouter(prefix="/events", tags=["Events & Crew"])

@router.get("", response_model=list[EventResponse])
def list_my_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.is_superadmin:
        events = db.query(Event).order_by(Event.created_at.desc()).all()
        result = []
        for ev in events:
            # find user's explicit membership if any
            membership = db.query(Membership).filter(
                Membership.event_id == ev.id,
                Membership.user_id == current_user.id
            ).first()
            user_role = membership.role if membership else EventRole.ADMIN.value
            ev_resp = EventResponse.model_validate(ev)
            ev_resp.user_role = EventRole(user_role)
            ev_resp.stream_key = ev.stream_key  # superadmin can see
            result.append(ev_resp)
        return result

    memberships = (
        db.query(Membership)
        .options(joinedload(Membership.event))
        .filter(Membership.user_id == current_user.id)
        .all()
    )

    result = []
    for m in memberships:
        ev = m.event
        ev_resp = EventResponse.model_validate(ev)
        ev_resp.user_role = EventRole(m.role)
        # Only expose stream key to admins and stage managers
        if has_sufficient_role(m.role, EventRole.STAGE_MANAGER):
            ev_resp.stream_key = ev.stream_key
        else:
            ev_resp.stream_key = None
        result.append(ev_resp)

    return result

@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    event_in: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Check slug uniqueness if provided
    slug = event_in.slug.lower().strip() if event_in.slug else secrets.token_hex(4)
    existing_slug = db.query(Event).filter(Event.slug == slug).first()
    if existing_slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Event slug/code already in use"
        )

    event = Event(
        name=event_in.name.strip(),
        slug=slug,
        description=event_in.description,
        status=event_in.status.value,
        created_by_id=current_user.id,
        stream_key=generate_stream_key()
    )
    db.add(event)
    db.flush()

    # Automatically add creator as ADMIN
    creator_membership = Membership(
        user_id=current_user.id,
        event_id=event.id,
        role=EventRole.ADMIN.value,
        callsign="Lead Admin"
    )
    db.add(creator_membership)
    db.commit()
    db.refresh(event)

    ev_resp = EventResponse.model_validate(event)
    ev_resp.user_role = EventRole.ADMIN
    ev_resp.stream_key = event.stream_key
    return ev_resp

@router.get("/{event_id}", response_model=EventDetailResponse)
def get_event(
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    event, membership = event_and_member
    
    # Fetch all members of this event
    memberships = (
        db.query(Membership)
        .options(joinedload(Membership.user))
        .filter(Membership.event_id == event.id)
        .all()
    )
    
    ev_resp = EventDetailResponse.model_validate(event)
    ev_resp.user_role = EventRole(membership.role)
    ev_resp.memberships = [MembershipResponse.model_validate(m) for m in memberships]

    # Show stream key and public PIN only to stage manager or admin
    if has_sufficient_role(membership.role, EventRole.STAGE_MANAGER):
        ev_resp.stream_key = event.stream_key
        ev_resp.public_pin = event.public_pin
    else:
        ev_resp.stream_key = None
        ev_resp.public_pin = None

    return ev_resp

@router.patch("/{event_id}", response_model=EventResponse)
def update_event(
    event_update: EventUpdate,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, membership = event_and_member
    if event_update.name is not None:
        event.name = event_update.name.strip()
    if event_update.description is not None:
        event.description = event_update.description
    if event_update.status is not None:
        event.status = event_update.status.value

    db.commit()
    db.refresh(event)

    ev_resp = EventResponse.model_validate(event)
    ev_resp.user_role = EventRole(membership.role)
    ev_resp.stream_key = event.stream_key
    ev_resp.public_pin = event.public_pin
    return ev_resp

@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, _ = event_and_member
    db.delete(event)
    db.commit()
    return None

@router.post("/{event_id}/regenerate-stream-key", response_model=EventResponse)
def regenerate_stream_key(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, membership = event_and_member
    event.stream_key = generate_stream_key()
    db.commit()
    db.refresh(event)

    ev_resp = EventResponse.model_validate(event)
    ev_resp.user_role = EventRole(membership.role)
    ev_resp.stream_key = event.stream_key
    ev_resp.public_pin = event.public_pin
    return ev_resp

# --- Public 6-Digit PIN Management ---

@router.post("/{event_id}/public-pin", response_model=EventResponse)
def generate_event_public_pin(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, membership = event_and_member
    from app.models.event import generate_public_pin
    
    event.public_pin = generate_public_pin()
    event.public_pin_enabled = True
    db.commit()
    db.refresh(event)

    ev_resp = EventResponse.model_validate(event)
    ev_resp.user_role = EventRole(membership.role)
    ev_resp.stream_key = event.stream_key
    ev_resp.public_pin = event.public_pin
    return ev_resp

@router.delete("/{event_id}/public-pin", response_model=EventResponse)
def revoke_event_public_pin(
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, membership = event_and_member
    event.public_pin_enabled = False
    event.public_pin = None
    db.commit()
    db.refresh(event)

    ev_resp = EventResponse.model_validate(event)
    ev_resp.user_role = EventRole(membership.role)
    ev_resp.stream_key = event.stream_key
    ev_resp.public_pin = None
    return ev_resp

# --- Membership Management ---

@router.get("/{event_id}/members", response_model=list[MembershipResponse])
def list_event_members(
    event_and_member: tuple[Event, Membership] = Depends(require_event_access),
    db: Session = Depends(get_db)
):
    event, _ = event_and_member
    members = (
        db.query(Membership)
        .options(joinedload(Membership.user))
        .filter(Membership.event_id == event.id)
        .all()
    )
    return [MembershipResponse.model_validate(m) for m in members]

@router.post("/{event_id}/members", response_model=MembershipResponse, status_code=status.HTTP_201_CREATED)
def add_event_member(
    member_in: MembershipCreate,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, _ = event_and_member
    identifier = member_in.username_or_email.lower().strip()
    target_user = db.query(User).filter(
        (User.username == identifier) | (User.email == identifier)
    ).first()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{member_in.username_or_email}' not found. Please ask them to register first."
        )

    # Check if already a member
    existing = db.query(Membership).filter(
        Membership.event_id == event.id,
        Membership.user_id == target_user.id
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a crew member of this event"
        )

    membership = Membership(
        event_id=event.id,
        user_id=target_user.id,
        role=member_in.role.value,
        callsign=member_in.callsign
    )
    db.add(membership)
    db.commit()
    db.refresh(membership)

    # Load relationship for response
    membership.user = target_user
    return MembershipResponse.model_validate(membership)

@router.patch("/{event_id}/members/{membership_id}", response_model=MembershipResponse)
def update_event_member(
    membership_id: str,
    update_in: MembershipUpdate,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, current_membership = event_and_member
    target_member = db.query(Membership).filter(
        Membership.id == membership_id,
        Membership.event_id == event.id
    ).first()

    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership record not found"
        )

    if update_in.role is not None:
        target_member.role = update_in.role.value
    if update_in.callsign is not None:
        target_member.callsign = update_in.callsign.strip()

    db.commit()
    db.refresh(target_member)
    return MembershipResponse.model_validate(target_member)

@router.delete("/{event_id}/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_event_member(
    membership_id: str,
    event_and_member: tuple[Event, Membership] = Depends(require_min_role(EventRole.ADMIN)),
    db: Session = Depends(get_db)
):
    event, current_membership = event_and_member
    target_member = db.query(Membership).filter(
        Membership.id == membership_id,
        Membership.event_id == event.id
    ).first()

    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership record not found"
        )

    # Don't let last admin delete their own membership
    if target_member.user_id == current_membership.user_id and target_member.role == EventRole.ADMIN.value:
        admin_count = db.query(Membership).filter(
            Membership.event_id == event.id,
            Membership.role == EventRole.ADMIN.value
        ).count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the only admin of an event"
            )

    db.delete(target_member)
    db.commit()
    return None

# --- Public 6-Digit PIN Guest Access (No Registration Needed) ---

@router.get("/public/info/{pin}", response_model=PublicEventInfo)
def get_public_event_info(pin: str, db: Session = Depends(get_db)):
    clean_pin = pin.strip()
    event = db.query(Event).filter(
        Event.public_pin == clean_pin,
        Event.public_pin_enabled == True
    ).first()
    
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid or expired 6-digit PIN"
        )
    return PublicEventInfo.model_validate(event)

@router.post("/public/join", response_model=GuestAuthResponse)
def join_with_public_pin(guest_in: GuestPinLogin, db: Session = Depends(get_db)):
    clean_pin = guest_in.pin.strip()
    event = db.query(Event).filter(
        Event.public_pin == clean_pin,
        Event.public_pin_enabled == True
    ).first()
    
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid or expired 6-digit PIN"
        )
    
    guest_uuid = secrets.token_hex(6)
    display_name = guest_in.display_name.strip() if guest_in.display_name and guest_in.display_name.strip() else "Guest Viewer"

    token = create_access_token(
        subject=f"guest_{guest_uuid}",
        extra_claims={
            "is_guest": True,
            "event_id": event.id,
            "event_slug": event.slug,
            "role": EventRole.VIEWER.value,
            "guest_name": display_name
        }
    )

    ev_resp = EventResponse.model_validate(event)
    ev_resp.user_role = EventRole.VIEWER
    ev_resp.stream_key = None
    ev_resp.public_pin = None

    return GuestAuthResponse(
        access_token=token,
        event=ev_resp,
        display_name=display_name
    )

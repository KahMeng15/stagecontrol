from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.deps import require_superadmin
from app.core.security import hash_password
from app.database import get_db
from app.models.user import User, UserLoginLog
from app.schemas.user import (
    AdminUserCreate,
    AdminUserUpdate,
    LoginLogResponse,
    UserResponse,
    UserStatusUpdate,
)

router = APIRouter(prefix="/admin/users", tags=["Admin User Management"])

@router.get("", response_model=list[UserResponse])
def list_users(
    query: str | None = Query(None, description="Search by name or email"),
    status_filter: str | None = Query(None, description="all, active, disabled, pending"),
    role_filter: str | None = Query(None, description="all, superadmin, crew"),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_superadmin),
):
    q = db.query(User)

    if query:
        search_pattern = f"%{query.strip().lower()}%"
        q = q.filter((User.email.ilike(search_pattern)) | (User.full_name.ilike(search_pattern)))

    if status_filter:
        s = status_filter.strip().lower()
        if s == "active":
            q = q.filter(User.is_active == True, User.approval_status == "approved")
        elif s == "disabled":
            q = q.filter(User.is_active == False, User.approval_status != "pending")
        elif s == "pending":
            q = q.filter(User.approval_status == "pending")

    if role_filter:
        r = role_filter.strip().lower()
        if r == "superadmin":
            q = q.filter(User.is_superadmin == True)
        elif r == "crew":
            q = q.filter(User.is_superadmin == False)

    users = q.order_by(User.created_at.desc()).all()
    return [UserResponse.model_validate(u) for u in users]

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user_by_admin(
    user_in: AdminUserCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_superadmin),
):
    email_clean = user_in.email.lower().strip()
    existing = db.query(User).filter(
        (User.email == email_clean) | (User.username == email_clean)
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email already exists."
        )

    user = User(
        username=email_clean,
        email=email_clean,
        full_name=user_in.full_name.strip(),
        hashed_password=hash_password(user_in.password),
        is_active=True,
        is_superadmin=user_in.is_superadmin,
        approval_status="approved",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)

@router.get("/{user_id}/logs", response_model=list[LoginLogResponse])
def get_user_login_logs(
    user_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_superadmin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    logs = (
        db.query(UserLoginLog)
        .filter(UserLoginLog.user_id == user_id)
        .order_by(UserLoginLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [LoginLogResponse.model_validate(log) for log in logs]

@router.patch("/{user_id}", response_model=UserResponse)
def update_user_by_admin(
    user_id: str,
    user_in: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_superadmin),
):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user_in.email is not None:
        email_clean = user_in.email.lower().strip()
        if email_clean != target_user.email:
            existing = db.query(User).filter(
                (User.email == email_clean) | (User.username == email_clean),
                User.id != user_id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This email address is already in use by another account."
                )
            target_user.email = email_clean
            target_user.username = email_clean

    if user_in.full_name is not None:
        cleaned_name = user_in.full_name.strip()
        if not cleaned_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Full name cannot be empty")
        target_user.full_name = cleaned_name

    if user_in.is_superadmin is not None:
        if not user_in.is_superadmin and target_user.is_superadmin:
            if target_user.id == admin_user.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="You cannot remove superadmin privileges from your own account."
                )
            superadmin_count = db.query(User).filter(User.is_superadmin == True, User.is_active == True).count()
            if superadmin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot demote the last active Lead Superadmin."
                )
        target_user.is_superadmin = user_in.is_superadmin

    if user_in.password is not None and user_in.password.strip():
        if len(user_in.password) < 6:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters")
        target_user.hashed_password = hash_password(user_in.password)

    db.commit()
    db.refresh(target_user)
    return UserResponse.model_validate(target_user)

@router.patch("/{user_id}/status", response_model=UserResponse)
def update_user_status(
    user_id: str,
    status_in: UserStatusUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_superadmin),
):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Guard: prevent deactivating own account
    if status_in.is_active is False and target_user.id == admin_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own administrator account."
        )

    # Guard: prevent deactivating last active superadmin
    if status_in.is_active is False and target_user.is_superadmin:
        active_superadmins = db.query(User).filter(User.is_superadmin == True, User.is_active == True).count()
        if active_superadmins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate the only active Lead Superadmin."
            )

    if status_in.approval_status is not None:
        new_status = status_in.approval_status.strip().lower()
        if new_status not in ("approved", "pending", "rejected"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid approval status")
        target_user.approval_status = new_status
        if new_status == "approved":
            target_user.is_active = True
        elif new_status == "rejected":
            target_user.is_active = False

    if status_in.is_active is not None:
        target_user.is_active = status_in.is_active

    db.commit()
    db.refresh(target_user)
    return UserResponse.model_validate(target_user)

@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_superadmin),
):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target_user.id == admin_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account while logged in."
        )

    if target_user.is_superadmin:
        superadmin_count = db.query(User).filter(User.is_superadmin == True).count()
        if superadmin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete the only remaining Lead Superadmin."
            )

    db.delete(target_user)
    db.commit()
    return {"message": f"User '{target_user.email}' has been successfully deleted."}


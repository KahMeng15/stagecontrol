from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.settings import SystemSettings
from app.models.user import User, UserLoginLog
from app.schemas.token import Token
from app.schemas.user import UserCreate, UserLogin, UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])

def parse_client_info(request: Request) -> tuple[str, str, str, str]:
    # Extract IP address prioritizing reverse-proxy headers
    x_forwarded = request.headers.get("x-forwarded-for")
    if x_forwarded:
        ip = x_forwarded.split(",")[0].strip()
    else:
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "127.0.0.1")

    ua = request.headers.get("user-agent", "")
    ua_lower = ua.lower()

    # Device classification
    if "iphone" in ua_lower:
        device = "iPhone"
    elif "ipad" in ua_lower:
        device = "iPad"
    elif "android" in ua_lower:
        device = "Android"
    elif "macintosh" in ua_lower or "mac os x" in ua_lower:
        device = "macOS"
    elif "windows" in ua_lower:
        device = "Windows"
    elif "cros" in ua_lower:
        device = "ChromeOS"
    elif "linux" in ua_lower:
        device = "Linux"
    else:
        device = "Unknown Device"

    # Browser classification
    if "edg/" in ua_lower or "edge/" in ua_lower:
        browser = "Edge"
    elif "opr/" in ua_lower or "opera/" in ua_lower:
        browser = "Opera"
    elif "chrome/" in ua_lower or "crios/" in ua_lower:
        browser = "Chrome"
    elif "firefox/" in ua_lower or "fxios/" in ua_lower:
        browser = "Firefox"
    elif "safari/" in ua_lower and "chrome/" not in ua_lower:
        browser = "Safari"
    else:
        browser = "Browser"

    return ip, device, browser, ua

@router.get("/registration-mode")
def get_registration_mode(db: Session = Depends(get_db)):
    settings_obj = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    mode = settings_obj.registration_mode if settings_obj and settings_obj.registration_mode else "open"
    return {"registration_mode": mode}

@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, request: Request, db: Session = Depends(get_db)):
    email_clean = user_in.email.lower().strip()
    username_clean = (user_in.username or email_clean).lower().strip()
    full_name_clean = (user_in.full_name or "").strip()
    if not full_name_clean:
        full_name_clean = email_clean.split("@")[0].replace(".", " ").title()

    # Check if user already exists
    existing_user = db.query(User).filter(
        (User.email == email_clean) | (User.username == username_clean)
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists."
        )

    # Check registration mode & bootstrap safety
    user_count = db.query(User).count()
    is_first_user = (user_count == 0)

    settings_obj = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    registration_mode = settings_obj.registration_mode if settings_obj and settings_obj.registration_mode else "open"

    # If not first user and mode is closed, deny registration
    if not is_first_user and registration_mode == "closed":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public self-registration is closed. Please ask your administrator to create your account."
        )

    # Determine approval status
    if is_first_user:
        is_active = True
        is_superadmin = True
        approval_status = "approved"
    elif registration_mode == "approval":
        is_active = False
        is_superadmin = False
        approval_status = "pending"
    else:  # open
        is_active = True
        is_superadmin = False
        approval_status = "approved"

    ip_address, device, browser, raw_ua = parse_client_info(request)
    now = datetime.now(timezone.utc)

    user = User(
        username=username_clean,
        email=email_clean,
        full_name=full_name_clean,
        hashed_password=hash_password(user_in.password),
        is_active=is_active,
        is_superadmin=is_superadmin,
        approval_status=approval_status,
        last_login_at=now if is_active else None,
        last_login_ip=ip_address if is_active else None,
        last_login_device=device if is_active else None,
        last_login_browser=browser if is_active else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    if not is_active:
        # Pending approval: do not issue access token
        return Token(
            access_token="",
            requires_approval=True,
            message="Registration submitted successfully! Your account is pending administrator approval before you can log in.",
            user=UserResponse.model_validate(user)
        )

    # Record first logon
    login_log = UserLoginLog(
        user_id=user.id,
        ip_address=ip_address,
        user_agent=raw_ua[:500] if raw_ua else None,
        device=device,
        browser=browser,
        status="success",
        created_at=now
    )
    db.add(login_log)
    db.commit()

    token = create_access_token(
        subject=user.id,
        extra_claims={"username": user.username, "is_superadmin": user.is_superadmin}
    )
    return Token(access_token=token, user=UserResponse.model_validate(user))

@router.post("/login", response_model=Token)
def login(login_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    identifier = login_data.identifier
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide your email address and password."
        )

    user = db.query(User).filter(
        (User.email == identifier) | (User.username == identifier)
    ).first()

    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.approval_status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account registration is awaiting administrator approval."
        )

    if user.approval_status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account registration was not approved."
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated. Please contact an administrator."
        )

    # Record login session details
    ip_address, device, browser, raw_ua = parse_client_info(request)
    now = datetime.now(timezone.utc)

    user.last_login_at = now
    user.last_login_ip = ip_address
    user.last_login_device = device
    user.last_login_browser = browser

    login_log = UserLoginLog(
        user_id=user.id,
        ip_address=ip_address,
        user_agent=raw_ua[:500] if raw_ua else None,
        device=device,
        browser=browser,
        status="success",
        created_at=now
    )
    db.add(login_log)
    db.commit()
    db.refresh(user)

    token = create_access_token(
        subject=user.id,
        extra_claims={"username": user.username, "is_superadmin": user.is_superadmin}
    )
    return Token(access_token=token, user=UserResponse.model_validate(user))

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)

@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    return {"message": "Successfully logged out"}

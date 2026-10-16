from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.deps import get_current_user, require_superadmin
from app.database import get_db
from app.models.settings import SystemSettings
from app.models.user import User
from app.schemas.settings import SystemSettingsResponse, SystemSettingsUpdate

router = APIRouter(prefix="/settings", tags=["System Settings"])

def get_or_create_settings(db: Session) -> SystemSettings:
    settings_obj = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    if not settings_obj:
        settings_obj = SystemSettings(
            id="default",
            primary_domain="http://localhost:3000",
            alternative_domain=None
        )
        db.add(settings_obj)
        db.commit()
        db.refresh(settings_obj)
    return settings_obj

@router.get("", response_model=SystemSettingsResponse)
def get_system_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    settings_obj = get_or_create_settings(db)
    return SystemSettingsResponse.model_validate(settings_obj)

@router.put("", response_model=SystemSettingsResponse)
def update_system_settings(
    settings_in: SystemSettingsUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_superadmin)
):
    settings_obj = get_or_create_settings(db)

    # Clean domain URLs (strip whitespace and trailing slashes)
    if settings_in.primary_domain is not None:
        p = settings_in.primary_domain.strip().rstrip("/")
        if p and not (p.startswith("http://") or p.startswith("https://")):
            p = f"https://{p}"
        settings_obj.primary_domain = p or None

    if settings_in.alternative_domain is not None:
        a = settings_in.alternative_domain.strip().rstrip("/")
        if a and not (a.startswith("http://") or a.startswith("https://")):
            a = f"https://{a}"
        settings_obj.alternative_domain = a or None

    db.commit()
    db.refresh(settings_obj)
    return SystemSettingsResponse.model_validate(settings_obj)

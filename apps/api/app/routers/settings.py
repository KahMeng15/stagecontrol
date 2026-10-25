from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.deps import get_current_user, require_superadmin
from app.database import get_db
from app.models.settings import SystemSettings
from app.models.user import User
from app.schemas.settings import (
    SystemSettingsResponse,
    SystemSettingsUpdate,
    TranscriptionSettingsResponse,
    DownloadModelRequest,
    ActivateModelRequest
)
from app.services.transcription import transcription_service

router = APIRouter(prefix="/settings", tags=["System Settings"])

def get_or_create_settings(db: Session) -> SystemSettings:
    settings_obj = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
    if not settings_obj:
        settings_obj = SystemSettings(
            id="default",
            primary_domain="http://localhost:3000",
            alternative_domain=None,
            registration_mode="open",
            transcription_model="SeamlessX/malaysian-faster-whisper-large-v3-turbo-v3-ct2",
            transcription_languages="en,ms,zh"
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

    if settings_in.registration_mode is not None:
        mode = settings_in.registration_mode.strip().lower()
        if mode not in ("open", "approval", "closed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Registration mode must be 'open', 'approval', or 'closed'"
            )
        settings_obj.registration_mode = mode

    if settings_in.transcription_model is not None:
        settings_obj.transcription_model = settings_in.transcription_model.strip()

    if settings_in.transcription_languages is not None:
        settings_obj.transcription_languages = settings_in.transcription_languages.strip()

    db.commit()
    db.refresh(settings_obj)
    return SystemSettingsResponse.model_validate(settings_obj)

@router.get("/transcription", response_model=TranscriptionSettingsResponse)
def get_transcription_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns available speech-to-text models, their local disk cache status,
    active model identifier, and restricted languages (en, ms, zh).
    """
    get_or_create_settings(db)
    status_dict = transcription_service.get_models_status()
    return TranscriptionSettingsResponse(**status_dict)

@router.post("/transcription/download")
async def download_transcription_model(
    req: DownloadModelRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Initiates asynchronous download of a speech-to-text model into persistent storage.
    """
    await transcription_service.download_model_async(req.model_id, req.custom_repo)
    return {"message": f"Download initiated for model '{req.model_id}'", "status": "downloading"}

@router.delete("/transcription/models/{model_id}")
def delete_transcription_model(
    model_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Deletes downloaded model files from persistent server storage.
    """
    status_dict = transcription_service.get_models_status()
    active_repo = status_dict.get("active_model", "")
    target_repo = transcription_service.resolve_repo_id(model_id)

    if active_repo.lower() == target_repo.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the currently active model. Please activate a different model first."
        )

    deleted = transcription_service.delete_model_files(model_id)
    return {"success": deleted, "message": f"Model '{model_id}' deleted from storage."}

@router.post("/transcription/activate")
async def activate_transcription_model(
    req: ActivateModelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Switches and hot-reloads the active speech model for both live feed and walkie-talkie.
    """
    target_repo = transcription_service.resolve_repo_id(req.model_id)
    status_dict = transcription_service.get_models_status()
    
    # Check if target model is downloaded
    model_entry = next((m for m in status_dict["models"] if m["repo_id"].lower() == target_repo.lower()), None)
    if model_entry and not model_entry["is_downloaded"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Model '{model_entry['name']}' is not yet downloaded. Please click 'Download' first before activating."
        )

    # Update DB setting
    settings_obj = get_or_create_settings(db)
    settings_obj.transcription_model = target_repo
    db.commit()

    # Hot reload memory model
    try:
        await transcription_service.reload_model(target_repo)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load model weights into memory: {e}"
        )

    updated_status = transcription_service.get_models_status()
    return {
        "message": f"Successfully activated unified model '{target_repo}'",
        "active_model": target_repo,
        "active_model_name": updated_status["active_model_name"],
    }

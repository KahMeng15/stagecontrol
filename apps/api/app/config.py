import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve storage directory:
# In Docker, /storage is mounted at the root.
# Locally in monorepo, storage/ is located 4 levels up from config.py: apps/api/app/config.py -> stagecontrol/storage
if Path("/storage").exists() and os.access("/storage", os.W_OK):
    STORAGE_DIR = Path("/storage")
else:
    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    STORAGE_DIR = repo_root / "storage"

DB_DIR = STORAGE_DIR / "db"
RECORDINGS_DIR = STORAGE_DIR / "recordings"

DB_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_DB_PATH = DB_DIR / "stageflow.db"

class Settings(BaseSettings):
    PROJECT_NAME: str = "StageControl"
    API_V1_STR: str = "/api"
    SECRET_KEY: str = "stagecontrol-super-secure-dev-secret-key-change-in-prod-2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    DATABASE_URL: str = f"sqlite:///{DEFAULT_DB_PATH}"
    
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    
    MEDIAMTX_API_URL: str = "http://localhost:9997"
    MEDIAMTX_HLS_URL: str = "http://localhost:8888"
    MEDIAMTX_WEBRTC_URL: str = "http://localhost:8889"
    MEDIAMTX_RTMP_URL: str = "rtmp://localhost:1935"

    # Whisper speech-to-text configuration (tiny is fast and CPU-friendly with ~1s latency)
    TRANSCRIPTION_MODEL: str = "tiny"
    TRANSCRIPTION_AUTO_START: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

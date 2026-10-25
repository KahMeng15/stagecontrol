from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import Base, engine
import app.models  # noqa: F401
from app.routers import admin_users, auth, events, scripts, settings as settings_router, streams, subtitles, walkie
from app.services.transcription import transcription_service

import logging
from pathlib import Path
from alembic.config import Config
from alembic import command

logger = logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize / upgrade SQLite database schema automatically
    try:
        ini_path = Path(__file__).resolve().parent.parent / "alembic.ini"
        if ini_path.exists():
            alembic_cfg = Config(str(ini_path))
            command.upgrade(alembic_cfg, "head")
            logger.info("Alembic migrations applied successfully.")
        else:
            Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.warning(f"Alembic auto-migration failed ({e}), falling back to Base.metadata.create_all.")
        Base.metadata.create_all(bind=engine)

    # Safe lightweight SQLite column migrations for new attributes
    try:
        from sqlalchemy import inspect, text
        with engine.connect() as conn:
            insp = inspect(conn)
            tables = insp.get_table_names()
            if "scripts" in tables:
                script_cols = [c["name"] for c in insp.get_columns("scripts")]
                if "auto_jump" not in script_cols:
                    conn.execute(text("ALTER TABLE scripts ADD COLUMN auto_jump BOOLEAN NOT NULL DEFAULT 0"))
                    conn.commit()
            if "script_blocks" in tables:
                block_cols = [c["name"] for c in insp.get_columns("script_blocks")]
                if "is_performance" not in block_cols:
                    conn.execute(text("ALTER TABLE script_blocks ADD COLUMN is_performance BOOLEAN NOT NULL DEFAULT 0"))
                    conn.commit()
            if "subtitles" in tables:
                sub_cols = [c["name"] for c in insp.get_columns("subtitles")]
                if "is_music" not in sub_cols:
                    conn.execute(text("ALTER TABLE subtitles ADD COLUMN is_music BOOLEAN NOT NULL DEFAULT 0"))
                    conn.commit()
            if "recordings" in tables:
                rec_cols = [c["name"] for c in insp.get_columns("recordings")]
                if "proxy_filename" not in rec_cols:
                    conn.execute(text("ALTER TABLE recordings ADD COLUMN proxy_filename VARCHAR(255)"))
                    conn.commit()
                if "proxy_size_bytes" not in rec_cols:
                    conn.execute(text("ALTER TABLE recordings ADD COLUMN proxy_size_bytes INTEGER"))
                    conn.commit()
                if "is_optimized" not in rec_cols:
                    conn.execute(text("ALTER TABLE recordings ADD COLUMN is_optimized INTEGER NOT NULL DEFAULT 0"))
                    conn.commit()
            if "system_settings" in tables:
                settings_cols = [c["name"] for c in insp.get_columns("system_settings")]
                if "registration_mode" not in settings_cols:
                    conn.execute(text("ALTER TABLE system_settings ADD COLUMN registration_mode VARCHAR(20) NOT NULL DEFAULT 'open'"))
                    conn.commit()
            if "users" in tables:
                user_cols = [c["name"] for c in insp.get_columns("users")]
                if "approval_status" not in user_cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'"))
                    conn.commit()
                if "last_login_at" not in user_cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN last_login_at DATETIME"))
                    conn.commit()
                if "last_login_ip" not in user_cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(45)"))
                    conn.commit()
                if "last_login_device" not in user_cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN last_login_device VARCHAR(100)"))
                    conn.commit()
                if "last_login_browser" not in user_cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN last_login_browser VARCHAR(100)"))
                    conn.commit()
                # Update existing user full_name if empty for kahmeng15@gmail.com
                conn.execute(text("UPDATE users SET full_name = 'Kah Meng' WHERE email = 'kahmeng15@gmail.com' AND (full_name IS NULL OR full_name = '')"))
                # Ensure username is email address
                conn.execute(text("UPDATE users SET username = email WHERE username != email"))
                conn.commit()
            # Ensure any new tables like user_login_logs are created
            Base.metadata.create_all(bind=engine)
    except Exception as col_err:
        logger.warning(f"Column check / alter table note: {col_err}")

    # Auto-repair corrupted mvhd headers in existing recordings on storage volume
    try:
        from app.services.video_processor import repair_all_recordings_in_storage
        repair_all_recordings_in_storage()
    except Exception as rep_err:
        logger.warning(f"Startup recordings repair check note: {rep_err}")

    # Start the automated stream transcription monitor
    await transcription_service.start_monitor()

    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if settings.CORS_ORIGINS else ["*"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(events.router, prefix=settings.API_V1_STR)
app.include_router(scripts.router, prefix=settings.API_V1_STR)
app.include_router(streams.router, prefix=settings.API_V1_STR)
app.include_router(streams.webhook_router, prefix=settings.API_V1_STR)
app.include_router(subtitles.router, prefix=settings.API_V1_STR)
app.include_router(settings_router.router, prefix=settings.API_V1_STR)
app.include_router(admin_users.router, prefix=settings.API_V1_STR)
app.include_router(walkie.router, prefix=settings.API_V1_STR)

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": "0.1.0"
    }

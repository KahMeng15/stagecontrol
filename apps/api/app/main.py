from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import Base, engine
import app.models  # noqa: F401
from app.routers import auth, events, scripts, settings as settings_router, streams, subtitles
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
app.include_router(subtitles.router, prefix=settings.API_V1_STR)
app.include_router(settings_router.router, prefix=settings.API_V1_STR)

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": "0.1.0"
    }

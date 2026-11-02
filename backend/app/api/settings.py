from fastapi import APIRouter
from app.config import settings
from app.schemas.requests import SettingsUpdateRequest
from app.schemas.responses import SettingsResponse
from app.services.audio_cache import audio_cache

router = APIRouter(tags=["Settings"])

@router.get("/settings", response_model=SettingsResponse)
def get_settings():
    """Returns local configuration and system limits."""
    return SettingsResponse(
        app_name=settings.app_name,
        version=settings.version,
        host=settings.host,
        port=settings.port,
        voices_dir=str(settings.voices_dir),
        cache_dir=str(settings.cache_dir),
        max_cache_size_bytes=settings.max_cache_size_bytes,
        max_cache_size_mb=round(settings.max_cache_size_bytes / (1024 * 1024), 2),
        default_voice_id=settings.default_voice_id,
        default_speed=settings.default_speed,
        max_text_length=settings.max_text_length,
        session_token=settings.session_token
    )

@router.put("/settings", response_model=SettingsResponse)
def update_settings(payload: SettingsUpdateRequest):
    """Updates permitted local configuration in memory."""
    if payload.max_cache_size_bytes is not None:
        settings.max_cache_size_bytes = payload.max_cache_size_bytes
        audio_cache.max_bytes = payload.max_cache_size_bytes
    if payload.default_voice_id is not None:
        settings.default_voice_id = payload.default_voice_id
    if payload.default_speed is not None:
        settings.default_speed = payload.default_speed
        
    return get_settings()

@router.post("/cache/clear")
def clear_cache():
    """Deletes all cached synthesis files to reclaim disk space."""
    count = audio_cache.clear()
    return {"message": f"Cache cleared successfully. Removed {count} audio files."}

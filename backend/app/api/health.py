from fastapi import APIRouter
from app.services.engine_manager import engine_manager
from app.services.piper_engine import piper_engine
from app.services.kokoro_engine import kokoro_engine
from app.schemas.responses import HealthResponse
from app.config import settings

router = APIRouter(tags=["Health"])

@router.get("/health", response_model=HealthResponse)
def get_health():
    """Returns backend status, Piper & Kokoro engine status, CPU status, and voice counts."""
    piper_health = piper_engine.health_check()
    kokoro_health = kokoro_engine.health_check()
    active_eng = engine_manager.get_active_engine()
    
    is_healthy = piper_health["status"] == "healthy" or kokoro_health["status"] == "healthy"
    
    total_voices = piper_health["installed_voices_count"] + kokoro_health["installed_voices_count"]

    return HealthResponse(
        status="healthy" if is_healthy else "degraded",
        active_engine=engine_manager.active_engine_id,
        piper_runtime=piper_health["piper_runtime"],
        kokoro_runtime=kokoro_health["kokoro_runtime"],
        cpu_execution=True,
        installed_voices_count=total_voices,
        piper_installed_voices=piper_health["installed_voices_count"],
        kokoro_installed_voices=kokoro_health["installed_voices_count"],
        current_loaded_voice=active_eng.current_voice_id,
        version=settings.version
    )

from fastapi import APIRouter
from app.services.piper_engine import piper_engine
from app.schemas.responses import HealthResponse

router = APIRouter(tags=["Health"])

@router.get("/health", response_model=HealthResponse)
def get_health():
    """Returns backend status, Piper runtime status, CPU status, and voice count."""
    return piper_engine.health_check()

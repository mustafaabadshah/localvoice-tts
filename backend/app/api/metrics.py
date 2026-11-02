from fastapi import APIRouter
from app.services.piper_engine import piper_engine

router = APIRouter(tags=["Metrics"])

@router.get("/metrics")
def get_metrics():
    """Returns lightweight operational metrics and cache hit rates."""
    return piper_engine.get_metrics()

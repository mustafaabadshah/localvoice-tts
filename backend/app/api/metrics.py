from fastapi import APIRouter
from app.services.engine_manager import engine_manager

router = APIRouter(tags=["Metrics"])

@router.get("/metrics")
def get_metrics():
    """
    Returns operational metrics, cache hit rates and model residency for both engines.

    Previously this exposed Piper's counters only, which could not answer the question that
    matters here: how many models are resident, and how long did each one take to load.
    """
    return engine_manager.get_metrics()


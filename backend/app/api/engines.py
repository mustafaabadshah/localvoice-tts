from fastapi import APIRouter, HTTPException, status
from app.services.engine_manager import engine_manager
from app.schemas.requests import EngineSelectRequest
from app.schemas.responses import EngineListResponse, EngineInfoResponse

router = APIRouter(prefix="/engines", tags=["Engines"])

@router.get("", response_model=EngineListResponse)
def list_engines():
    """Lists available TTS engines (Piper and Kokoro) and their installation / readiness status."""
    engines_data = engine_manager.list_engines()
    return EngineListResponse(
        active_engine=engine_manager.active_engine_id,
        engines=[EngineInfoResponse(**eng) for eng in engines_data]
    )

@router.post("/select", response_model=EngineInfoResponse)
def select_engine(req: EngineSelectRequest):
    """
    Selects the active TTS engine ('piper' or 'kokoro').
    Unloads the previous model from RAM and loads the newly selected engine.
    """
    result = engine_manager.select_engine(req.engine)
    result["is_active"] = True
    return EngineInfoResponse(**result)

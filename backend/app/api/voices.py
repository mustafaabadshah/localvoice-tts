from fastapi import APIRouter, HTTPException, status, Response, Query
from app.services.voice_manager import voice_manager
from app.services.engine_manager import engine_manager
from app.schemas.requests import VoiceTestRequest
from app.schemas.responses import VoiceListResponse, GenericVoiceResponse
from app.utils.security import validate_safe_filename

router = APIRouter(prefix="/voices", tags=["Voices"])

@router.get("", response_model=VoiceListResponse)
def list_voices(engine: str | None = Query(default=None, description="Filter by TTS engine ('piper' or 'kokoro')")):
    """Returns installed valid voices for the specified engine (or active engine)."""
    target_engine = engine or engine_manager.active_engine_id
    voices_data = engine_manager.list_voices(target_engine)
    return VoiceListResponse(
        engine=target_engine,
        total_count=len(voices_data),
        voices=[GenericVoiceResponse(**v) for v in voices_data]
    )

@router.get("/{voice_id}", response_model=GenericVoiceResponse)
def get_voice(voice_id: str, engine: str | None = Query(default=None, description="Engine identifier")):
    """Returns detailed metadata and validation status for a specific voice."""
    safe_id = validate_safe_filename(voice_id)
    target_engine = engine or engine_manager.active_engine_id
    voices = engine_manager.list_voices(target_engine)
    
    match = next((v for v in voices if v["voice_id"] == safe_id), None)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voice '{safe_id}' not found for engine '{target_engine}'."
        )
    return GenericVoiceResponse(**match)

@router.post("/test")
def test_voice(payload: VoiceTestRequest):
    """Generates a short test sample for the selected voice using the specified or active engine."""
    safe_id = validate_safe_filename(payload.voice_id)
    text = payload.sample_text or "This is a test of the LocalVoice speech generation system."
    target_engine = payload.engine or engine_manager.active_engine_id
    
    wav_bytes, was_cached, latency = engine_manager.synthesize(
        text=text,
        engine_id=target_engine,
        voice_id=safe_id,
        speed=1.0
    )
    
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-Engine": target_engine,
            "X-Cached": str(was_cached).lower(),
            "X-Latency-Seconds": f"{latency:.3f}",
            "Content-Disposition": f'inline; filename="test_{target_engine}_{safe_id}.wav"'
        }
    )

@router.delete("/{voice_id}")
def delete_voice(voice_id: str):
    """Deletes an installed voice model from local disk (Piper only)."""
    safe_id = validate_safe_filename(voice_id)
    success = voice_manager.delete_voice(safe_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Could not delete voice '{safe_id}'."
        )
    # If the deleted voice was active in memory, unload it
    piper_eng = engine_manager.get_engine("piper")
    if piper_eng.current_voice_id == safe_id:
        piper_eng.unload()
    return {"message": f"Voice '{safe_id}' deleted successfully."}

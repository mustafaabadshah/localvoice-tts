from fastapi import APIRouter, HTTPException, status, Response
from app.services.voice_manager import voice_manager, VoiceMetadata
from app.services.piper_engine import piper_engine
from app.schemas.requests import VoiceTestRequest
from app.schemas.responses import VoiceListResponse
from app.utils.security import validate_safe_filename

router = APIRouter(prefix="/voices", tags=["Voices"])

@router.get("", response_model=VoiceListResponse)
def list_voices():
    """Returns installed valid voices and metadata."""
    voices = voice_manager.list_voices()
    return VoiceListResponse(total_count=len(voices), voices=voices)

@router.get("/{voice_id}", response_model=VoiceMetadata)
def get_voice(voice_id: str):
    """Returns detailed metadata and validation status for a specific voice."""
    safe_id = validate_safe_filename(voice_id)
    voice = voice_manager.get_voice(safe_id)
    if not voice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voice '{safe_id}' not found among installed voices."
        )
    return voice

@router.post("/test")
def test_voice(payload: VoiceTestRequest):
    """Generates a short test sample for the selected voice."""
    safe_id = validate_safe_filename(payload.voice_id)
    text = payload.sample_text or "This is a test of the LocalVoice speech generation system."
    
    wav_bytes, was_cached, latency = piper_engine.synthesize(
        text=text,
        voice_id=safe_id,
        speed=1.0
    )
    
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-Cached": str(was_cached).lower(),
            "X-Latency-Seconds": f"{latency:.3f}",
            "Content-Disposition": f'inline; filename="test_{safe_id}.wav"'
        }
    )

@router.delete("/{voice_id}")
def delete_voice(voice_id: str):
    """Deletes an installed voice model from local disk."""
    safe_id = validate_safe_filename(voice_id)
    success = voice_manager.delete_voice(safe_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Could not delete voice '{safe_id}'."
        )
    # If the deleted voice was in memory, unload it
    if piper_engine.current_voice_id == safe_id:
        piper_engine.unload()
    return {"message": f"Voice '{safe_id}' deleted successfully."}

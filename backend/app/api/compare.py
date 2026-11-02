from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from pathlib import Path
from app.config import settings
from app.services.engine_manager import engine_manager
from app.schemas.requests import ComparisonRequest
from app.schemas.responses import ComparisonResponse

router = APIRouter(prefix="/compare", tags=["Comparison"])

@router.post("", response_model=ComparisonResponse)
def compare_engines(req: ComparisonRequest):
    """
    Runs sequential side-by-side benchmark comparison between Piper and Kokoro on exact input text.
    Measures latency, RTF, memory footprint, and generates separate audio playback references.
    """
    result = engine_manager.compare_engines(
        text=req.text,
        piper_voice_id=req.piper_voice_id,
        kokoro_voice_id=req.kokoro_voice_id,
        speed=req.speed
    )
    return ComparisonResponse(**result)

@router.get("/audio/{audio_id}")
def get_comparison_audio(audio_id: str):
    """Serves generated WAV audio for side-by-side comparison."""
    # Sanitize audio_id to prevent path traversal
    safe_name = Path(audio_id).name
    file_path = settings.compare_dir / safe_name
    
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Comparison audio file '{audio_id}' not found or expired."
        )

    audio_bytes = file_path.read_bytes()
    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'inline; filename="{safe_name}"',
            "Cache-Control": "public, max-age=3600"
        }
    )

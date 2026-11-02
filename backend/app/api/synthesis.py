from fastapi import APIRouter, Response
from app.services.engine_manager import engine_manager
from app.schemas.requests import SynthesisRequest

router = APIRouter(tags=["Synthesis"])

@router.post("/synthesize")
def synthesize_speech(payload: SynthesisRequest):
    """
    Synthesizes paragraph or text segment into standard WAV audio using the selected or active engine.
    Processes one paragraph at a time and returns audio stream/bytes.
    """
    target_engine = payload.engine or engine_manager.active_engine_id

    wav_bytes, was_cached, latency = engine_manager.synthesize(
        text=payload.text,
        engine_id=target_engine,
        voice_id=payload.voice_id,
        speed=payload.speed,
        speaker_id=payload.speaker_id
    )

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-Engine": target_engine,
            "X-Cached": str(was_cached).lower(),
            "X-Latency-Seconds": f"{latency:.3f}",
            "Content-Length": str(len(wav_bytes)),
            "Cache-Control": "public, max-age=86400"
        }
    )

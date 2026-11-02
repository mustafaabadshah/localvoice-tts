from fastapi import APIRouter, Response
from app.services.piper_engine import piper_engine
from app.schemas.requests import SynthesisRequest

router = APIRouter(tags=["Synthesis"])

@router.post("/synthesize")
def synthesize_speech(payload: SynthesisRequest):
    """
    Synthesizes paragraph or text segment into standard WAV audio.
    Processes one paragraph at a time and returns audio stream/bytes.
    """
    wav_bytes, was_cached, latency = piper_engine.synthesize(
        text=payload.text,
        voice_id=payload.voice_id,
        speed=payload.speed,
        speaker_id=payload.speaker_id
    )

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-Cached": str(was_cached).lower(),
            "X-Latency-Seconds": f"{latency:.3f}",
            "Content-Length": str(len(wav_bytes)),
            "Cache-Control": "public, max-age=86400"
        }
    )

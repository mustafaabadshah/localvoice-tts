import asyncio
import threading
from fastapi import APIRouter, Request, Response
from app.services.cancellation import SynthesisAbandoned
from app.services.engine_manager import engine_manager
from app.schemas.requests import SynthesisRequest
from app.utils.logging import logger

router = APIRouter(tags=["Synthesis"])

# 499 is nginx's "client closed request" - never delivered, the socket is already gone. It exists
# so an abandoned request is distinguishable from a real failure in metrics and logs.
CLIENT_CLOSED_REQUEST = 499
DISCONNECT_POLL_SECONDS = 0.25

async def _watch_disconnect(request: Request, cancel: threading.Event) -> None:
    """Sets ``cancel`` as soon as the client hangs up on this request."""
    while not cancel.is_set():
        if await request.is_disconnected():
            cancel.set()
            return
        await asyncio.sleep(DISCONNECT_POLL_SECONDS)

@router.post("/synthesize")
async def synthesize_speech(payload: SynthesisRequest, request: Request):
    """
    Synthesizes paragraph or text segment into standard WAV audio using the selected or active engine.
    Processes one paragraph at a time and returns audio stream/bytes.

    A paragraph the client has given up on (language change, panel switch, closed popup) is
    dropped before it reaches the engine whenever the disconnect arrives in time: ONNX cannot be
    interrupted mid-inference, but it must not be *started* for nobody.
    """
    target_engine = payload.engine or engine_manager.active_engine_id
    cancel = threading.Event()
    watcher = asyncio.create_task(_watch_disconnect(request, cancel))

    try:
        # Inference is CPU-bound: keep it off the event loop so the watcher can poll while it
        # runs, and so concurrent requests stay answerable.
        wav_bytes, was_cached, latency = await asyncio.to_thread(
            engine_manager.synthesize,
            text=payload.text,
            engine_id=target_engine,
            voice_id=payload.voice_id,
            speed=payload.speed,
            speaker_id=payload.speaker_id,
            cancel=cancel
        )
    except SynthesisAbandoned:
        logger.info(f"Abandoned synthesis request not started: engine={target_engine}")
        return Response(status_code=CLIENT_CLOSED_REQUEST)
    finally:
        cancel.set()
        watcher.cancel()

    load_seconds = float(
        engine_manager.get_engine(target_engine).get_engine_info().get("load_seconds") or 0.0
    )

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-Engine": target_engine,
            "X-Cached": str(was_cached).lower(),
            "X-Latency-Seconds": f"{latency:.3f}",
            # Load and inference are reported separately so the client (and the log reader) can
            # tell a model reload apart from genuinely slow synthesis.
            "X-Engine-Load-Seconds": f"{load_seconds:.2f}",
            "Content-Length": str(len(wav_bytes)),
            "Cache-Control": "public, max-age=86400"
        }
    )

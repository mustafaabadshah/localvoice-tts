from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.utils.logging import logger
from app.utils.security import is_allowed_origin
from app.services.cancellation import SynthesisAbandoned
from app.services.engine_manager import engine_manager

from app.api.health import router as health_router
from app.api.engines import router as engines_router
from app.api.voices import router as voices_router
from app.api.synthesis import router as synthesis_router
from app.api.compare import router as compare_router
from app.api.settings import router as settings_router
from app.api.metrics import router as metrics_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Initializing LocalVoice V2 Backend (Active Engine: {engine_manager.active_engine_id})...")
    # Warm the engine the user actually reads with, not just the default. See
    # docs/v2_9_engine_warmth.md - the controller idle-stops this process, so cold-start voice
    # loading was a recurring cost, not a one-time one.
    engine_manager.warm_startup_engine()
    yield
    logger.info("Shutting down LocalVoice Backend, releasing loaded models from memory...")
    for eng in engine_manager._engines.values():
        eng.unload()

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Privacy-first, CPU-optimized local webpage read-aloud TTS backend with Dual Engines (Piper & Kokoro).",
    lifespan=lifespan
)

# Custom Origin validation middleware
@app.middleware("http")
async def security_origin_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and not is_allowed_origin(origin):
        logger.warning(f"Blocked unauthorized request from origin: {origin}")
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Forbidden: Untrusted client origin."}
        )
    return await call_next(request)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|moz-extension://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Engine", "X-Cached", "X-Latency-Seconds", "X-Engine-Load-Seconds", "Content-Length"]
)

# A request whose client hung up before it could start is not a server error. 499 is nginx's
# "client closed request"; it is never delivered (the socket is gone) and exists only so logs and
# metrics can tell an abandoned request apart from a failed one.
@app.exception_handler(SynthesisAbandoned)
async def abandoned_synthesis_handler(request: Request, exc: SynthesisAbandoned):
    logger.info(f"Abandoned synthesis request on {request.url.path}: {exc}")
    return JSONResponse(status_code=499, content={"detail": "Client abandoned the request"})


# Include Routers with /api/v1 prefix
app.include_router(health_router, prefix="/api/v1")
app.include_router(engines_router, prefix="/api/v1")
app.include_router(voices_router, prefix="/api/v1")
app.include_router(synthesis_router, prefix="/api/v1")
app.include_router(compare_router, prefix="/api/v1")
app.include_router(settings_router, prefix="/api/v1")
app.include_router(metrics_router, prefix="/api/v1")

@app.get("/")
def root():
    return {
        "service": settings.app_name,
        "version": settings.version,
        "status": "online",
        "active_engine": engine_manager.active_engine_id,
        "health": "/api/v1/health",
        "docs": "/docs"
    }

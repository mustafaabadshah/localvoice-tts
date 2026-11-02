from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.utils.logging import logger
from app.utils.security import is_allowed_origin
from app.services.piper_engine import piper_engine

from app.api.health import router as health_router
from app.api.voices import router as voices_router
from app.api.synthesis import router as synthesis_router
from app.api.settings import router as settings_router
from app.api.metrics import router as metrics_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing LocalVoice Piper TTS Backend...")
    piper_engine.initialize()
    yield
    logger.info("Shutting down LocalVoice Backend, releasing loaded models...")
    piper_engine.unload()

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Privacy-first, CPU-optimized local webpage read-aloud TTS backend powered by Piper.",
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
    expose_headers=["X-Cached", "X-Latency-Seconds", "Content-Length"]
)

# Include Routers with /api/v1 prefix
app.include_router(health_router, prefix="/api/v1")
app.include_router(voices_router, prefix="/api/v1")
app.include_router(synthesis_router, prefix="/api/v1")
app.include_router(settings_router, prefix="/api/v1")
app.include_router(metrics_router, prefix="/api/v1")

@app.get("/")
def root():
    return {
        "service": settings.app_name,
        "version": settings.version,
        "status": "online",
        "health": "/api/v1/health",
        "docs": "/docs"
    }

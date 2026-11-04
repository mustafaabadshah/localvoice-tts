import os
import secrets
from pathlib import Path
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseModel):
    app_name: str = "LocalVoice Backend"
    version: str = "2.0.0"
    host: str = "127.0.0.1"
    port: int = 8765
    
    voices_dir: Path = Field(default_factory=lambda: BASE_DIR / "voices")
    cache_dir: Path = Field(default_factory=lambda: BASE_DIR / "cache")
    compare_dir: Path = Field(default_factory=lambda: BASE_DIR / "cache" / "compare")
    data_dir: Path = Field(default_factory=lambda: BASE_DIR / "data")
    # Remembers the engine/voice the user actually reads with, so a cold start warms that one
    # instead of the default. See docs/v2_9_engine_warmth.md.
    state_file: Path = Field(default_factory=lambda: BASE_DIR / "data" / "state.json")
    
    # 250 MB bounded cache default
    max_cache_size_bytes: int = 250 * 1024 * 1024
    
    default_engine: str = "piper"
    default_voice_id: str = "en_US-lessac-medium"
    default_kokoro_voice_id: str = "af_heart"
    default_speed: float = 1.0

    # --- Model residency policy (docs/v2_9_engine_warmth.md) -------------------------------
    # Keeping both engines resident makes an engine/voice switch a pointer flip instead of a
    # 5-11 s (Kokoro session) or 8-24 s (Piper voice) reload. Set LOCALVOICE_KEEP_WARM=0 to
    # restore strict one-model-at-a-time behaviour.
    keep_engines_warm: bool = True
    # Only releasable when RAM is tight: the idle engine is dropped above this working set.
    max_resident_rss_mb: int = 1600
    # Load the persisted engine during startup instead of waiting for the first request.
    warm_on_start: bool = True
    # How long a request may wait for an engine that is busy before it is given up on.
    lock_wait_seconds: float = 45.0
    
    # Kokoro paths
    kokoro_model_name: str = "kokoro-v1.0.int8.onnx"
    kokoro_voices_file: str = "voices-v1.0.bin"
    
    # Max text limit per request block (characters)
    max_text_length: int = 4000
    
    # Security session token
    session_token: str = Field(default_factory=lambda: secrets.token_hex(16))
    
    # CORS allowed origins
    allowed_origins: list[str] = [
        "http://127.0.0.1:8765",
        "http://localhost:8765",
    ]

settings = Settings()


def _env_flag(name: str, default: bool) -> bool:
    """Reads a boolean switch from the environment; anything but 0/false/no/off enables it."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off", "")


# Deployment switches. Defaults are the shipped behaviour; these exist so an operator (or a
# test suite) can opt back into strict single-model residency without editing code.
settings.keep_engines_warm = _env_flag("LOCALVOICE_KEEP_WARM", settings.keep_engines_warm)
settings.warm_on_start = _env_flag("LOCALVOICE_WARM_START", settings.warm_on_start)
_state_file = os.getenv("LOCALVOICE_STATE_FILE")
if _state_file:
    settings.state_file = Path(_state_file)
_rss_cap = os.getenv("LOCALVOICE_MAX_RSS_MB")
if _rss_cap:
    try:
        settings.max_resident_rss_mb = int(_rss_cap)
    except ValueError:
        pass

# Ensure directories exist
settings.voices_dir.mkdir(parents=True, exist_ok=True)
settings.cache_dir.mkdir(parents=True, exist_ok=True)
settings.compare_dir.mkdir(parents=True, exist_ok=True)
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.state_file.parent.mkdir(parents=True, exist_ok=True)
(settings.voices_dir / "kokoro").mkdir(parents=True, exist_ok=True)

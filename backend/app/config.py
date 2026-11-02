from pathlib import Path
from pydantic import BaseModel, Field
import secrets

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseModel):
    app_name: str = "LocalVoice Backend"
    version: str = "2.0.0"
    host: str = "127.0.0.1"
    port: int = 8765
    
    voices_dir: Path = Field(default_factory=lambda: BASE_DIR / "voices")
    cache_dir: Path = Field(default_factory=lambda: BASE_DIR / "cache")
    compare_dir: Path = Field(default_factory=lambda: BASE_DIR / "cache" / "compare")
    
    # 250 MB bounded cache default
    max_cache_size_bytes: int = 250 * 1024 * 1024
    
    default_engine: str = "piper"
    default_voice_id: str = "en_US-lessac-medium"
    default_kokoro_voice_id: str = "af_heart"
    default_speed: float = 1.0
    
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

# Ensure directories exist
settings.voices_dir.mkdir(parents=True, exist_ok=True)
settings.cache_dir.mkdir(parents=True, exist_ok=True)
settings.compare_dir.mkdir(parents=True, exist_ok=True)
(settings.voices_dir / "kokoro").mkdir(parents=True, exist_ok=True)

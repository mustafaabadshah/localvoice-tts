from pydantic import BaseModel
from app.services.voice_manager import VoiceMetadata

class HealthResponse(BaseModel):
    status: str
    piper_runtime: str
    cpu_execution: bool
    installed_voices_count: int
    current_loaded_voice: str | None
    version: str

class VoiceListResponse(BaseModel):
    total_count: int
    voices: list[VoiceMetadata]

class SettingsResponse(BaseModel):
    app_name: str
    version: str
    host: str
    port: int
    voices_dir: str
    cache_dir: str
    max_cache_size_bytes: int
    max_cache_size_mb: float
    default_voice_id: str
    default_speed: float
    max_text_length: int
    session_token: str

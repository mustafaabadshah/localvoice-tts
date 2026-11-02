from pydantic import BaseModel
from typing import Any

class EngineInfoResponse(BaseModel):
    id: str
    name: str
    installed: bool
    ready: bool
    current_loaded_voice: str | None = None
    device: str = "CPU"
    runtime: str = "onnxruntime"
    sample_rate: int | None = None
    model_size_mb: float | None = None
    description: str | None = None
    is_active: bool = False

class EngineListResponse(BaseModel):
    active_engine: str
    engines: list[EngineInfoResponse]

class GenericVoiceResponse(BaseModel):
    voice_id: str
    engine: str = "piper"
    language_code: str
    language_name: str
    speaker_name: str
    quality: str
    sample_rate: int
    num_speakers: int
    model_size_mb: float
    is_valid: bool

class VoiceListResponse(BaseModel):
    engine: str
    total_count: int
    voices: list[GenericVoiceResponse]

class HealthResponse(BaseModel):
    status: str
    active_engine: str
    piper_runtime: str
    kokoro_runtime: str
    cpu_execution: bool
    installed_voices_count: int
    piper_installed_voices: int
    kokoro_installed_voices: int
    current_loaded_voice: str | None
    version: str

class SettingsResponse(BaseModel):
    app_name: str
    version: str
    host: str
    port: int
    default_engine: str
    default_voice_id: str
    default_kokoro_voice_id: str
    default_speed: float
    max_cache_size_bytes: int
    max_cache_size_mb: float
    max_text_length: int
    session_token: str

class ComparisonEngineResult(BaseModel):
    engine: str
    voice_id: str | None = None
    audio_id: str | None = None
    audio_url: str | None = None
    synthesis_time_seconds: float | None = None
    audio_duration_seconds: float | None = None
    real_time_factor: float | None = None
    peak_memory_mb: float | None = None
    memory_delta_mb: float | None = None
    cache_hit: bool = False
    status: str = "success"
    error: str | None = None

class ComparisonResponse(BaseModel):
    session_id: str
    text: str
    word_count: int
    character_count: int
    speed: float
    timestamp: float
    piper: ComparisonEngineResult
    kokoro: ComparisonEngineResult

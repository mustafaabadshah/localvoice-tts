from pydantic import BaseModel, Field

class SynthesisRequest(BaseModel):
    text: str = Field(..., description="Text paragraph or sentence to synthesize")
    engine: str | None = Field(default=None, description="TTS engine ('piper' or 'kokoro')")
    voice_id: str | None = Field(default=None, description="Installed Voice ID")
    speed: float = Field(default=1.0, ge=0.5, le=2.5, description="Playback speed multiplier")
    speaker_id: int = Field(default=0, ge=0, description="Speaker index for multi-speaker models")

class VoiceTestRequest(BaseModel):
    voice_id: str = Field(..., description="Target voice ID to test")
    engine: str | None = Field(default=None, description="Target engine ('piper' or 'kokoro')")
    sample_text: str | None = Field(
        default="This is a test of the LocalVoice speech generation system.",
        description="Short text sample to speak"
    )

class EngineSelectRequest(BaseModel):
    engine: str = Field(..., description="Engine ID to set as active ('piper' or 'kokoro')")

class ComparisonRequest(BaseModel):
    text: str = Field(..., description="Original text paragraph to compare side-by-side")
    piper_voice_id: str | None = Field(default=None, description="Piper voice to use")
    kokoro_voice_id: str | None = Field(default=None, description="Kokoro voice to use")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speed multiplier")

class SettingsUpdateRequest(BaseModel):
    max_cache_size_bytes: int | None = Field(default=None, description="Max cache size in bytes")
    default_engine: str | None = Field(default=None, description="Default engine ('piper' or 'kokoro')")
    default_voice_id: str | None = Field(default=None, description="Default voice ID")
    default_speed: float | None = Field(default=None, ge=0.5, le=2.5, description="Default speed")

from pydantic import BaseModel, Field

class SynthesisRequest(BaseModel):
    text: str = Field(..., description="Text paragraph or sentence to synthesize")
    voice_id: str | None = Field(default=None, description="Installed Piper Voice ID")
    speed: float = Field(default=1.0, ge=0.5, le=2.5, description="Playback speed multiplier")
    speaker_id: int = Field(default=0, ge=0, description="Speaker index for multi-speaker models")

class VoiceTestRequest(BaseModel):
    voice_id: str = Field(..., description="Target voice ID to test")
    sample_text: str | None = Field(
        default="This is a test of the LocalVoice speech generation system.",
        description="Short text sample to speak"
    )

class SettingsUpdateRequest(BaseModel):
    max_cache_size_bytes: int | None = Field(default=None, description="Max cache size in bytes")
    default_voice_id: str | None = Field(default=None, description="Default voice ID")
    default_speed: float | None = Field(default=None, ge=0.5, le=2.5, description="Default speed")

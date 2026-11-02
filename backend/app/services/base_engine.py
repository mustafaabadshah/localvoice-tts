from abc import ABC, abstractmethod
from typing import Any

class BaseTTSEngine(ABC):
    engine_id: str
    engine_name: str

    @abstractmethod
    def initialize(self) -> bool:
        """Pre-warms or verifies the engine and its default models."""
        pass

    @abstractmethod
    def is_installed(self) -> bool:
        """Returns True if engine runtime and model files are installed."""
        pass

    @abstractmethod
    def list_voices(self) -> list[dict]:
        """Lists all installed and available voices for this engine."""
        pass

    @abstractmethod
    def validate_voice(self, voice_id: str) -> bool:
        """Validates that a voice_id is available and supported."""
        pass

    @abstractmethod
    def synthesize(
        self,
        text: str,
        voice_id: str | None = None,
        speed: float = 1.0,
        speaker_id: int = 0
    ) -> tuple[bytes, bool, float]:
        """
        Synthesizes text into raw WAV bytes.
        Returns: (wav_bytes, was_cached, latency_seconds)
        """
        pass

    @abstractmethod
    def unload(self) -> None:
        """Releases all model weights, sessions, and memory held by this engine."""
        pass

    @abstractmethod
    def health_check(self) -> dict:
        """Returns engine-specific health metrics."""
        pass

    @abstractmethod
    def get_engine_info(self) -> dict:
        """Returns engine identification, model information, and installation status."""
        pass

import gc
import io
import time
import threading
from pathlib import Path
from fastapi import HTTPException, status
import soundfile as sf
import numpy as np

from app.config import settings
from app.services.base_engine import BaseTTSEngine
from app.services.audio_cache import audio_cache
from app.services.text_validator import validate_and_normalize_text
from app.utils.logging import logger

# Voice attribute mappings based on Kokoro-82M v1.0 naming conventions
KOKORO_LANG_MAP = {
    "af": ("en_US", "English (US)", "Female", "en-us"),
    "am": ("en_US", "English (US)", "Male", "en-us"),
    "bf": ("en_GB", "English (UK)", "Female", "en-gb"),
    "bm": ("en_GB", "English (UK)", "Male", "en-gb"),
    "ef": ("es_ES", "Spanish", "Female", "es"),
    "em": ("es_ES", "Spanish", "Male", "es"),
    "ff": ("fr_FR", "French", "Female", "fr"),
    "hf": ("hi_IN", "Hindi", "Female", "hi"),
    "hm": ("hi_IN", "Hindi", "Male", "hi"),
    "if": ("it_IT", "Italian", "Female", "it"),
    "im": ("it_IT", "Italian", "Male", "it"),
    "jf": ("ja_JP", "Japanese", "Female", "ja"),
    "jm": ("ja_JP", "Japanese", "Male", "ja"),
    "pf": ("pt_BR", "Portuguese", "Female", "pt-br"),
    "pm": ("pt_BR", "Portuguese", "Male", "pt-br"),
    "zf": ("zh_CN", "Chinese", "Female", "zh"),
    "zm": ("zh_CN", "Chinese", "Male", "zh"),
}

class KokoroEngine(BaseTTSEngine):
    engine_id: str = "kokoro"
    engine_name: str = "Kokoro TTS (82M)"

    def __init__(self):
        self._lock = threading.Lock()
        self.current_voice_id: str | None = None
        self._kokoro = None
        
        # Operational Metrics
        self.total_requests: int = 0
        self.successful_requests: int = 0
        self.failed_requests: int = 0
        self.total_latency_seconds: float = 0.0

    @property
    def model_path(self) -> Path:
        return settings.voices_dir / "kokoro" / settings.kokoro_model_name

    @property
    def voices_path(self) -> Path:
        return settings.voices_dir / "kokoro" / settings.kokoro_voices_file

    def is_installed(self) -> bool:
        """Verifies kokoro-onnx package and required model + voice files exist."""
        try:
            import kokoro_onnx
            return (
                self.model_path.exists()
                and self.model_path.stat().st_size > 10_000_000
                and self.voices_path.exists()
                and self.voices_path.stat().st_size > 1_000_000
            )
        except Exception:
            return False

    def list_voices(self) -> list[dict]:
        """Dynamically inspects and lists all voices available in the voices file."""
        if not self.is_installed():
            return []

        try:
            # We can inspect the voice styles from voices.bin
            # If not yet loaded, create lightweight instance to read keys
            from kokoro_onnx import Kokoro
            temp_voices: list[str] = []
            if self._kokoro is not None:
                temp_voices = self._kokoro.get_voices()
            else:
                # Read from Kokoro instance or cached list
                k = Kokoro(str(self.model_path), str(self.voices_path))
                temp_voices = k.get_voices()

            voices_meta = []
            for v_id in sorted(temp_voices):
                prefix = v_id[:2]
                lang_info = KOKORO_LANG_MAP.get(prefix, ("en_US", "English (US)", "Speaker", "en-us"))
                
                # Format speaker name nicely: af_heart -> Heart
                name_part = v_id[3:].capitalize() if len(v_id) > 3 else v_id
                speaker_display = f"{name_part} ({lang_info[2]})"

                voices_meta.append({
                    "voice_id": v_id,
                    "engine": "kokoro",
                    "language_code": lang_info[0],
                    "language_name": lang_info[1],
                    "speaker_name": speaker_display,
                    "quality": "82M-ONNX",
                    "sample_rate": 24000,
                    "num_speakers": 1,
                    "model_size_mb": round(self.model_path.stat().st_size / (1024 * 1024), 1),
                    "is_valid": True
                })
            return voices_meta
        except Exception as e:
            logger.error(f"Failed to list Kokoro voices: {e}")
            return []

    def get_engine_info(self) -> dict:
        return {
            "id": self.engine_id,
            "name": self.engine_name,
            "installed": self.is_installed(),
            "ready": self._kokoro is not None,
            "current_loaded_voice": self.current_voice_id,
            "device": "CPU",
            "runtime": "onnxruntime",
            "sample_rate": 24000,
            "model_size_mb": round(self.model_path.stat().st_size / (1024 * 1024), 1) if self.model_path.exists() else 0,
            "description": "High-fidelity 82M parameter neural TTS with expressive prosody."
        }

    def _get_kokoro(self):
        """Lazy-loads Kokoro ONNX model and voices into memory under lock."""
        if self._kokoro is not None:
            return self._kokoro

        if not self.is_installed():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Kokoro TTS is not installed or model files are missing. Run scripts/install_kokoro.ps1."
            )

        logger.info(f"Loading Kokoro ONNX model into CPU memory: {self.model_path.name}")
        t0 = time.time()
        from kokoro_onnx import Kokoro
        self._kokoro = Kokoro(str(self.model_path), str(self.voices_path))
        logger.info(f"Kokoro model loaded in {time.time() - t0:.2f}s")
        return self._kokoro

    def initialize(self) -> bool:
        """Initializes and pre-warms Kokoro runtime."""
        if not self.is_installed():
            logger.warning("Cannot initialize Kokoro: model files not found.")
            return False

        with self._lock:
            try:
                self._get_kokoro()
                self.current_voice_id = settings.default_kokoro_voice_id
                logger.info(f"KokoroEngine initialized successfully with default voice: {self.current_voice_id}")
                return True
            except Exception as e:
                logger.error(f"Failed to initialize KokoroEngine: {e}")
                self.unload()
                return False

    def unload(self) -> None:
        """Releases all model references and runs explicit garbage collection to free RAM."""
        with self._lock:
            if self._kokoro is not None:
                logger.info("Unloading Kokoro TTS engine from RAM")
                self._kokoro = None
                self.current_voice_id = None
                gc.collect()

    def validate_voice(self, voice_id: str) -> bool:
        voices = self.list_voices()
        return any(v["voice_id"] == voice_id for v in voices)

    def synthesize(
        self,
        text: str,
        voice_id: str | None = None,
        speed: float = 1.0,
        speaker_id: int = 0
    ) -> tuple[bytes, bool, float]:
        """
        Synthesizes text into 24000 Hz 16-bit PCM WAV audio bytes.
        Returns: (wav_bytes, was_cached, latency_seconds)
        """
        clean_text = validate_and_normalize_text(text)
        effective_speed = max(0.5, min(2.0, speed))
        target_voice_id = voice_id or self.current_voice_id or settings.default_kokoro_voice_id

        # 1. Check disk cache first
        cache_key = audio_cache.compute_key(
            text=clean_text,
            voice_id=target_voice_id,
            speed=effective_speed,
            model_fingerprint="kokoro-v1.0",
            engine="kokoro"
        )
        cached_wav = audio_cache.get(cache_key)
        if cached_wav:
            self.total_requests += 1
            self.successful_requests += 1
            return cached_wav, True, 0.001

        # 2. Synthesize using Kokoro ONNX
        start_time = time.time()
        self.total_requests += 1

        prefix = target_voice_id[:2]
        lang_code = KOKORO_LANG_MAP.get(prefix, ("en_US", "English", "Female", "en-us"))[3]

        with self._lock:
            try:
                kokoro_instance = self._get_kokoro()
                self.current_voice_id = target_voice_id

                samples, sample_rate = kokoro_instance.create(
                    clean_text,
                    voice=target_voice_id,
                    speed=effective_speed,
                    lang=lang_code
                )

                # Convert float32 numpy samples to standard 16-bit PCM WAV
                buffer = io.BytesIO()
                sf.write(buffer, samples, sample_rate, format="WAV", subtype="PCM_16")
                wav_bytes = buffer.getvalue()
                latency = time.time() - start_time

                # Update operational metrics
                self.successful_requests += 1
                self.total_latency_seconds += latency

                # Save to disk cache
                audio_cache.put(cache_key, wav_bytes)

                return wav_bytes, False, latency
            except Exception as e:
                self.failed_requests += 1
                logger.error(f"Kokoro synthesis failed: {e}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Kokoro speech synthesis failed: {str(e)}"
                )

    def health_check(self) -> dict:
        installed = self.is_installed()
        return {
            "status": "healthy" if installed else "not_installed",
            "kokoro_runtime": "available" if installed else "missing",
            "cpu_execution": True,
            "installed_voices_count": len(self.list_voices()) if installed else 0,
            "current_loaded_voice": self.current_voice_id,
            "is_loaded": self._kokoro is not None,
            "version": settings.version
        }

kokoro_engine = KokoroEngine()

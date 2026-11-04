import io
import time
import wave
import threading
from pathlib import Path
from fastapi import HTTPException, status
import piper

from app.config import settings
from app.services.base_engine import BaseTTSEngine
from app.services.voice_manager import voice_manager, VoiceMetadata
from app.services.audio_cache import audio_cache
from app.services.cancellation import SynthesisAbandoned, acquire_lock, is_cancelled
from app.services.state_store import state_store
from app.services.text_validator import validate_and_normalize_text
from app.utils.logging import logger

class PiperEngine(BaseTTSEngine):
    engine_id: str = "piper"
    engine_name: str = "Piper TTS"

    def __init__(self):
        self._lock = threading.Lock()
        self.current_voice_id: str | None = None
        self._loaded_voice: piper.PiperVoice | None = None
        self._unload_pending: bool = False
        # How long the current voice took to load. Reported per request so a switch that hid a
        # 8-24 s voice reload inside "Synthesizing..." is visible as load time, not inference.
        self.load_seconds: float = 0.0

        # Operational Metrics
        self.total_requests: int = 0
        self.successful_requests: int = 0
        self.failed_requests: int = 0
        self.total_latency_seconds: float = 0.0

    def is_installed(self) -> bool:
        """Checks if Piper is available and at least one voice model is present."""
        try:
            voices = voice_manager.list_voices()
            return len(voices) > 0
        except Exception:
            return False

    def list_voices(self) -> list[dict]:
        """Returns all installed Piper voices as dictionary metadata."""
        voices = voice_manager.list_voices()
        return [
            {
                "voice_id": v.voice_id,
                "engine": "piper",
                "language_code": v.language_code,
                "language_name": v.language_name,
                "speaker_name": v.speaker_name,
                "quality": v.quality,
                "sample_rate": v.sample_rate,
                "num_speakers": v.num_speakers,
                "model_size_mb": v.model_size_mb,
                "is_valid": v.is_valid
            }
            for v in voices
        ]

    def get_engine_info(self) -> dict:
        return {
            "id": self.engine_id,
            "name": self.engine_name,
            "installed": self.is_installed(),
            "ready": self._loaded_voice is not None,
            "current_loaded_voice": self.current_voice_id,
            "device": "CPU",
            "runtime": "onnxruntime",
            "is_loaded": self._loaded_voice is not None,
            "load_seconds": round(self.load_seconds, 2),
            "description": "Ultra-fast neural text-to-speech with minimal CPU latency."
        }

    def initialize(self) -> bool:
        """Pre-warms or verifies the voice the user actually reads with."""
        voices = voice_manager.list_voices()
        if not voices:
            logger.warning("No valid Piper voices installed in voices directory.")
            return False

        installed = [v.voice_id for v in voices]
        # Warm the voice the user last read with, not the shipped default: a reader who listens
        # to a second Piper voice paid a full model load on every cold start for the wrong one.
        target_id = state_store.last_voice(self.engine_id)
        if target_id not in installed:
            target_id = settings.default_voice_id
        if target_id not in installed:
            target_id = installed[0]

        try:
            self._load_voice(target_id)
            logger.info(f"PiperEngine initialized with voice: {target_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize voice {target_id}: {e}")
            return False

    def _load_voice(self, voice_id: str) -> piper.PiperVoice:
        """Loads a voice model while ensuring only one model is loaded in memory at a time."""
        if self.current_voice_id == voice_id and self._loaded_voice is not None:
            return self._loaded_voice

        voice_meta = voice_manager.get_voice(voice_id)
        if not voice_meta:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Voice '{voice_id}' is not installed or invalid in Piper."
            )

        # Unload previous voice to strictly conserve RAM on 8 GB machine
        if self._loaded_voice is not None:
            logger.info(f"Unloading previous voice model: {self.current_voice_id}")
            self._loaded_voice = None
            self.current_voice_id = None

        logger.info(f"Loading voice model into memory: {voice_id}")
        t0 = time.time()
        loaded = piper.PiperVoice.load(
            model_path=voice_meta.model_path,
            config_path=voice_meta.config_path
        )
        self.load_seconds = time.time() - t0
        logger.info(f"Voice {voice_id} loaded in {self.load_seconds:.2f}s")
        self._loaded_voice = loaded
        self.current_voice_id = voice_id
        return loaded

    def unload(self) -> None:
        """
        Explicitly unloads any loaded voice from memory without ever blocking.

        If a synthesis pass is in flight the voice is released the moment that
        pass finishes, so an engine switch never has to wait on an active request.
        """
        acquired = self._lock.acquire(blocking=False)
        if not acquired:
            self._unload_pending = True
            logger.info("Piper unload deferred until the in-flight synthesis completes")
            return
        try:
            self._unload_pending = False
            self._release_voice()
        finally:
            self._lock.release()

    def _release_voice(self) -> None:
        """Drops the loaded voice. The caller must hold ``self._lock``."""
        if self._loaded_voice is not None:
            logger.info(f"Unloading voice {self.current_voice_id}")
            self._loaded_voice = None
            self.current_voice_id = None

    def validate_voice(self, voice_id: str) -> bool:
        meta = voice_manager.get_voice(voice_id)
        return meta is not None and meta.is_valid

    def synthesize(
        self,
        text: str,
        voice_id: str | None = None,
        speed: float = 1.0,
        speaker_id: int = 0,
        cancel: threading.Event | None = None
    ) -> tuple[bytes, bool, float]:
        """
        Synthesizes text into WAV bytes.
        Returns: (wav_bytes, was_cached, latency_seconds)
        """
        clean_text = validate_and_normalize_text(text)

        # Clamp speed between 0.5x and 2.5x
        effective_speed = max(0.5, min(2.5, speed))

        # Determine target voice
        target_voice_id = voice_id or self.current_voice_id or settings.default_voice_id
        meta = voice_manager.get_voice(target_voice_id)
        if not meta:
            voices = voice_manager.list_voices()
            if not voices:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="No Piper voices are installed on the local system."
                )
            target_voice_id = voices[0].voice_id
            meta = voices[0]

        # 1. Check disk cache first
        cache_key = audio_cache.compute_key(
            text=clean_text,
            voice_id=target_voice_id,
            speed=effective_speed,
            model_fingerprint=meta.model_fingerprint,
            engine="piper"
        )
        cached_wav = audio_cache.get(cache_key)
        if cached_wav:
            return self._cached_result(cached_wav, target_voice_id)

        # 2. One inference per distinct audio. A duplicate request (a second panel, a reopened
        #    popup) waits for the first instead of queueing another pass behind the engine lock.
        with audio_cache.single_flight(cache_key, settings.lock_wait_seconds) as owner:
            if not owner:
                cached_wav = audio_cache.get(cache_key)
                if cached_wav:
                    return self._cached_result(cached_wav, target_voice_id)

            return self._synthesize_uncached(
                clean_text, target_voice_id, effective_speed, speaker_id, cache_key, cancel
            )

    def _cached_result(self, wav_bytes: bytes, voice_id: str) -> tuple[bytes, bool, float]:
        self.total_requests += 1
        self.successful_requests += 1
        state_store.set_last_voice(self.engine_id, voice_id)
        return wav_bytes, True, 0.001

    def _synthesize_uncached(
        self,
        text: str,
        voice_id: str,
        speed: float,
        speaker_id: int,
        cache_key: str,
        cancel: threading.Event | None
    ) -> tuple[bytes, bool, float]:
        """Runs the inference. Holds the engine lock for exactly this pass and nothing else."""
        start_time = time.time()
        self.total_requests += 1

        # 3. A request nobody is waiting for must not start: it would hold the lock for a full
        #    paragraph at ~0.2x real time and the next one would queue behind it.
        if not acquire_lock(self._lock, cancel, settings.lock_wait_seconds):
            self.failed_requests += 1
            raise SynthesisAbandoned("Piper request abandoned before it could start")

        try:
            if is_cancelled(cancel):
                raise SynthesisAbandoned("Piper request abandoned before inference")

            voice = self._load_voice(voice_id)

            # In Piper, length_scale is inversely proportional to speed:
            length_scale = 1.0 / speed
            syn_config = piper.SynthesisConfig(
                speaker_id=speaker_id,
                length_scale=length_scale
            )

            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav_out:
                voice.synthesize_wav(text, wav_out, syn_config=syn_config)

            wav_bytes = buffer.getvalue()
            latency = time.time() - start_time

            # Update metrics
            self.successful_requests += 1
            self.total_latency_seconds += latency
            state_store.set_last_voice(self.engine_id, voice_id)

            # Save to bounded cache
            audio_cache.put(cache_key, wav_bytes)

            return wav_bytes, False, latency
        except SynthesisAbandoned:
            self.failed_requests += 1
            logger.info("Piper synthesis abandoned: the client stopped waiting for it")
            raise
        except Exception as e:
            self.failed_requests += 1
            logger.error(f"Synthesis failed for text '{text[:40]}...': {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Speech synthesis failed: {str(e)}"
            )
        finally:
            # Honour an unload() that was requested while this pass was running
            if self._unload_pending:
                self._unload_pending = False
                self._release_voice()
            self._lock.release()

    def health_check(self) -> dict:
        installed_voices = voice_manager.list_voices()
        return {
            "status": "healthy" if installed_voices else "degraded",
            "piper_runtime": "available",
            "cpu_execution": True,
            "installed_voices_count": len(installed_voices),
            "current_loaded_voice": self.current_voice_id,
            "is_loaded": self._loaded_voice is not None,
            "version": settings.version
        }

    def get_metrics(self) -> dict:
        avg_latency = (
            (self.total_latency_seconds / self.successful_requests)
            if self.successful_requests > 0 else 0.0
        )
        return {
            "engine": self.engine_id,
            "is_loaded": self._loaded_voice is not None,
            "load_seconds": round(self.load_seconds, 2),
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "average_latency_seconds": round(avg_latency, 3),
            "current_voice": self.current_voice_id,
            "cache_stats": audio_cache.get_stats(),
        }

piper_engine = PiperEngine()

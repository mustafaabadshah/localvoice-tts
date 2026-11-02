import io
import time
import wave
import threading
from pathlib import Path
from fastapi import HTTPException, status
import piper

from app.config import settings
from app.services.voice_manager import voice_manager, VoiceMetadata
from app.services.audio_cache import audio_cache
from app.services.text_validator import validate_and_normalize_text
from app.utils.logging import logger

class PiperEngine:
    def __init__(self):
        self._lock = threading.Lock()
        self.current_voice_id: str | None = None
        self._loaded_voice: piper.PiperVoice | None = None
        
        # Operational Metrics
        self.total_requests: int = 0
        self.successful_requests: int = 0
        self.failed_requests: int = 0
        self.total_latency_seconds: float = 0.0

    def initialize(self) -> bool:
        """Pre-warms or verifies the default voice if available."""
        voices = voice_manager.list_voices()
        if not voices:
            logger.warning("No valid Piper voices installed in voices directory.")
            return False
            
        target_id = settings.default_voice_id
        if target_id not in [v.voice_id for v in voices]:
            target_id = voices[0].voice_id
            
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
                detail=f"Voice '{voice_id}' is not installed or invalid."
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
        logger.info(f"Voice {voice_id} loaded in {time.time() - t0:.2f}s")
        self._loaded_voice = loaded
        self.current_voice_id = voice_id
        return loaded

    def unload(self) -> None:
        """Explicitly unloads any loaded voice from memory."""
        with self._lock:
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
        speaker_id: int = 0
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
            model_fingerprint=meta.model_fingerprint
        )
        cached_wav = audio_cache.get(cache_key)
        if cached_wav:
            self.total_requests += 1
            self.successful_requests += 1
            return cached_wav, True, 0.001

        # 2. Perform synthesis under thread lock (single model execution)
        start_time = time.time()
        self.total_requests += 1
        with self._lock:
            try:
                voice = self._load_voice(target_voice_id)
                
                # In Piper, length_scale is inversely proportional to speed:
                # speed = 1.5 -> length_scale = 1.0 / 1.5 ~ 0.667
                length_scale = 1.0 / effective_speed
                syn_config = piper.SynthesisConfig(
                    speaker_id=speaker_id,
                    length_scale=length_scale
                )

                buffer = io.BytesIO()
                with wave.open(buffer, "wb") as wav_out:
                    voice.synthesize_wav(clean_text, wav_out, syn_config=syn_config)

                wav_bytes = buffer.getvalue()
                latency = time.time() - start_time
                
                # Update metrics
                self.successful_requests += 1
                self.total_latency_seconds += latency
                
                # Save to bounded cache
                audio_cache.put(cache_key, wav_bytes)
                
                return wav_bytes, False, latency
            except Exception as e:
                self.failed_requests += 1
                logger.error(f"Synthesis failed for text '{clean_text[:40]}...': {e}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Speech synthesis failed: {str(e)}"
                )

    def health_check(self) -> dict:
        installed_voices = voice_manager.list_voices()
        return {
            "status": "healthy" if installed_voices else "degraded",
            "piper_runtime": "available",
            "cpu_execution": True,
            "installed_voices_count": len(installed_voices),
            "current_loaded_voice": self.current_voice_id,
            "version": settings.version
        }

    def get_metrics(self) -> dict:
        avg_latency = (
            (self.total_latency_seconds / self.successful_requests)
            if self.successful_requests > 0 else 0.0
        )
        return {
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "average_latency_seconds": round(avg_latency, 3),
            "current_voice": self.current_voice_id,
            "cache_stats": audio_cache.get_stats(),
        }

piper_engine = PiperEngine()

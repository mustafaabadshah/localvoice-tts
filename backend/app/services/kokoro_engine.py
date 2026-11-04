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
from app.services.cancellation import SynthesisAbandoned, acquire_lock, is_cancelled
from app.services.state_store import state_store
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
        self._voice_ids_cache: list[str] | None = None
        self._unload_pending: bool = False
        # How long the current ONNX session took to build. Kokoro pays 5-11 s per load on this
        # class of hardware, so a reload must never be mistaken for inference time.
        self.load_seconds: float = 0.0
        
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

    def _voice_ids(self) -> list[str]:
        """
        Returns the installed Kokoro voice ids without instantiating the 82M model.

        Building a ``Kokoro`` object creates a full ONNX inference session (~3-6 s of
        CPU on this class of hardware), so it must never happen on read-only paths
        such as ``/api/v1/health`` or ``/api/v1/voices``. The voice styles live in an
        ``.npz`` archive, so the member names can be read directly and cached.
        """
        if self._kokoro is not None:
            return list(self._kokoro.get_voices())

        if self._voice_ids_cache is not None:
            return self._voice_ids_cache

        try:
            import numpy as np

            with np.load(str(self.voices_path)) as voice_pack:
                self._voice_ids_cache = sorted(voice_pack.files)
            logger.info(f"Read {len(self._voice_ids_cache)} Kokoro voice ids from {self.voices_path.name}")
            return self._voice_ids_cache
        except Exception as e:
            logger.error(f"Failed to read Kokoro voice pack {self.voices_path}: {e}")
            return []

    def list_voices(self) -> list[dict]:
        """Dynamically inspects and lists all voices available in the voices file."""
        if not self.is_installed():
            return []

        try:
            voice_ids = self._voice_ids()
            if not voice_ids:
                return []

            voices_meta = []
            for v_id in voice_ids:
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
            "is_loaded": self._kokoro is not None,
            "load_seconds": round(self.load_seconds, 2),
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

        logger.info(f"Loading Kokoro ONNX model with tuned CPU session options: {self.model_path.name}")
        t0 = time.time()
        import os
        import onnxruntime as rt
        from kokoro_onnx import Kokoro

        opts = rt.SessionOptions()
        opts.graph_optimization_level = rt.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.intra_op_num_threads = min(4, os.cpu_count() or 4)
        opts.execution_mode = rt.ExecutionMode.ORT_SEQUENTIAL

        sess = rt.InferenceSession(str(self.model_path), sess_options=opts, providers=["CPUExecutionProvider"])
        self._kokoro = Kokoro.from_session(sess, str(self.voices_path))
        self.load_seconds = time.time() - t0
        logger.info(f"Kokoro model loaded in {self.load_seconds:.2f}s")
        return self._kokoro

    def initialize(self) -> bool:
        """Initializes and pre-warms Kokoro runtime."""
        if not self.is_installed():
            logger.warning("Cannot initialize Kokoro: model files not found.")
            return False

        with self._lock:
            try:
                self._get_kokoro()
                # Kokoro's voices are style tables inside the already-loaded model, so warming
                # the voice the user last read with costs nothing and starts the first
                # paragraph in the right voice.
                voice_id = state_store.last_voice(self.engine_id)
                if not voice_id or voice_id not in self._voice_ids():
                    voice_id = settings.default_kokoro_voice_id
                self.current_voice_id = voice_id
                logger.info(f"KokoroEngine initialized successfully with default voice: {self.current_voice_id}")
                return True
            except Exception as e:
                logger.error(f"Failed to initialize KokoroEngine: {e}")
                # Already holding self._lock, so release directly instead of unload()
                self._release_model()
                return False

    def unload(self) -> None:
        """
        Releases all model references and runs explicit garbage collection to free RAM.

        This call never blocks. If a synthesis pass is currently in flight, the model is
        released as soon as that pass finishes instead of stalling the caller (engine
        switching, comparison benchmarks, and diagnostics all call this on the hot path).
        """
        acquired = self._lock.acquire(blocking=False)
        if not acquired:
            self._unload_pending = True
            logger.info("Kokoro unload deferred until the in-flight synthesis completes")
            return
        try:
            self._unload_pending = False
            self._release_model()
        finally:
            self._lock.release()

    def _release_model(self) -> None:
        """Drops the ONNX session and frees RAM. The caller must hold ``self._lock``."""
        if self._kokoro is not None:
            logger.info("Unloading Kokoro TTS engine from RAM")
            self._kokoro = None
            self.current_voice_id = None
            gc.collect()

    def validate_voice(self, voice_id: str) -> bool:
        return voice_id in self._voice_ids()

    def synthesize(
        self,
        text: str,
        voice_id: str | None = None,
        speed: float = 1.0,
        speaker_id: int = 0,
        cancel: threading.Event | None = None
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
            return self._cached_result(cached_wav, target_voice_id)

        # 2. One inference per distinct audio. A duplicate request (a second panel, a reopened
        #    popup) waits for the first: at ~8.7x real time a second Kokoro pass is not a
        #    free retry, it is half a minute of blocked engine.
        with audio_cache.single_flight(cache_key, settings.lock_wait_seconds) as owner:
            if not owner:
                cached_wav = audio_cache.get(cache_key)
                if cached_wav:
                    return self._cached_result(cached_wav, target_voice_id)

            return self._synthesize_uncached(clean_text, target_voice_id, effective_speed, cache_key, cancel)

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
        cache_key: str,
        cancel: threading.Event | None
    ) -> tuple[bytes, bool, float]:
        """Runs the ONNX inference. Holds the engine lock for exactly this pass."""
        start_time = time.time()
        self.total_requests += 1

        # A language or voice change aborts the fetch on the client. An inference that has not
        # started must not start, or the paragraph the user actually wants queues behind the one
        # they gave up on - tens of seconds at Kokoro's pace.
        if not acquire_lock(self._lock, cancel, settings.lock_wait_seconds):
            self.failed_requests += 1
            raise SynthesisAbandoned("Kokoro request abandoned before it could start")

        try:
            if is_cancelled(cancel):
                raise SynthesisAbandoned("Kokoro request abandoned before inference")

            kokoro_instance = self._get_kokoro()
            valid_voices = kokoro_instance.get_voices()

            target_voice_id = voice_id
            # Fallback safely if voice_id is missing, invalid, or from another engine
            if not target_voice_id or target_voice_id not in valid_voices:
                target_voice_id = settings.default_kokoro_voice_id
                if target_voice_id not in valid_voices and valid_voices:
                    target_voice_id = valid_voices[0]

            self.current_voice_id = target_voice_id
            prefix = target_voice_id[:2]
            lang_code = KOKORO_LANG_MAP.get(prefix, ("en_US", "English", "Female", "en-us"))[3]

            samples, sample_rate = kokoro_instance.create(
                text,
                voice=target_voice_id,
                speed=speed,
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
            state_store.set_last_voice(self.engine_id, target_voice_id)

            # Save to disk cache
            audio_cache.put(cache_key, wav_bytes)

            return wav_bytes, False, latency
        except SynthesisAbandoned:
            self.failed_requests += 1
            logger.info("Kokoro synthesis abandoned: the client stopped waiting for it")
            raise
        except Exception as e:
            self.failed_requests += 1
            logger.error(f"Kokoro synthesis failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Kokoro speech synthesis failed: {str(e)}"
            )
        finally:
            # Honour an unload() that was requested while this pass was running
            if self._unload_pending:
                self._unload_pending = False
                self._release_model()
            self._lock.release()

    def get_metrics(self) -> dict:
        avg_latency = (
            (self.total_latency_seconds / self.successful_requests)
            if self.successful_requests > 0 else 0.0
        )
        return {
            "engine": self.engine_id,
            "is_loaded": self._kokoro is not None,
            "load_seconds": round(self.load_seconds, 2),
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "average_latency_seconds": round(avg_latency, 3),
            "current_voice": self.current_voice_id,
            "cache_stats": audio_cache.get_stats(),
        }

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

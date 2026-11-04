import gc
import io
import time
import wave
import uuid
import threading
import psutil
from pathlib import Path
from fastapi import HTTPException, status

from app.config import settings
from app.services.base_engine import BaseTTSEngine
from app.services.audio_cache import audio_cache
from app.services.piper_engine import piper_engine
from app.services.kokoro_engine import kokoro_engine
from app.services.state_store import state_store
from app.services.text_validator import validate_and_normalize_text
from app.utils.logging import logger

class EngineManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._engines: dict[str, BaseTTSEngine] = {
            "piper": piper_engine,
            "kokoro": kokoro_engine,
        }
        # Whom the user is actually reading with, not whom the default says. Persisted because
        # the controller idle-stops this process: without it every cold start warmed Piper for a
        # Kokoro reader and paid 8-43 s of voice loading before the first paragraph.
        self.active_engine_id: str = self.warm_engine_id()

    def get_active_engine(self) -> BaseTTSEngine:
        return self._engines.get(self.active_engine_id, piper_engine)

    def warm_engine_id(self) -> str:
        """The engine to load at start-up: the last one used, else the explicitly selected one."""
        for key in ("last_used_engine", "active_engine"):
            candidate = state_store.get(key)
            if candidate in self._engines:
                return candidate
        return settings.default_engine

    def resident_engines(self) -> dict:
        """Which engines currently hold model weights in RAM."""
        return {
            eng_id: bool(eng.get_engine_info().get("is_loaded"))
            for eng_id, eng in self._engines.items()
        }

    def _persist_active(self, engine_id: str) -> None:
        state_store.update(active_engine=engine_id)

    def get_metrics(self) -> dict:
        """
        Per-engine counters plus which models are resident right now.

        Both engines are reported because under the warm residency policy two models can be in
        RAM at once, so a single engine's counters no longer describe the process.

        The process-wide totals at the top level are kept for the extension's diagnostics panel,
        which has always read ``total_requests`` / ``average_latency_seconds`` / ``cache_stats``
        there. They now add both engines up instead of reporting Piper alone, because a toggle to
        Kokoro used to leave the panel showing zeros.
        """
        engines = {eng_id: eng.get_metrics() for eng_id, eng in self._engines.items()}

        successful = sum(m["successful_requests"] for m in engines.values())
        latency = sum(m["average_latency_seconds"] * m["successful_requests"] for m in engines.values())
        active = self.get_active_engine()

        return {
            "total_requests": sum(m["total_requests"] for m in engines.values()),
            "successful_requests": successful,
            "failed_requests": sum(m["failed_requests"] for m in engines.values()),
            "average_latency_seconds": round(latency / successful, 3) if successful else 0.0,
            "current_voice": active.get_engine_info().get("current_loaded_voice"),
            "cache_stats": audio_cache.get_stats(),
            "active_engine": self.active_engine_id,
            "resident_engines": self.resident_engines(),
            "engines": engines,
        }

    def _release_idle_engines(self, keep: str) -> None:
        """Drops engines other than ``keep`` only when the warm policy or RAM requires it."""
        for eng_id, eng in self._engines.items():
            if eng_id == keep:
                continue
            if not settings.keep_engines_warm:
                logger.info(f"Releasing idle engine: {eng_id}")
                eng.unload()
                gc.collect()
                continue
            rss_mb = psutil.Process().memory_info().rss / (1024 * 1024)
            if rss_mb > settings.max_resident_rss_mb:
                logger.info(
                    f"Releasing idle engine {eng_id}: RSS {rss_mb:.0f} MB is above the "
                    f"{settings.max_resident_rss_mb} MB warm-model cap"
                )
                eng.unload()
                gc.collect()

    def warm_startup_engine(self) -> None:
        """
        Loads the engine this machine actually uses, and nothing else.

        The previous lifespan pre-warmed the *default* engine unconditionally, so a Kokoro user
        paid Piper's voice load on every start and then paid Kokoro's session load on the first
        paragraph regardless. See docs/v2_9_engine_warmth.md.
        """
        warm_id = self.warm_engine_id()
        if warm_id != self.active_engine_id:
            self.active_engine_id = warm_id

        if not settings.warm_on_start:
            logger.info("Engine warm-up disabled (LOCALVOICE_WARM_START=0)")
            return

        eng = self._engines.get(warm_id)
        if eng is None:
            return

        started = time.time()
        try:
            if eng.initialize():
                logger.info(f"Warm start ready: {warm_id} in {time.time() - started:.2f}s")
            else:
                logger.warning(f"Warm start could not initialise {warm_id}; it will load on first use")
        except Exception as e:
            logger.warning(f"Warm start skipped for {warm_id}: {e}")

    def get_engine(self, engine_id: str | None = None) -> BaseTTSEngine:
        target_id = engine_id or self.active_engine_id
        if target_id not in self._engines:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown TTS engine '{target_id}'. Supported engines: piper, kokoro"
            )
        return self._engines[target_id]

    def list_engines(self) -> list[dict]:
        results = []
        for eng_id, eng in self._engines.items():
            info = eng.get_engine_info()
            info["is_active"] = (eng_id == self.active_engine_id)
            results.append(info)
        return results

    def select_engine(self, engine_id: str) -> dict:
        """
        Switches the active engine and persists the choice.

        The switch itself stays cheap: it never waits on a model load, and it no longer unloads
        the engine being left behind unless the residency policy says so. Unloading
        unconditionally is what made every engine switch cost a full reload on the next request.
        The first paragraph on the newly selected engine loads it, exactly as before - but from
        then on, switching back and forth is a pointer flip.
        """
        if engine_id not in self._engines:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid engine '{engine_id}'. Choose 'piper' or 'kokoro'."
            )

        target_engine = self._engines[engine_id]
        if not target_engine.is_installed():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Engine '{engine_id}' is not installed or model files are missing."
            )

        with self._lock:
            if self.active_engine_id == engine_id:
                # Re-selecting the active engine stays free: no reload, no unload.
                self._persist_active(engine_id)
                return target_engine.get_engine_info()

            logger.info(f"Switching active TTS engine: {self.active_engine_id} -> {engine_id}")
            self.active_engine_id = engine_id
            self._persist_active(engine_id)
            self._release_idle_engines(keep=engine_id)
            return target_engine.get_engine_info()

    def list_voices(self, engine_id: str | None = None) -> list[dict]:
        """Lists voices for a specific engine, or the active engine if unspecified."""
        eng = self.get_engine(engine_id)
        return eng.list_voices()

    def synthesize(
        self,
        text: str,
        engine_id: str | None = None,
        voice_id: str | None = None,
        speed: float = 1.0,
        speaker_id: int = 0,
        cancel: threading.Event | None = None
    ) -> tuple[bytes, bool, float]:
        """
        Routes synthesis request to the requested (or active) engine.

        A request naming another engine no longer unloads the active one: the switch is a
        pointer flip plus at most one model load, and the engine just used stays warm for when
        the reader switches back.
        """
        target_id = engine_id or self.active_engine_id
        eng = self.get_engine(target_id)

        if target_id != self.active_engine_id:
            with self._lock:
                logger.info(f"Auto-switching active TTS engine: {self.active_engine_id} -> {target_id}")
                self.active_engine_id = target_id
                self._persist_active(target_id)
                self._release_idle_engines(keep=target_id)

        wav_bytes, was_cached, latency = eng.synthesize(
            text=text,
            voice_id=voice_id,
            speed=speed,
            speaker_id=speaker_id,
            cancel=cancel
        )

        if not was_cached:
            load_seconds = float(eng.get_engine_info().get("load_seconds") or 0.0)
            # Load time is reported separately: a long "synthesis" was usually a model reload
            # hiding inside the total, and the old log line credited all of it to inference.
            logger.info(
                f"Synthesized {len(text)} chars via {target_id} | voice={voice_id} | "
                f"{latency:.3f}s (engine load {load_seconds:.2f}s)"
            )
            state_store.update(last_used_engine=target_id)

        return wav_bytes, was_cached, latency

    def compare_engines(
        self,
        text: str,
        piper_voice_id: str | None = None,
        kokoro_voice_id: str | None = None,
        speed: float = 1.0
    ) -> dict:
        """
        Performs sequential side-by-side benchmark comparison on the exact same text.
        Never runs both models simultaneously to protect CPU and memory.
        """
        clean_text = validate_and_normalize_text(text)
        prev_active_id = self.active_engine_id
        proc = psutil.Process()

        word_count = len(clean_text.split())
        char_count = len(clean_text)
        session_id = uuid.uuid4().hex[:8]

        piper_result: dict = {}
        kokoro_result: dict = {}

        with self._lock:
            try:
                # 1. Unload all engines before starting
                for e in self._engines.values():
                    e.unload()
                gc.collect()

                # --- STEP 1: BENCHMARK PIPER ---
                logger.info("[Compare] Benchmarking Piper sequentially...")
                mem_before_piper = proc.memory_info().rss / (1024 * 1024)
                
                piper_wav, piper_cached, piper_latency = piper_engine.synthesize(
                    text=clean_text,
                    voice_id=piper_voice_id,
                    speed=speed
                )
                mem_peak_piper = proc.memory_info().rss / (1024 * 1024)

                # Compute exact audio duration from WAV header
                with wave.open(io.BytesIO(piper_wav)) as w:
                    piper_duration = w.getnframes() / float(w.getframerate())

                piper_rtf = round(piper_latency / piper_duration, 3) if piper_duration > 0 else 0.0

                # Save comparison audio file
                piper_file_id = f"compare_{session_id}_piper.wav"
                piper_file_path = settings.compare_dir / piper_file_id
                piper_file_path.write_bytes(piper_wav)

                piper_result = {
                    "engine": "piper",
                    "voice_id": piper_voice_id or piper_engine.current_voice_id or settings.default_voice_id,
                    "audio_id": piper_file_id,
                    "audio_url": f"/api/v1/compare/audio/{piper_file_id}",
                    "synthesis_time_seconds": round(piper_latency, 3),
                    "audio_duration_seconds": round(piper_duration, 2),
                    "real_time_factor": piper_rtf,
                    "peak_memory_mb": round(mem_peak_piper, 1),
                    "memory_delta_mb": round(mem_peak_piper - mem_before_piper, 1),
                    "cache_hit": piper_cached,
                    "status": "success"
                }

                # Unload Piper completely before starting Kokoro
                piper_engine.unload()
                gc.collect()

                # --- STEP 2: BENCHMARK KOKORO ---
                if kokoro_engine.is_installed():
                    logger.info("[Compare] Benchmarking Kokoro sequentially...")
                    mem_before_kokoro = proc.memory_info().rss / (1024 * 1024)

                    kokoro_wav, kokoro_cached, kokoro_latency = kokoro_engine.synthesize(
                        text=clean_text,
                        voice_id=kokoro_voice_id,
                        speed=speed
                    )
                    mem_peak_kokoro = proc.memory_info().rss / (1024 * 1024)

                    with wave.open(io.BytesIO(kokoro_wav)) as w:
                        kokoro_duration = w.getnframes() / float(w.getframerate())

                    kokoro_rtf = round(kokoro_latency / kokoro_duration, 3) if kokoro_duration > 0 else 0.0

                    kokoro_file_id = f"compare_{session_id}_kokoro.wav"
                    kokoro_file_path = settings.compare_dir / kokoro_file_id
                    kokoro_file_path.write_bytes(kokoro_wav)

                    kokoro_result = {
                        "engine": "kokoro",
                        "voice_id": kokoro_voice_id or kokoro_engine.current_voice_id or settings.default_kokoro_voice_id,
                        "audio_id": kokoro_file_id,
                        "audio_url": f"/api/v1/compare/audio/{kokoro_file_id}",
                        "synthesis_time_seconds": round(kokoro_latency, 3),
                        "audio_duration_seconds": round(kokoro_duration, 2),
                        "real_time_factor": kokoro_rtf,
                        "peak_memory_mb": round(mem_peak_kokoro, 1),
                        "memory_delta_mb": round(mem_peak_kokoro - mem_before_kokoro, 1),
                        "cache_hit": kokoro_cached,
                        "status": "success"
                    }

                    # Unload Kokoro to release memory
                    kokoro_engine.unload()
                    gc.collect()
                else:
                    kokoro_result = {
                        "engine": "kokoro",
                        "status": "unavailable",
                        "error": "Kokoro TTS is not installed on this system."
                    }

            finally:
                # Restore previous active engine
                self.active_engine_id = prev_active_id
                self.get_active_engine().initialize()

        return {
            "session_id": session_id,
            "text": clean_text,
            "word_count": word_count,
            "character_count": char_count,
            "speed": speed,
            "timestamp": time.time(),
            "piper": piper_result,
            "kokoro": kokoro_result,
        }

engine_manager = EngineManager()

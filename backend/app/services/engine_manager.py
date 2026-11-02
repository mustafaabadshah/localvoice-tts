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
from app.services.piper_engine import piper_engine
from app.services.kokoro_engine import kokoro_engine
from app.services.text_validator import validate_and_normalize_text
from app.utils.logging import logger

class EngineManager:
    def __init__(self):
        self._lock = threading.Lock()
        self.active_engine_id: str = settings.default_engine
        self._engines: dict[str, BaseTTSEngine] = {
            "piper": piper_engine,
            "kokoro": kokoro_engine,
        }

    def get_active_engine(self) -> BaseTTSEngine:
        return self._engines.get(self.active_engine_id, piper_engine)

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
        Switches the active engine with strict resource management.
        Unloads previous engine before initializing the new engine.
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
            if self.active_engine_id != engine_id:
                logger.info(f"Switching active TTS engine: {self.active_engine_id} -> {engine_id}")
                # Unload old engine to free memory
                old_engine = self._engines[self.active_engine_id]
                old_engine.unload()
                gc.collect()

                self.active_engine_id = engine_id

            # Initialize new engine
            target_engine.initialize()
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
        speaker_id: int = 0
    ) -> tuple[bytes, bool, float]:
        """Routes synthesis request to the requested (or active) engine."""
        target_id = engine_id or self.active_engine_id
        eng = self.get_engine(target_id)
        
        # If the requested engine differs from the active one, handle switching safely
        if target_id != self.active_engine_id:
            with self._lock:
                self._engines[self.active_engine_id].unload()
                gc.collect()
                self.active_engine_id = target_id

        return eng.synthesize(text=text, voice_id=voice_id, speed=speed, speaker_id=speaker_id)

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

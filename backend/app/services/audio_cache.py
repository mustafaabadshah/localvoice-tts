import hashlib
import json
import os
import threading
from pathlib import Path
from app.config import settings
from app.utils.logging import logger

class AudioCache:
    def __init__(self, cache_dir: Path | None = None, max_bytes: int | None = None):
        self.cache_dir = cache_dir or settings.cache_dir
        self.max_bytes = max_bytes or settings.max_cache_size_bytes
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        
        self.hits = 0
        self.misses = 0

    def compute_key(self, text: str, voice_id: str, speed: float, model_fingerprint: str = "", engine: str = "piper") -> str:
        payload = f"{engine}|{text}|{voice_id}|{speed:.2f}|{model_fingerprint}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def get_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.wav"

    def get(self, key: str) -> bytes | None:
        file_path = self.get_path(key)
        with self._lock:
            if file_path.exists() and file_path.is_file():
                try:
                    # Update access timestamp for LRU
                    os.utime(file_path, None)
                    data = file_path.read_bytes()
                    self.hits += 1
                    return data
                except Exception as e:
                    logger.warning(f"Error reading cache file {key}: {e}")
            self.misses += 1
            return None

    def put(self, key: str, audio_bytes: bytes) -> None:
        file_path = self.get_path(key)
        with self._lock:
            try:
                file_path.write_bytes(audio_bytes)
                self._enforce_limit()
            except Exception as e:
                logger.error(f"Error saving to cache {key}: {e}")

    def clear(self) -> int:
        """Deletes all cached audio files and returns count removed."""
        with self._lock:
            count = 0
            for item in self.cache_dir.glob("*.wav"):
                try:
                    item.unlink()
                    count += 1
                except Exception as e:
                    logger.warning(f"Could not remove cache file {item}: {e}")
            return count

    def get_stats(self) -> dict:
        with self._lock:
            files = list(self.cache_dir.glob("*.wav"))
            total_size = sum(f.stat().st_size for f in files if f.is_file())
            total_reqs = self.hits + self.misses
            hit_rate = (self.hits / total_reqs * 100) if total_reqs > 0 else 0.0
            return {
                "file_count": len(files),
                "total_bytes": total_size,
                "total_mb": round(total_size / (1024 * 1024), 2),
                "max_bytes": self.max_bytes,
                "max_mb": round(self.max_bytes / (1024 * 1024), 2),
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate_pct": round(hit_rate, 2),
            }

    def _enforce_limit(self) -> None:
        """Evicts oldest files if total cache exceeds max_bytes."""
        files = [f for f in self.cache_dir.glob("*.wav") if f.is_file()]
        total_size = sum(f.stat().st_size for f in files)
        if total_size <= self.max_bytes:
            return

        # Sort files by last modification time (oldest first)
        files.sort(key=lambda f: f.stat().st_mtime)
        for f in files:
            if total_size <= self.max_bytes:
                break
            try:
                size = f.stat().st_size
                f.unlink()
                total_size -= size
                logger.info(f"Evicted cache entry {f.name} to maintain bounds")
            except Exception as e:
                logger.warning(f"Could not delete cache file during eviction: {e}")

audio_cache = AudioCache()

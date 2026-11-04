"""
Two facts that have to outlive the process: which engine is selected, and the voice the user
last spoke with on each engine.

Why a file and not the audio cache: this is not audio. It decides what the backend *warms* at
start-up. Without it every cold start loaded Piper (the default) even for a user who only ever
reads with Kokoro, which cost 8-43 s of voice loading before the first paragraph could play -
and the controller idle-stops the backend after 5 minutes, so that bill came back repeatedly.
See docs/v2_9_engine_warmth.md.

Every operation is best-effort: a corrupt or unwritable state file must degrade to the defaults,
never to a failed request.
"""

import json
import os
import threading
from pathlib import Path

from app.config import settings
from app.utils.logging import logger


class StateStore:
    def __init__(self, path: Path | None = None):
        self.path = Path(path or settings.state_file)
        self._lock = threading.Lock()
        self._data: dict = self._read()

    def _read(self) -> dict:
        try:
            if self.path.exists():
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    return raw
                logger.warning(f"Ignoring state file {self.path}: expected a JSON object")
        except Exception as e:
            logger.warning(f"Ignoring unreadable state file {self.path}: {e}")
        return {}

    def _write(self) -> None:
        """Atomic replace, so a killed process cannot leave a half-written state file."""
        tmp = self.path.with_name(self.path.name + ".tmp")
        try:
            tmp.write_text(json.dumps(self._data, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.path)
        except Exception as e:
            logger.warning(f"Could not persist state to {self.path}: {e}")
            try:
                tmp.unlink()
            except Exception:
                pass

    def get(self, key: str, default=None):
        with self._lock:
            return self._data.get(key, default)

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._data)

    def update(self, **values) -> None:
        """Merges ``values`` in and writes the file only when something actually changed."""
        with self._lock:
            changed = {k: v for k, v in values.items() if self._data.get(k) != v}
            if not changed:
                return
            self._data.update(changed)
            self._write()

    def last_voice(self, engine_id: str) -> str | None:
        with self._lock:
            voices = self._data.get("last_voice")
            if isinstance(voices, dict):
                voice_id = voices.get(engine_id)
                if isinstance(voice_id, str) and voice_id:
                    return voice_id
            return None

    def set_last_voice(self, engine_id: str, voice_id: str | None) -> None:
        if not voice_id:
            return
        with self._lock:
            voices = self._data.get("last_voice")
            if not isinstance(voices, dict):
                voices = {}
            if voices.get(engine_id) == voice_id:
                return
            voices[engine_id] = voice_id
            self._data["last_voice"] = voices
            self._write()


state_store = StateStore()

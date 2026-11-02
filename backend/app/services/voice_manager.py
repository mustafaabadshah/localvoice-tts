import json
from pathlib import Path
from pydantic import BaseModel
from app.config import settings
from app.utils.logging import logger
from app.utils.security import validate_safe_filename

class VoiceMetadata(BaseModel):
    voice_id: str
    language_code: str
    language_name: str
    speaker_name: str
    quality: str
    sample_rate: int
    num_speakers: int
    model_size_mb: float
    model_path: str
    config_path: str
    is_valid: bool = True
    model_fingerprint: str = ""

# Map common language codes to friendly names if not in config
LANGUAGE_NAME_MAP = {
    "en": "English", "en_US": "English (US)", "en_GB": "English (UK)",
    "de": "German", "de_DE": "German",
    "es": "Spanish", "es_ES": "Spanish",
    "fr": "French", "fr_FR": "French",
    "it": "Italian", "it_IT": "Italian",
    "pt": "Portuguese", "pt_BR": "Portuguese (Brazil)",
    "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
    "ru": "Russian", "ar": "Arabic", "hi": "Hindi", "ur": "Urdu"
}

class VoiceManager:
    def __init__(self, voices_dir: Path | None = None):
        self.voices_dir = voices_dir or settings.voices_dir
        self.voices_dir.mkdir(parents=True, exist_ok=True)

    def scan_voices(self) -> dict[str, VoiceMetadata]:
        discovered = {}
        for onnx_file in self.voices_dir.glob("*.onnx"):
            config_file = onnx_file.with_name(f"{onnx_file.name}.json")
            if not config_file.exists():
                # Also check without double extension (e.g., name.json)
                config_file = onnx_file.with_suffix(".json")
                if not config_file.exists():
                    continue

            voice_id = onnx_file.stem
            try:
                config_data = json.loads(config_file.read_text(encoding="utf-8"))
                
                espeak_voice = config_data.get("espeak", {}).get("voice", "")
                lang_code = config_data.get("language", {}).get("code") or espeak_voice or "en"
                lang_family = config_data.get("language", {}).get("family") or lang_code.split("_")[0]
                lang_name = config_data.get("language", {}).get("name_english") or LANGUAGE_NAME_MAP.get(lang_code) or LANGUAGE_NAME_MAP.get(lang_family) or lang_code
                
                dataset = config_data.get("dataset", "")
                quality = config_data.get("audio", {}).get("quality") or ("medium" if "medium" in voice_id else "low" if "low" in voice_id else "high" if "high" in voice_id else "standard")
                sample_rate = config_data.get("audio", {}).get("sample_rate", 22050)
                num_speakers = config_data.get("num_speakers", 1)
                
                file_size_mb = round(onnx_file.stat().st_size / (1024 * 1024), 2)
                mtime = int(onnx_file.stat().st_mtime)
                fingerprint = f"{file_size_mb}_{mtime}"
                
                # Derive friendly speaker/model name
                speaker_name = dataset.capitalize() if dataset else voice_id

                meta = VoiceMetadata(
                    voice_id=voice_id,
                    language_code=lang_code,
                    language_name=lang_name,
                    speaker_name=speaker_name,
                    quality=quality,
                    sample_rate=sample_rate,
                    num_speakers=num_speakers,
                    model_size_mb=file_size_mb,
                    model_path=str(onnx_file.resolve()),
                    config_path=str(config_file.resolve()),
                    is_valid=True,
                    model_fingerprint=fingerprint
                )
                discovered[voice_id] = meta
            except Exception as e:
                logger.warning(f"Skipping invalid voice file {onnx_file.name}: {e}")

        return discovered

    def list_voices(self) -> list[VoiceMetadata]:
        return list(self.scan_voices().values())

    def get_voice(self, voice_id: str) -> VoiceMetadata | None:
        safe_id = validate_safe_filename(voice_id)
        voices = self.scan_voices()
        return voices.get(safe_id)

    def delete_voice(self, voice_id: str) -> bool:
        safe_id = validate_safe_filename(voice_id)
        voice = self.get_voice(safe_id)
        if not voice:
            return False
        
        try:
            p_model = Path(voice.model_path)
            p_config = Path(voice.config_path)
            if p_model.exists(): p_model.unlink()
            if p_config.exists(): p_config.unlink()
            return True
        except Exception as e:
            logger.error(f"Error deleting voice {voice_id}: {e}")
            return False

voice_manager = VoiceManager()

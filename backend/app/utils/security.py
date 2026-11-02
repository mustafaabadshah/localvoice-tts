import re
from pathlib import Path
from fastapi import HTTPException, Security, Request, status
from fastapi.security import APIKeyHeader
from app.config import settings
from app.utils.logging import logger

API_KEY_HEADER = APIKeyHeader(name="X-LocalVoice-Token", auto_error=False)

def is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return True
    # Allow Chrome and Firefox extensions
    if origin.startswith("chrome-extension://") or origin.startswith("moz-extension://"):
        return True
    # Allow local connections
    if origin in settings.allowed_origins:
        return True
    if re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin):
        return True
    return False

def validate_safe_filename(name: str) -> str:
    """Ensure a filename/voice_id contains no path traversal components."""
    if ".." in name or "/" in name or "\\" in name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename: path traversal components are prohibited."
        )
    # Only allow alphanumeric, dash, underscore, and dot
    if not re.match(r"^[a-zA-Z0-9_\-\.]+$", name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename contains prohibited characters."
        )
    return name

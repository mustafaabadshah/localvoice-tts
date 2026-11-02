import os
import sys
import uvicorn
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.config import settings
from app.utils.logging import logger

def main():
    pid_file = backend_dir / "server.pid"
    try:
        pid_file.write_text(str(os.getpid()))
        logger.info(f"Starting {settings.app_name} on http://{settings.host}:{settings.port}")
        uvicorn.run(
            "app.main:app",
            host=settings.host,
            port=settings.port,
            log_level="info",
            access_log=False
        )
    finally:
        if pid_file.exists():
            try:
                pid_file.unlink()
            except Exception:
                pass

if __name__ == "__main__":
    main()

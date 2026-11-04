export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8765';

/**
 * The supervisor that starts and stops the backend on demand (`backend/controller.py`,
 * installed by `scripts/controller.ps1`). A browser extension has no API for spawning a
 * local process, so this port is the only way "click Read Page and it just works" can work.
 */
export const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:8766';

export const PLAYBACK_SPEEDS = [0.75, 0.90, 1.00, 1.10, 1.25, 1.50, 1.75, 2.00] as const;


export const HIGHLIGHT_CLASS_NAME = 'localvoice-active-highlight';
export const HIGHLIGHT_STYLE_ID = 'localvoice-injected-styles';

export const STORAGE_KEYS = {
  SETTINGS: 'localvoice_settings',
  VOICE_CACHE: 'localvoice_voices',
  /**
   * The in-progress read, kept in storage.session: it has to outlive the popup that started it
   * (closing a popup destroys its document) but not the browser session, and page text has no
   * business in storage.local.
   */
  SESSION: 'localvoice_session',
} as const;

/** How long a saved read stays worth resuming before it is treated as abandoned. */
export const RESUME_TTL_MS = 30 * 60 * 1000;

/** storage.session holds ~10 MB; a snapshot of page text beyond this is dropped, not written. */
export const MAX_SESSION_SNAPSHOT_CHARS = 4 * 1024 * 1024;

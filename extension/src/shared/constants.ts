export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8765';
export const PLAYBACK_SPEEDS = [0.75, 0.90, 1.00, 1.10, 1.25, 1.50, 1.75, 2.00] as const;

export const HIGHLIGHT_CLASS_NAME = 'localvoice-active-highlight';
export const HIGHLIGHT_STYLE_ID = 'localvoice-injected-styles';

export const STORAGE_KEYS = {
  SETTINGS: 'localvoice_settings',
  VOICE_CACHE: 'localvoice_voices',
} as const;

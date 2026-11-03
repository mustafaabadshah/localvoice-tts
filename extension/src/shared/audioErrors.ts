/**
 * Classification helpers for HTML5 audio failures.
 *
 * `HTMLMediaElement.play()` returns a promise that rejects with an `AbortError` whenever the
 * element is given a new source, paused, or torn down before playback actually starts:
 *
 *   "The play() request was interrupted by a new load request."
 *
 * That is the *normal* outcome of moving to the next paragraph in a single-element player - the
 * offscreen document assigns the next blob URL while the previous `play()` is still settling.
 * It carries no information about the audio itself, so it must never be surfaced as a playback
 * failure. Reporting it used to abort an entire reading session a few paragraphs into a Kokoro
 * read, which looked like "Kokoro breaks after 5-6 paragraphs".
 *
 * Both the offscreen player and the side-panel state machine import this module so they agree on
 * what counts as a real error.
 */

const SUPERSEDED_PLAYBACK_PATTERNS = [
  'interrupted by a new load request',
  'interrupted by a call to pause',
  'interrupted by the user agent',
  'interrupted by a call to load',
  'the play() request was interrupted'
];

/** Extracts a human-readable message from an `Error`, `DOMException`, string, or anything else. */
export function describeAudioError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown audio error';
  }
  if (typeof error === 'string') {
    return error || 'Unknown audio error';
  }
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; name?: unknown };
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
    if (typeof candidate.name === 'string' && candidate.name) return candidate.name;
  }
  return 'Unknown audio error';
}

/**
 * True when `error` only means "this playback was replaced before it started", i.e. there is
 * nothing wrong with the audio and nothing to recover from.
 */
export function isSupersededPlaybackError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (name === 'AbortError') return true;
  }
  const message = describeAudioError(error).toLowerCase();
  return SUPERSEDED_PLAYBACK_PATTERNS.some((pattern) => message.includes(pattern));
}

import { ExtensionMessage } from '../shared/types';
import { describeAudioError, isSupersededPlaybackError } from '../shared/audioErrors';
import { touchBackendActivity } from '../shared/backendControl';
import { DEFAULT_CONTROLLER_URL } from '../shared/constants';

const audioEl = document.getElementById('localvoice-audio-element') as HTMLAudioElement;

/**
 * Idle stop is measured by the controller, and by the time a chapter is half-read the popup
 * that started it has usually been closed for minutes. This heartbeat is what tells the
 * controller the backend is still in use. It runs while audio is actually playing and stops on
 * pause, `ended` and STOP, which is exactly when the idle clock should start: the controller's
 * window is 5 minutes, so a read paused and forgotten should unload the engine, and resuming it
 * wakes the backend again through synthesize()'s retry.
 */
const IDLE_HEARTBEAT_MS = 60_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startIdleHeartbeat(): void {
  void touchBackendActivity(DEFAULT_CONTROLLER_URL);
  if (heartbeatTimer !== null) return;
  heartbeatTimer = setInterval(
    () => void touchBackendActivity(DEFAULT_CONTROLLER_URL),
    IDLE_HEARTBEAT_MS
  );
}

function stopIdleHeartbeat(): void {
  if (heartbeatTimer === null) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

let currentBlockId: string | null = null;
let currentAudioUrl: string | null = null;
/**
 * Bumped for every load and every teardown.
 *
 * `play()` returns a promise that rejects with AbortError ("The play() request was interrupted
 * by a new load request") whenever the source is replaced before playback starts - which happens
 * on every paragraph hand-off. Comparing the token captured when `play()` was called against the
 * current one tells an expected cancellation apart from a genuine failure, so only real errors
 * are reported to the UI.
 */
let loadToken = 0;

function reportAudioError(blockId: string, error: unknown): void {
  if (isSupersededPlaybackError(error)) return;
  chrome.runtime.sendMessage({
    type: 'AUDIO_ERROR',
    error: describeAudioError(error),
    blockId
  }).catch(() => {});
}

if (audioEl) {
  audioEl.addEventListener('ended', () => {
    stopIdleHeartbeat();
    if (currentAudioUrl && currentAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
    const finishedBlockId = currentBlockId || '';
    currentBlockId = null;
    // No receiver while the popup is closed - the read stalls at the end of this paragraph, which
    // is the documented behaviour, but it is not an error worth an unhandled rejection.
    chrome.runtime.sendMessage({
      type: 'AUDIO_ENDED',
      blockId: finishedBlockId
    }).catch(() => {});
  });

  audioEl.addEventListener('error', () => {
    // `removeAttribute('src') + load()` (a normal stop) fires an error event with no source at
    // all. That is teardown noise, not a playback failure.
    if (!audioEl.currentSrc) return;
    reportAudioError(
      currentBlockId || '',
      audioEl.error?.message || 'Unknown HTML5 Audio error'
    );
  });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (!audioEl) return;

  switch (message.type) {
    case 'PLAY_AUDIO': {
      // Any play() still pending from the previous block is now obsolete.
      const token = ++loadToken;
      // Clean up previous blob URL if needed
      if (currentAudioUrl && currentAudioUrl.startsWith('blob:') && currentAudioUrl !== message.audioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }

      currentBlockId = message.blockId;
      currentAudioUrl = message.audioUrl;
      
      audioEl.src = message.audioUrl;
      audioEl.playbackRate = message.speed ?? 1.0;
      startIdleHeartbeat();
      audioEl.play().catch((err) => {
        // If a newer load has taken over, this rejection is the expected cancellation of a
        // superseded play() - not something the user needs to see.
        if (token !== loadToken) return;
        reportAudioError(message.blockId, err);
      });
      sendResponse({ status: 'playing' });
      break;
    }

    case 'PAUSE_AUDIO': {
      // A pause is a click, but the read is not using the engine until it resumes - so the
      // heartbeat stops here and the controller's idle window starts running. Otherwise a
      // paused read would hold the backend up all afternoon without a single request.
      stopIdleHeartbeat();
      audioEl.pause();
      sendResponse({ status: 'paused' });
      break;
    }

    case 'RESUME_AUDIO': {
      const token = loadToken;
      startIdleHeartbeat();
      audioEl.play().catch((err) => {
        if (token !== loadToken) return;
        reportAudioError(currentBlockId || '', err);
      });
      sendResponse({ status: 'playing' });
      break;
    }

    case 'STOP_AUDIO': {
      stopIdleHeartbeat();
      // Invalidate pending play(): tearing the element down rejects it with AbortError, which
      // must not be reported as a playback failure.
      loadToken++;
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.removeAttribute('src');
      audioEl.load();
      if (currentAudioUrl && currentAudioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
      }
      currentBlockId = null;
      sendResponse({ status: 'stopped' });
      break;
    }

    // Playback-rate trim. The UI no longer sends this: the speed multiplier is baked
    // into the audio by the engine during synthesis, so applying it here as well played 1.25x
    // audio at 1.56x. Kept so a future "rate only" control has a working message.
    case 'SET_AUDIO_SPEED': {
      audioEl.playbackRate = message.speed;
      sendResponse({ status: 'speed_updated' });
      break;
    }

    // The UI is an action popup, so it can be closed and reopened while the current paragraph
    // is still running here. This is how the reopened popup finds out whether it is looking at
    // a live playback it can control, or at a page with nothing loaded.
    case 'GET_PLAYBACK_STATE': {
      sendResponse({
        blockId: currentBlockId,
        playing: Boolean(currentAudioUrl) && !audioEl.paused && !audioEl.ended,
        // A block id is the honest test: `ended` and STOP_AUDIO both clear it while leaving a
        // dead blob URL on the element, so currentSrc alone would claim audio we can no longer
        // resume.
        hasSource: currentBlockId !== null && Boolean(audioEl.currentSrc),
        position: audioEl.currentTime,
        duration: Number.isFinite(audioEl.duration) ? audioEl.duration : 0
      });
      break;
    }

    default:
      break;
  }
  return true;
});

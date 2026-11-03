import { ExtensionMessage } from '../shared/types';
import { describeAudioError, isSupersededPlaybackError } from '../shared/audioErrors';

const audioEl = document.getElementById('localvoice-audio-element') as HTMLAudioElement;

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
    if (currentAudioUrl && currentAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
    const finishedBlockId = currentBlockId || '';
    currentBlockId = null;
    chrome.runtime.sendMessage({
      type: 'AUDIO_ENDED',
      blockId: finishedBlockId
    });
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
      audioEl.pause();
      sendResponse({ status: 'paused' });
      break;
    }

    case 'RESUME_AUDIO': {
      const token = loadToken;
      audioEl.play().catch((err) => {
        if (token !== loadToken) return;
        reportAudioError(currentBlockId || '', err);
      });
      sendResponse({ status: 'playing' });
      break;
    }

    case 'STOP_AUDIO': {
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

    default:
      break;
  }
  return true;
});

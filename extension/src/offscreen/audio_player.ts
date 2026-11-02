import { ExtensionMessage } from '../shared/types';

const audioEl = document.getElementById('localvoice-audio-element') as HTMLAudioElement;

let currentBlockId: string | null = null;
let currentAudioUrl: string | null = null;

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

  audioEl.addEventListener('error', (e) => {
    const errorMsg = audioEl.error?.message || 'Unknown HTML5 Audio error';
    chrome.runtime.sendMessage({
      type: 'AUDIO_ERROR',
      error: errorMsg,
      blockId: currentBlockId || ''
    });
  });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (!audioEl) return;

  switch (message.type) {
    case 'PLAY_AUDIO': {
      // Clean up previous blob URL if needed
      if (currentAudioUrl && currentAudioUrl.startsWith('blob:') && currentAudioUrl !== message.audioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }

      currentBlockId = message.blockId;
      currentAudioUrl = message.audioUrl;
      
      audioEl.src = message.audioUrl;
      audioEl.playbackRate = message.speed || 1.0;
      audioEl.play().catch((err) => {
        chrome.runtime.sendMessage({
          type: 'AUDIO_ERROR',
          error: err.message,
          blockId: message.blockId
        });
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
      audioEl.play().catch((err) => {
        chrome.runtime.sendMessage({
          type: 'AUDIO_ERROR',
          error: err.message,
          blockId: currentBlockId || ''
        });
      });
      sendResponse({ status: 'playing' });
      break;
    }

    case 'STOP_AUDIO': {
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

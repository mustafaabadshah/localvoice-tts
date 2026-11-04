/**
 * MV3 service worker.
 *
 * The UI is a plain toolbar popup (`action.default_popup` in the manifest), so Chrome owns the
 * surface: there is no window to create here and `action.onClicked` never fires. This worker does
 * two things - it keeps the offscreen audio document alive, and it reports tab navigation to the
 * popup. That popup is destroyed as soon as the user clicks into the page, which is why the UI
 * persists its reading position and restores it on the next open (see docs/v2_6_action_popup.md).
 */

import { browserAdapter } from '../adapters/browser_adapter';

// Helper to ensure offscreen audio document exists
async function ensureOffscreenDocument(): Promise<void> {
  const hasDoc = await browserAdapter.hasOffscreenDocument();
  if (!hasDoc) {
    try {
      await browserAdapter.createOffscreenDocument(
        'offscreen.html',
        // @ts-ignore
        [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        'LocalVoice offline speech playback'
      );
    } catch (e) {
      console.warn('Offscreen document creation:', e);
    }
  }
}

// Forward messages or handle requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument().then(() => sendResponse({ ready: true }));
    return true;
  }

  return false;
});

// Clean up if tab navigates or closes
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.runtime.sendMessage({ type: 'TAB_NAVIGATED', tabId }).catch(() => {});
  }
});

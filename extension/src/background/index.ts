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

/**
 * The UI opens in its own small window rather than in Chrome's side panel, which would shrink
 * the page being read. It has to be a real window and not an action popup: the reading loop
 * lives in the UI process, and an action popup closes the instant the user clicks back into the
 * article - which would strand the session after the current paragraph.
 */
const UI_WINDOW_KEY = 'localvoice_ui_window_id';
const UI_WIDTH = 400;
const UI_HEIGHT = 680;

async function readStoredWindowId(): Promise<number | null> {
  try {
    const stored = await chrome.storage.session.get(UI_WINDOW_KEY);
    const id = stored?.[UI_WINDOW_KEY];
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

/** Open the UI window, or surface the one already open instead of stacking duplicates. */
async function openUiWindow(): Promise<void> {
  const existingId = await readStoredWindowId();
  if (existingId !== null) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return;
    } catch {
      // Window closed while the service worker was asleep - fall through and open a new one.
    }
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: UI_WIDTH,
    height: UI_HEIGHT
  });

  if (created?.id !== undefined) {
    await chrome.storage.session.set({ [UI_WINDOW_KEY]: created.id }).catch(() => {});
  }
}

// Toolbar icon opens (or surfaces) the UI window.
chrome.action.onClicked.addListener(() => {
  openUiWindow().catch((err) => console.warn('Could not open LocalVoice window:', err));
});

// Forgetting the id on close keeps the next icon click from focusing a dead window.
chrome.windows.onRemoved.addListener((windowId) => {
  readStoredWindowId()
    .then((id) => (id === windowId ? chrome.storage.session.remove(UI_WINDOW_KEY) : undefined))
    .catch(() => {});
});

// Forward messages or handle requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument().then(() => sendResponse({ ready: true }));
    return true;
  }
  
  if (message.type === 'OPEN_UI_WINDOW') {
    openUiWindow()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
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

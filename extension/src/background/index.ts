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

// Enable opening side panel when user clicks the extension action icon in toolbar
// @ts-ignore
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  // @ts-ignore
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('Failed to set openPanelOnActionClick:', err);
  });
}

// Fallback listener for action click if setPanelBehavior is not supported
// @ts-ignore
if (chrome.action && chrome.action.onClicked) {
  // @ts-ignore
  chrome.action.onClicked.addListener(async (tab) => {
    // @ts-ignore
    if (tab?.id && chrome.sidePanel && chrome.sidePanel.open) {
      // @ts-ignore
      chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
        console.warn('Failed to open side panel via action click:', err);
      });
    }
  });
}

// Forward messages or handle requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument().then(() => sendResponse({ ready: true }));
    return true;
  }
  
  if (message.type === 'OPEN_SIDE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      // @ts-ignore
      if (tab?.id && chrome.sidePanel && chrome.sidePanel.open) {
        // @ts-ignore
        chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
          console.warn('Could not open side panel:', err);
        });
      }
    });
    sendResponse({ ok: true });
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

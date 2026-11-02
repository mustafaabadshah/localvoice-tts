import { extractArticleContent, extractSelectedContent } from './extractor';
import { highlightBlock, clearAllHighlights, cleanupHighlighting } from './highlighter';
import { ExtensionMessage } from '../shared/types';

(function initLocalVoiceContentScript() {
  const messageHandler = (
    message: ExtensionMessage | { type: 'PING' },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    try {
      if (message.type === 'PING') {
        sendResponse({ pong: true });
        return false;
      }
      if (message.type === 'EXTRACT_PAGE') {
        const result = extractArticleContent();
        sendResponse(result);
        return false;
      }
      if (message.type === 'EXTRACT_SELECTION') {
        const result = extractSelectedContent();
        sendResponse(result);
        return false;
      }
      if (message.type === 'HIGHLIGHT_BLOCK') {
        const success = highlightBlock(message.blockId, message.autoScroll);
        sendResponse({ success });
        return false;
      }
      if (message.type === 'CLEAR_HIGHLIGHTS') {
        clearAllHighlights();
        sendResponse({ success: true });
        return false;
      }
    } catch (err: any) {
      console.error('[LocalVoice Content Script Error]', err);
      sendResponse({ error: err?.message || 'Error executing action in webpage.' });
      return false;
    }
    return false;
  };

  const win = window as any;
  if (win.__LOCALVOICE_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(win.__LOCALVOICE_LISTENER__);
    } catch (_) {}
  }
  win.__LOCALVOICE_LISTENER__ = messageHandler;
  chrome.runtime.onMessage.addListener(messageHandler);

  if (!win.__LOCALVOICE_UNLOAD_ATTACHED__) {
    win.__LOCALVOICE_UNLOAD_ATTACHED__ = true;
    window.addEventListener('beforeunload', () => {
      cleanupHighlighting();
    });
  }
})();

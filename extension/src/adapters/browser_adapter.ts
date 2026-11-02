export interface IBrowserAdapter {
  getActiveTab(): Promise<chrome.tabs.Tab | null>;
  sendMessageToTab<T = any>(tabId: number, message: any): Promise<T>;
  sendRuntimeMessage<T = any>(message: any): Promise<T>;
  getStorage<T = any>(key: string): Promise<T | null>;
  setStorage(key: string, value: any): Promise<void>;
  createOffscreenDocument(url: string, reasons: string[], justification: string): Promise<void>;
  hasOffscreenDocument(): Promise<boolean>;
}

export class ChromeBrowserAdapter implements IBrowserAdapter {
  async getActiveTab(): Promise<chrome.tabs.Tab | null> {
    try {
      // 1. Check active tab in current window (where popup/sidepanel is opened)
      const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      for (const t of currentTabs) {
        if (t.id && (!t.url || (!t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools://')))) {
          return t;
        }
      }

      // 2. Check active tab in last focused window
      const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      for (const t of focusedTabs) {
        if (t.id && (!t.url || (!t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools://')))) {
          return t;
        }
      }

      // 3. Fallback: all active tabs across all windows
      const allActive = await chrome.tabs.query({ active: true });
      for (const t of allActive) {
        if (t.id && (!t.url || (!t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools://')))) {
          return t;
        }
      }

      return currentTabs[0] || focusedTabs[0] || allActive[0] || null;
    } catch (e) {
      console.warn('[LocalVoice] Failed to query active tab:', e);
      return null;
    }
  }

  async sendMessageToTab<T = any>(tabId: number, message: any): Promise<T> {
    if (!tabId || tabId <= 0) {
      throw new Error('No valid browser tab identifier.');
    }

    // Try sending message directly first
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (initialErr: any) {
      console.log('[LocalVoice] Direct tab message failed, attempting dynamic injection into tab', tabId, initialErr?.message);

      // Attempt dynamic injection if available
      if (chrome.scripting && chrome.scripting.executeScript) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });

          // Wait briefly for content script listener registration
          await new Promise((resolve) => setTimeout(resolve, 200));

          return await chrome.tabs.sendMessage(tabId, message);
        } catch (injectionErr: any) {
          console.error('[LocalVoice] Dynamic injection error:', injectionErr);
          const msg = injectionErr?.message || '';

          if (msg.includes('Cannot access contents of url') && msg.includes('file://')) {
            throw new Error(
              'To read local file:// pages, please open chrome://extensions, click Details on LocalVoice, and enable "Allow access to file URLs".'
            );
          }
          if (msg.includes('Cannot access a chrome://') || msg.includes('chrome://')) {
            throw new Error(
              'Chrome does not allow extensions to run on browser internal pages (chrome://). Switch to an article or website tab.'
            );
          }
          throw new Error(`Could not access page content: ${msg || initialErr?.message}`);
        }
      }

      throw initialErr;
    }
  }

  async sendRuntimeMessage<T = any>(message: any): Promise<T> {
    return chrome.runtime.sendMessage(message);
  }

  async getStorage<T = any>(key: string): Promise<T | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T) ?? null;
  }

  async setStorage(key: string, value: any): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async createOffscreenDocument(url: string, reasons: string[], justification: string): Promise<void> {
    if (await this.hasOffscreenDocument()) return;
    // @ts-ignore
    await chrome.offscreen.createDocument({
      url,
      reasons: reasons as any,
      justification
    });
  }

  async hasOffscreenDocument(): Promise<boolean> {
    // @ts-ignore
    if (!chrome.offscreen || !chrome.offscreen.hasDocument) return false;
    // @ts-ignore
    return await chrome.offscreen.hasDocument();
  }
}

export const browserAdapter = new ChromeBrowserAdapter();

import { ReadingState, TextBlock, LocalVoiceSettings } from '../../shared/types';
import { browserAdapter } from '../../adapters/browser_adapter';

export interface ReadingEngineListener {
  onStateChange: (state: ReadingState) => void;
  onBlockChange: (index: number, block: TextBlock | null) => void;
  onError: (error: string) => void;
}

export class ReadingEngine {
  public state: ReadingState = 'IDLE';
  public blocks: TextBlock[] = [];
  public currentIndex: number = 0;
  
  private listener: ReadingEngineListener;
  private settings: LocalVoiceSettings;
  private abortController: AbortController | null = null;
  private activeTabId: number | null = null;

  constructor(settings: LocalVoiceSettings, listener: ReadingEngineListener) {
    this.settings = settings;
    this.listener = listener;

    // Listen for events from offscreen player
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'AUDIO_ENDED') {
        this.handleAudioEnded(message.blockId);
      } else if (message.type === 'AUDIO_ERROR') {
        this.handleAudioError(message.error);
      } else if (message.type === 'TAB_NAVIGATED') {
        if (this.activeTabId && message.tabId === this.activeTabId) {
          this.stop();
        }
      }
    });
  }

  public updateSettings(newSettings: LocalVoiceSettings): void {
    const speedChanged = this.settings.playbackSpeed !== newSettings.playbackSpeed;
    this.settings = newSettings;
    if (speedChanged && (this.state === 'PLAYING' || this.state === 'PAUSED')) {
      chrome.runtime.sendMessage({
        type: 'SET_AUDIO_SPEED',
        speed: newSettings.playbackSpeed
      }).catch(() => {});
    }
  }

  public setContent(blocks: TextBlock[], tabId: number): void {
    this.blocks = blocks;
    this.currentIndex = 0;
    this.activeTabId = tabId;
    this.setState(blocks.length > 0 ? 'READY' : 'IDLE');
    this.listener.onBlockChange(0, blocks[0] || null);
  }

  public async startReading(fromIndex: number = 0): Promise<void> {
    if (this.blocks.length === 0) return;
    this.currentIndex = Math.max(0, Math.min(fromIndex, this.blocks.length - 1));
    await this.processCurrentBlock();
  }

  public async pause(): Promise<void> {
    if (this.state !== 'PLAYING') return;
    await chrome.runtime.sendMessage({ type: 'PAUSE_AUDIO' });
    this.setState('PAUSED');
  }

  public async resume(): Promise<void> {
    if (this.state !== 'PAUSED') return;
    await chrome.runtime.sendMessage({ type: 'RESUME_AUDIO' });
    this.setState('PLAYING');
  }

  public async stop(): Promise<void> {
    this.setState('STOPPING');
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    await chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
    await this.clearHighlights();
    this.currentIndex = 0;
    this.setState('IDLE');
    this.listener.onBlockChange(0, this.blocks[0] || null);
  }

  public async nextParagraph(): Promise<void> {
    if (this.currentIndex < this.blocks.length - 1) {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      await chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
      this.currentIndex++;
      await this.processCurrentBlock();
    } else {
      await this.stop();
    }
  }

  public async prevParagraph(): Promise<void> {
    if (this.currentIndex > 0) {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      await chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
      this.currentIndex--;
      await this.processCurrentBlock();
    }
  }

  private async processCurrentBlock(): Promise<void> {
    if (this.currentIndex >= this.blocks.length) {
      this.setState('COMPLETED');
      await this.clearHighlights();
      return;
    }

    const currentBlock = this.blocks[this.currentIndex];
    this.listener.onBlockChange(this.currentIndex, currentBlock);

    // 1. Highlight current block in webpage
    if (this.settings.highlightEnabled && this.activeTabId) {
      await browserAdapter.sendMessageToTab(this.activeTabId, {
        type: 'HIGHLIGHT_BLOCK',
        blockId: currentBlock.id,
        autoScroll: this.settings.autoScroll
      }).catch(() => {});
    }

    // 2. Synthesize audio from local Piper backend
    this.setState('SYNTHESIZING');
    this.abortController = new AbortController();

    try {
      // Ensure offscreen audio document is alive
      await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' }).catch(() => {});

      const response = await fetch(`${this.settings.backendUrl}/api/v1/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentBlock.text,
          voice_id: this.settings.selectedVoiceId || undefined,
          speed: this.settings.playbackSpeed
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Synthesis failed' }));
        throw new Error(errorData.detail || `Server returned status ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // 3. Play audio through offscreen document
      this.setState('PLAYING');
      await chrome.runtime.sendMessage({
        type: 'PLAY_AUDIO',
        audioUrl,
        blockId: currentBlock.id,
        speed: this.settings.playbackSpeed
      });
    } catch (err: any) {
      if (err.name === 'AbortError') return; // Deliberate cancellation
      this.setState('ERROR');
      this.listener.onError(err.message || 'Speech generation failed');
    }
  }

  private handleAudioEnded(finishedBlockId: string): void {
    if (this.state !== 'PLAYING') return;
    const currentBlock = this.blocks[this.currentIndex];
    if (!currentBlock || currentBlock.id === finishedBlockId) {
      this.nextParagraph();
    }
  }

  private handleAudioError(error: string): void {
    if (this.state === 'STOPPING' || this.state === 'IDLE') return;
    this.setState('ERROR');
    this.listener.onError(`Audio playback error: ${error}`);
  }

  private async clearHighlights(): Promise<void> {
    if (this.activeTabId) {
      await browserAdapter.sendMessageToTab(this.activeTabId, {
        type: 'CLEAR_HIGHLIGHTS'
      }).catch(() => {});
    }
  }

  private setState(newState: ReadingState): void {
    this.state = newState;
    this.listener.onStateChange(newState);
  }
}

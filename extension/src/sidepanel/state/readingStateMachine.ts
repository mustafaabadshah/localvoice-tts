import { ReadingState, TextBlock, LocalVoiceSettings, TTSEngineType } from '../../shared/types';
import { describeBackendError } from '../../shared/errors';
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
  private prefetchAbortController: AbortController | null = null;
  private prefetchBuffer: Map<string, string> = new Map();
  private prefetchInFlight: boolean = false;
  private activeAudioUrl: string | null = null;
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
    const engineChanged = this.settings.selectedEngine !== newSettings.selectedEngine;
    
    this.settings = newSettings;

    if (engineChanged) {
      this.clearPrefetchBuffer();
      this.releaseActiveAudio();
      if (this.state === 'PLAYING' || this.state === 'SYNTHESIZING' || this.state === 'PAUSED') {
        // Stop old engine audio immediately to avoid mixing audio streams
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
        }
        chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
        this.setState('READY');
      }
    }

    if (speedChanged) {
      this.clearPrefetchBuffer();
      if (this.state === 'PLAYING' || this.state === 'PAUSED') {
        chrome.runtime.sendMessage({
          type: 'SET_AUDIO_SPEED',
          speed: newSettings.playbackSpeed
        }).catch(() => {});
      }
    }
  }

  public switchEngine(newEngine: TTSEngineType): void {
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
    this.settings.selectedEngine = newEngine;
    if (this.blocks.length > 0) {
      this.setState('READY');
    } else {
      this.setState('IDLE');
    }
  }

  /**
   * Revokes every prefetched blob URL and cancels the in-flight prefetch request.
   * Prefetched audio is only valid for the engine/voice/speed that produced it.
   */
  private clearPrefetchBuffer(): void {
    if (this.prefetchAbortController) {
      this.prefetchAbortController.abort();
      this.prefetchAbortController = null;
    }
    this.prefetchInFlight = false;
    for (const url of this.prefetchBuffer.values()) {
      URL.revokeObjectURL(url);
    }
    this.prefetchBuffer.clear();
  }

  private releaseActiveAudio(): void {
    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
    }
  }

  /** Hands a finished blob URL to the offscreen player and frees the previous one. */
  private async startAudio(audioUrl: string, blockId: string): Promise<void> {
    if (this.activeAudioUrl && this.activeAudioUrl !== audioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
    }
    this.activeAudioUrl = audioUrl;
    await chrome.runtime.sendMessage({
      type: 'PLAY_AUDIO',
      audioUrl,
      blockId,
      speed: this.settings.playbackSpeed
    });
  }

  /**
   * Starts synthesizing the next paragraph while the current one plays, so the
   * hand-off is instant instead of paying the full synthesis latency again.
   * Only one block is buffered at a time to keep memory flat on 8 GB machines.
   */
  private triggerPrefetchNext(): void {
    if (this.prefetchInFlight || this.prefetchBuffer.size > 0) return;
    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.blocks.length) return;
    const nextBlock = this.blocks[nextIndex];
    if (this.prefetchBuffer.has(nextBlock.id)) return;
    void this.prefetchBlock(nextBlock);
  }

  private async prefetchBlock(block: TextBlock): Promise<void> {
    const engine = this.settings.selectedEngine;
    const targetVoiceId = engine === 'kokoro'
      ? this.settings.selectedKokoroVoiceId
      : this.settings.selectedPiperVoiceId;

    this.prefetchInFlight = true;
    this.prefetchAbortController = new AbortController();
    try {
      const response = await fetch(`${this.settings.backendUrl}/api/v1/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: block.text,
          engine,
          voice_id: targetVoiceId || undefined,
          speed: this.settings.playbackSpeed
        }),
        signal: this.prefetchAbortController.signal
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        // Discard the result if the engine changed while the request was in flight
        if (this.settings.selectedEngine !== engine) return;
        this.prefetchBuffer.set(block.id, URL.createObjectURL(audioBlob));
      }
    } catch {
      // Prefetch failure or abort is non-fatal - the block is fetched on demand
    } finally {
      this.prefetchInFlight = false;
    }
  }

  public setContent(blocks: TextBlock[], tabId: number): void {
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
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
    if (this.state === 'PLAYING') {
      await chrome.runtime.sendMessage({ type: 'PAUSE_AUDIO' });
      this.setState('PAUSED');
    }
  }

  public async resume(): Promise<void> {
    if (this.state === 'PAUSED') {
      await chrome.runtime.sendMessage({ type: 'RESUME_AUDIO' });
      this.setState('PLAYING');
    }
  }

  public async stop(): Promise<void> {
    this.setState('STOPPING');
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
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
      this.releaseActiveAudio();
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
      this.releaseActiveAudio();
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

    // 2. Play the already-prefetched block if one is buffered for this paragraph
    const prefetchedUrl = this.prefetchBuffer.get(currentBlock.id);
    if (prefetchedUrl) {
      this.prefetchBuffer.delete(currentBlock.id);
      this.setState('PLAYING');
      await this.startAudio(prefetchedUrl, currentBlock.id);
      this.triggerPrefetchNext();
      return;
    }

    // 3. Synthesize audio from local backend
    this.setState('SYNTHESIZING');
    this.abortController = new AbortController();

    const targetVoiceId = this.settings.selectedEngine === 'kokoro'
      ? this.settings.selectedKokoroVoiceId
      : this.settings.selectedPiperVoiceId;

    try {
      // Ensure offscreen audio document is alive
      await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' }).catch(() => {});

      const response = await fetch(`${this.settings.backendUrl}/api/v1/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentBlock.text,
          engine: this.settings.selectedEngine,
          voice_id: targetVoiceId || undefined,
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

      // 4. Play audio through offscreen document
      this.setState('PLAYING');
      await this.startAudio(audioUrl, currentBlock.id);
      this.triggerPrefetchNext();
    } catch (err: any) {
      if (err.name === 'AbortError') return; // Deliberate cancellation
      this.setState('ERROR');
      this.listener.onError(describeBackendError(err, this.settings.backendUrl));
    }
  }

  private handleAudioEnded(finishedBlockId: string): void {
    if (this.state !== 'PLAYING') return;
    const currentBlock = this.blocks[this.currentIndex];
    if (!currentBlock || currentBlock.id === finishedBlockId) {
      this.releaseActiveAudio();
      this.nextParagraph();
    }
  }

  private handleAudioError(error: string): void {
    if (this.state === 'STOPPING' || this.state === 'IDLE') return;
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
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

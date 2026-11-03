import { ReadingState, TextBlock, LocalVoiceSettings, TTSEngineType } from '../../shared/types';
import { describeBackendError } from '../../shared/errors';
import { isSupersededPlaybackError } from '../../shared/audioErrors';
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
  /**
   * The single prefetch request currently on the wire, tagged with the block it will
   * produce. Kept as a promise (not a boolean) so a paragraph transition can *wait* for
   * the audio instead of asking the backend to synthesise the same text a second time.
   */
  private prefetchInFlight: { seq: number; blockId: string; promise: Promise<void> } | null = null;
  private prefetchSeq: number = 0;
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
        this.handleAudioError(message.error, message.blockId);
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
      // The speed multiplier is baked into the audio by the engine itself (Piper length_scale,
      // Kokoro speed), so audio buffered for the old speed is unusable and must be dropped. The
      // block already playing keeps its original pace; the next one picks up the new speed.
      this.clearPrefetchBuffer();
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
    this.prefetchInFlight = null;
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
    // Chrome reaps the offscreen document when it looks idle, so re-assert it before every
    // hand-off - the prefetched path skips the synthesis block that used to do this.
    await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' }).catch(() => {});
    // Playback rate stays 1.0: the backend already applies the speed multiplier while
    // synthesising (Piper length_scale, Kokoro speed). Also passing it here made a 1.25x
    // selection actually play at 1.56x, and 1.5x at 2.25x, which is why sped-up Piper sounded
    // rushed and artefact-heavy.
    await chrome.runtime.sendMessage({
      type: 'PLAY_AUDIO',
      audioUrl,
      blockId,
      speed: 1.0
    });
  }

  /**
   * How many blocks ahead to keep synthesised.
   *
   * Piper runs at RTF ~0.2, so preparing two blocks costs a fraction of the time the current one
   * takes to speak and it covers the case where the next block is unusually long. Kokoro runs at
   * RTF 8.66+, where a second queued request would only delay the block the user is waiting for,
   * so it keeps a single block in reserve.
   */
  private get prefetchDepth(): number {
    return this.settings.selectedEngine === 'kokoro' ? 1 : 2;
  }

  /**
   * Starts synthesizing the upcoming paragraphs while the current one plays, so the
   * hand-off is instant instead of paying the full synthesis latency again.
   */
  private triggerPrefetchNext(): void {
    // Never start a request for a session that is no longer reading (stop, completion,
    // error, or a chained call that lands after the reader was stopped).
    if (this.state !== 'PLAYING' && this.state !== 'PAUSED' && this.state !== 'SYNTHESIZING') {
      return;
    }

    const upcoming: TextBlock[] = [];
    for (let offset = 1; offset <= this.prefetchDepth; offset++) {
      const block = this.blocks[this.currentIndex + offset];
      if (!block) break;
      upcoming.push(block);
    }

    // Drop buffered audio that is not for a block we are about to play. A leftover entry
    // used to wedge prefetching permanently: the size-based guard below saw a stale URL and
    // returned early, so every following paragraph had to be synthesised from scratch.
    const upcomingIds = new Set(upcoming.map((block) => block.id));
    for (const [blockId, url] of Array.from(this.prefetchBuffer.entries())) {
      if (!upcomingIds.has(blockId)) {
        URL.revokeObjectURL(url);
        this.prefetchBuffer.delete(blockId);
      }
    }

    if (upcoming.length === 0) return;

    const pending = this.prefetchInFlight;
    if (pending) {
      // A request for a block we have since navigated away from would waste engine time.
      if (!upcomingIds.has(pending.blockId)) {
        this.prefetchAbortController?.abort();
        void pending.promise.then(() => this.triggerPrefetchNext());
      }
      return;
    }

    const missing = upcoming.find((block) => !this.prefetchBuffer.has(block.id));
    if (!missing) return;

    void this.prefetchBlock(missing).then(() => {
      // Fill the remaining slot - but only when the request actually produced audio, so a
      // failing block cannot turn into an unbounded retry loop.
      if (this.prefetchBuffer.has(missing.id)) {
        this.triggerPrefetchNext();
      }
    });
  }

  /**
   * Synthesises `block` in the background and parks the resulting blob URL in the buffer.
   * The returned promise settles once the buffer has (or has not) been filled, so callers
   * can await it instead of issuing a duplicate request for the same paragraph.
   */
  private prefetchBlock(block: TextBlock): Promise<void> {
    const engine = this.settings.selectedEngine;
    const speed = this.settings.playbackSpeed;
    const targetVoiceId = engine === 'kokoro'
      ? this.settings.selectedKokoroVoiceId
      : this.settings.selectedPiperVoiceId;

    const seq = ++this.prefetchSeq;
    const controller = new AbortController();
    this.prefetchAbortController = controller;

    let release: () => void = () => {};
    const settled = new Promise<void>((resolve) => { release = resolve; });
    this.prefetchInFlight = { seq, blockId: block.id, promise: settled };

    void (async () => {
      try {
        const response = await fetch(`${this.settings.backendUrl}/api/v1/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: block.text,
            engine,
            voice_id: targetVoiceId || undefined,
            speed
          }),
          signal: controller.signal
        });

        if (!response.ok) return;

        const audioBlob = await response.blob();
        // Discard the result if engine, speed or the buffer changed while in flight
        if (
          controller.signal.aborted ||
          this.settings.selectedEngine !== engine ||
          this.settings.playbackSpeed !== speed
        ) {
          return;
        }
        this.prefetchBuffer.set(block.id, URL.createObjectURL(audioBlob));
      } catch {
        // Prefetch failure or abort is non-fatal - the block is fetched on demand
      } finally {
        if (this.prefetchInFlight?.seq === seq) {
          this.prefetchInFlight = null;
        }
        release();
      }
    })();

    return settled;
  }

  public setContent(blocks: TextBlock[], tabId: number): void {
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
    this.blocks = blocks;
    this.currentIndex = 0;
    this.activeTabId = tabId;
    this.setState(blocks.length > 0 ? 'READY' : 'IDLE');
    this.listener.onBlockChange(0, blocks[0] || null);
    this.warmStart();
  }

  /**
   * Synthesises the opening blocks while the panel sits idle, so that pressing Play starts
   * speaking immediately instead of waiting out a full synthesis pass (Piper needs ~6 s for a
   * typical paragraph, which the user currently spends staring at "Ready").
   *
   * Piper only: a Kokoro warm-up would hold the engine lock for ~40 s per block and would
   * stall an engine switch or the "Continue with Fast Piper" fallback.
   *
   * Anything parked here is discarded by clearPrefetchBuffer() on stop/switch, and warming a
   * block the user never plays costs nothing beyond CPU time already spent.
   */
  private warmStart(): void {
    if (this.settings.selectedEngine !== 'piper') return;
    const first = this.blocks[0];
    if (!first || this.prefetchInFlight || this.prefetchBuffer.has(first.id)) return;

    void this.prefetchBlock(first).then(() => {
      // A short opening block (usually a heading) is over in about a second, so queue the first
      // real paragraph behind it as well - otherwise the reader starts instantly and then stalls.
      const next = this.blocks[1];
      if (!next || this.state !== 'READY' || this.prefetchInFlight) return;
      if (first.text.length > 120 || this.prefetchBuffer.has(next.id)) return;
      void this.prefetchBlock(next);
    });
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
      await this.finish();
    }
  }

  /**
   * End of the page: keep the position (so Play resumes at the last paragraph instead of
   * jumping back to the top) and report COMPLETED instead of silently snapping to IDLE.
   */
  private async finish(): Promise<void> {
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    await chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
    await this.clearHighlights();
    this.setState('COMPLETED');
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

    // 2. Play the buffered block, or wait out the prefetch already on the wire.
    //    Without that wait the panel posted a duplicate request for the same paragraph, the
    //    backend serialised the two on the engine lock, and the user watched "Synthesizing..."
    //    for seconds between paragraphs while the audio was already being produced.
    let prefetchedUrl = this.prefetchBuffer.get(currentBlock.id);
    const pendingPrefetch = this.prefetchInFlight;
    if (!prefetchedUrl && pendingPrefetch && pendingPrefetch.blockId === currentBlock.id) {
      this.setState('SYNTHESIZING');
      await pendingPrefetch.promise;
      prefetchedUrl = this.prefetchBuffer.get(currentBlock.id);
    }

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

  private handleAudioError(error: string, blockId?: string): void {
    if (this.state === 'STOPPING' || this.state === 'IDLE') return;

    // A pending play() rejects with AbortError the moment the element is given a new source or
    // paused - i.e. on every paragraph hand-off. Treating that as a failure aborted the whole
    // session a few paragraphs into a read with "Audio playback error: The play() request was
    // interrupted by a new load request".
    if (isSupersededPlaybackError(error)) return;

    // An error attributed to a block we have already moved past cannot affect what plays now.
    const currentBlock = this.blocks[this.currentIndex];
    if (blockId && currentBlock && blockId !== currentBlock.id) return;

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

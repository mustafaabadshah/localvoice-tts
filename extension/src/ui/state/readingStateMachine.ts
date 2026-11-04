import { ReadingState, TextBlock, LocalVoiceSettings, TTSEngineType } from '../../shared/types';
import { describeBackendError, isBackendUnreachable } from '../../shared/errors';
import { isSupersededPlaybackError } from '../../shared/audioErrors';
import { startBackend } from '../../shared/backendControl';
import { DEFAULT_CONTROLLER_URL } from '../../shared/constants';
import { browserAdapter } from '../../adapters/browser_adapter';
import { clipKey, getClip, putClip } from '../../shared/audioClips';

export interface ReadingEngineListener {
  onStateChange: (state: ReadingState) => void;
  onBlockChange: (index: number, block: TextBlock | null) => void;
  onError: (error: string) => void;
  /**
   * A transient line for the popup ("Starting the local backend..."), cleared with null.
   * A warm-up that takes 15 s is not an error, but silence for 15 s looks like one.
   */
  onNotice?: (text: string | null) => void;
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
  /**
   * The in-flight "please start the backend" call. Shared, because a cold popup makes the
   * main request and the prefetcher fail together and both need the same one warm-up.
   */
  private wakePromise: Promise<boolean> | null = null;
  private activeAudioUrl: string | null = null;
  private activeTabId: number | null = null;
  /**
   * Set when a restored session re-attached to audio the offscreen player still holds. The blob
   * URL belongs to the popup document that was closed, so it is not in `activeAudioUrl` - yet
   * pause/resume on the player are valid, and treating the session as "no audio loaded" would
   * make Play synthesise a paragraph that is already playing.
   */
  private restoredWithLiveAudio = false;
  /**
   * Bumped whenever the reader is reset (stop, engine switch). Any await that outlives the reset
   * - a clip lookup, a synthesis - compares against it and drops its result, so audio can never
   * start playing after the user has already moved on.
   */
  private sessionToken = 0;

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

  /** The voice id the given settings would speak with. */
  private voiceIdFor(settings: LocalVoiceSettings): string {
    return settings.selectedEngine === 'kokoro'
      ? settings.selectedKokoroVoiceId
      : settings.selectedPiperVoiceId;
  }

  public updateSettings(newSettings: LocalVoiceSettings): void {
    const speedChanged = this.settings.playbackSpeed !== newSettings.playbackSpeed;
    const engineChanged = this.settings.selectedEngine !== newSettings.selectedEngine;
    // A different voice is a different audio file for the same text, so anything already
    // buffered or loaded belongs to a voice the user just turned off.
    const voiceChanged = this.voiceIdFor(this.settings) !== this.voiceIdFor(newSettings);
    
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

    if (voiceChanged && !engineChanged) {
      // Same engine, new voice: drop the old-voice audio and re-synthesise the paragraph the
      // user is on, so the switch is audible immediately instead of after the current sentence.
      this.clearPrefetchBuffer();
      this.releaseActiveAudio();
      if (this.state === 'PLAYING' || this.state === 'PAUSED') {
        // The old voice is already loaded in the player - revoking the blob URL does not silence
        // it, so the element has to be stopped explicitly before the same text is spoken again.
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
        }
        chrome.runtime.sendMessage({ type: 'STOP_AUDIO' }).catch(() => {});
        void this.startReading(this.currentIndex);
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
    this.sessionToken++;
    if (this.blocks.length > 0) {
      this.setState('READY');
      // Warm the paragraph the user is on, not the first one: after a switch the next thing they
      // press is Continue, and it must not pay the engine's warm-up for audio they don't want.
      this.warmStart(this.currentIndex);
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
    // From here on the player holds audio for the block being spoken, so resume() is valid
    // regardless of how the session started.
    this.restoredWithLiveAudio = false;
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

    const identity = { engine, voiceId: targetVoiceId, speed };
    const key = clipKey(identity, block.text);

    void (async () => {
      try {
        // A paragraph this machine has already spoken in this engine/voice/speed needs no
        // request at all: park the stored clip and skip the engine.
        const stored = await getClip(await key);
        if (controller.signal.aborted) return;
        if (stored) {
          this.prefetchBuffer.set(block.id, URL.createObjectURL(stored));
          return;
        }

        const response = await this.synthesize(block.text, engine, targetVoiceId, speed, controller.signal);

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
        // Keep it for the next engine switch, popup reopen or replay of this paragraph.
        void putClip(await key, audioBlob, identity);
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
    this.restoredWithLiveAudio = false;
    this.blocks = blocks;
    this.currentIndex = 0;
    this.activeTabId = tabId;
    this.setState(blocks.length > 0 ? 'READY' : 'IDLE');
    this.listener.onBlockChange(0, blocks[0] || null);
    this.warmStart();
  }

  /**
   * Rebuilds a session that outlived the popup document which started it.
   *
   * `liveAudio` means the offscreen player still holds *this* block's audio, so pause()/resume()
   * act on real playback and the read carries on mid-sentence. Without it the position is only a
   * bookmark: the blob URL died with the old document, so Play has to synthesise the paragraph
   * again (cheap, because the backend serves it from its disk cache).
   */
  public restore(
    blocks: TextBlock[],
    tabId: number,
    index: number,
    state: ReadingState,
    liveAudio: boolean
  ): void {
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
    this.blocks = blocks;
    this.activeTabId = tabId;
    this.currentIndex = Math.max(0, Math.min(index, blocks.length - 1));
    this.restoredWithLiveAudio = liveAudio;
    this.setState(state);
    this.listener.onBlockChange(this.currentIndex, this.blocks[this.currentIndex] || null);
  }

  /** True when the offscreen player holds audio that pause/resume can still act on. */
  public canResumeInPlace(): boolean {
    return this.restoredWithLiveAudio || this.activeAudioUrl !== null;
  }

  /** Refills the prefetch buffer after a restored session re-attached to live playback. */
  public resumePrefetch(): void {
    this.triggerPrefetchNext();
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
  private warmStart(index: number = this.currentIndex): void {
    if (this.settings.selectedEngine !== 'piper') return;
    const first = this.blocks[index];
    if (!first || this.prefetchInFlight || this.prefetchBuffer.has(first.id)) return;

    void this.prefetchBlock(first).then(() => {
      // A short block (usually a heading) is over in about a second, so queue the block behind it
      // as well - otherwise the reader starts instantly and then stalls.
      const next = this.blocks[index + 1];
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

  /**
   * Gets the current paragraph ready to play *without* starting it.
   *
   * Called after an engine switch, so the paragraph the user is sitting on is already synthesised
   * (or already in the clip store) by the time they press Continue. Nothing is spoken until they
   * ask for it, and a stale request is dropped by the prefetch abort/seq guards.
   */
  public prepareCurrent(): void {
    const block = this.blocks[this.currentIndex];
    if (!block || this.prefetchInFlight || this.prefetchBuffer.has(block.id)) return;
    void this.prefetchBlock(block);
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
    this.sessionToken++;
    this.clearPrefetchBuffer();
    this.releaseActiveAudio();
    this.restoredWithLiveAudio = false;
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

    const token = this.sessionToken;
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

    const engine = this.settings.selectedEngine;
    const speed = this.settings.playbackSpeed;
    const targetVoiceId = this.voiceIdFor(this.settings);

    // 3. Audio this machine already produced for exactly this engine/voice/speed. This is the
    //    path that makes an engine switch - or a second Read Page - instant instead of showing
    //    "Synthesizing..." for a paragraph the user has already heard.
    const clipIdentity = { engine, voiceId: targetVoiceId, speed };
    const cacheKey = await clipKey(clipIdentity, currentBlock.text);
    const storedClip = await getClip(cacheKey);
    if (token !== this.sessionToken) return; // stopped or switched while we were reading the cache
    if (storedClip) {
      this.setState('PLAYING');
      await this.startAudio(URL.createObjectURL(storedClip), currentBlock.id);
      this.triggerPrefetchNext();
      return;
    }

    // 4. Synthesize audio from local backend
    this.setState('SYNTHESIZING');
    this.abortController = new AbortController();

    try {
      // Ensure offscreen audio document is alive
      await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' }).catch(() => {});

      const response = await this.synthesize(
        currentBlock.text,
        engine,
        targetVoiceId,
        speed,
        this.abortController.signal
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Synthesis failed' }));
        throw new Error(errorData.detail || `Server returned status ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      // Remember it: a later engine switch, a reopened popup or a replayed paragraph all need
      // this exact audio and must not pay for the engine again.
      void putClip(cacheKey, audioBlob, clipIdentity);

      // 5. Play audio through offscreen document
      this.setState('PLAYING');
      await this.startAudio(audioUrl, currentBlock.id);
      this.triggerPrefetchNext();
    } catch (err: any) {
      if (err.name === 'AbortError') return; // Deliberate cancellation
      this.setState('ERROR');
      this.listener.onError(describeBackendError(err, this.settings.backendUrl));
    }
  }

  /**
   * POST /api/v1/synthesize, with one recovery attempt.
   *
   * A stopped backend (idle auto-stop, a cold machine, a crash) looks exactly like a dead
   * port to `fetch`. The controller on :8766 can start it, so "Failed to fetch" becomes a
   * ~15 s warm-up instead of an error the user has to fix by hand. The retry happens at most
   * once, and never for an abort: a deliberate stop must stay stopped.
   */
  private async synthesize(
    text: string,
    engine: TTSEngineType,
    voiceId: string,
    speed: number,
    signal: AbortSignal
  ): Promise<Response> {
    const url = `${this.settings.backendUrl}/api/v1/synthesize`;
    const body = JSON.stringify({
      text,
      engine,
      voice_id: voiceId || undefined,
      speed
    });
    const send = () =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal
      });

    try {
      return await send();
    } catch (err) {
      if (signal.aborted || !isBackendUnreachable(err)) throw err;
      const woke = await this.wakeBackend();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!woke) throw err;
      return await send();
    }
  }

  /**
   * Starts the backend through the controller, once for however many callers ask.
   *
   * Returns false when the controller is not installed or refused: the caller then reports
   * the original failure, which is still the honest answer.
   */
  private wakeBackend(): Promise<boolean> {
    if (!this.settings.autoStartBackend) return Promise.resolve(false);
    if (this.wakePromise) return this.wakePromise;

    this.listener.onNotice?.('Starting the local backend...');
    this.wakePromise = startBackend(DEFAULT_CONTROLLER_URL)
      .then((status) => status?.backend === 'running')
      .catch(() => false)
      .finally(() => {
        this.wakePromise = null;
        this.listener.onNotice?.(null);
      });
    return this.wakePromise;
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

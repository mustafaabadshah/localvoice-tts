import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Header } from './components/Header';
import { PageInfo } from './components/PageInfo';
import { PlaybackInfo } from './components/PlaybackInfo';
import { Controls } from './components/Controls';
import { VoiceSelector } from './components/VoiceSelector';
import { SettingsModal } from './components/SettingsModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { ComparisonModal } from './components/ComparisonModal';
import { BackendPower } from './components/BackendPower';

import {
  ReadingState,
  TextBlock,
  VoiceMetadata,
  BackendHealth,
  LocalVoiceSettings,
  ExtractionResult,
  ExtractionDiagnostics,
  TTSEngineType,
  ReadingSessionSnapshot,
  PlaybackState,
  ControllerStatus
} from '../shared/types';
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_CONTROLLER_URL,
  STORAGE_KEYS,
  RESUME_TTL_MS,
  MAX_SESSION_SNAPSHOT_CHARS
} from '../shared/constants';
import { describeBackendError } from '../shared/errors';
import { readControllerStatus, startBackend, stopBackend } from '../shared/backendControl';
import {
  estimatePageSynthSeconds,
  formatDuration,
  isSlowerThanRealtime
} from '../shared/enginePerf';
import { ReadingEngine } from './state/readingStateMachine';
import { browserAdapter } from '../adapters/browser_adapter';
import { clearClips } from '../shared/audioClips';

export const App: React.FC = () => {
  // Settings State
  const [settings, setSettings] = useState<LocalVoiceSettings>({
    backendUrl: DEFAULT_BACKEND_URL,
    selectedEngine: 'piper',
    selectedPiperVoiceId: 'en_US-lessac-medium',
    selectedKokoroVoiceId: 'af_heart',
    playbackSpeed: 1.0,
    autoScroll: true,
    highlightEnabled: true,
    autoStartBackend: true
  });

  // Reading Engine State
  const [readingState, setReadingState] = useState<ReadingState>('IDLE');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentBlock, setCurrentBlock] = useState<TextBlock | null>(null);
  const [pageTitle, setPageTitle] = useState('Untitled Webpage');

  // Backend & Voice State
  const [health, setHealth] = useState<BackendHealth | null>(null);
  // null = not polled yet, false = last poll failed, true = backend answered.
  // Kept separate from `health` so the offline hint never flashes during the first poll.
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [piperVoices, setPiperVoices] = useState<VoiceMetadata[]>([]);
  const [kokoroVoices, setKokoroVoices] = useState<VoiceMetadata[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diagnosticsData, setDiagnosticsData] = useState<ExtractionDiagnostics | null>(null);

  // Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  // Where a reopened popup picked the read back up. Shown once, because a player that looks
  // ready but sits mid-page needs one line of explanation.
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  // The controller that starts/stops the backend. null = nothing on 127.0.0.1:8766, which is
  // the honest state on a clone that never ran scripts\controller.ps1.
  const [controller, setController] = useState<ControllerStatus | null>(null);
  const [backendBusy, setBackendBusy] = useState(false);

  // Engine Ref
  const engineRef = useRef<ReadingEngine | null>(null);

  /**
   * The document the current session belongs to. The engine tracks the tab id but not the URL,
   * and URL identity is what makes a saved session safe to restore: a reused tab id must not
   * resurrect a different article's paragraph list.
   */
  const sessionMetaRef = useRef<{ tabId: number; pageUrl: string } | null>(null);

  /**
   * Picks a read back up where the last popup left it.
   *
   * An action popup is destroyed the moment the user clicks into the page, and the ReadingEngine
   * that drives a read lives in that document - so without this every click on the page silently
   * ended the session and reopening showed an empty player while audio kept streaming.
   *
   * Returns false when there is nothing trustworthy to restore. The saved position is only a
   * promise about one document, so the tab has to still exist and still hold the same URL.
   */
  const restoreSession = async (
    engine: ReadingEngine,
    effective: LocalVoiceSettings
  ): Promise<boolean> => {
    const snapshot = await browserAdapter
      .getSessionStorage<ReadingSessionSnapshot>(STORAGE_KEYS.SESSION)
      .catch(() => null);
    const discard = async (): Promise<boolean> => {
      await browserAdapter.removeSessionStorage(STORAGE_KEYS.SESSION).catch(() => {});
      return false;
    };

    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.blocks) || snapshot.blocks.length === 0) {
      return false;
    }

    const age = Date.now() - snapshot.savedAt;
    if (!Number.isFinite(age) || age < 0 || age > RESUME_TTL_MS) return discard();

    let tabUrl: string | undefined;
    try {
      tabUrl = (await chrome.tabs.get(snapshot.tabId))?.url;
    } catch {
      return discard();
    }
    if (snapshot.pageUrl && tabUrl !== snapshot.pageUrl) return discard();

    // Speaking the rest of the page in a different voice is not a continuation of the same read.
    if (snapshot.engine !== effective.selectedEngine || snapshot.playbackSpeed !== effective.playbackSpeed) {
      return discard();
    }

    // Is the offscreen player still holding this paragraph? Then the popup was closed mid-speech
    // and the read never stopped; otherwise the saved position is only a bookmark.
    const playback = await browserAdapter
      .sendRuntimeMessage<PlaybackState>({ type: 'GET_PLAYBACK_STATE' })
      .catch(() => null);
    const savedBlockId = snapshot.blocks[snapshot.currentIndex]?.id;
    const liveAudio = Boolean(playback?.hasSource && savedBlockId && playback.blockId === savedBlockId);
    const stillPlaying = Boolean(liveAudio && playback?.playing);

    // The paragraph the closed popup was speaking may have run to its end with nobody listening
    // for the 'ended' event - the one thing a snapshot cannot know.
    const resumeIndex =
      !playback?.hasSource && snapshot.state === 'PLAYING'
        ? Math.min(snapshot.currentIndex + 1, snapshot.blocks.length - 1)
        : snapshot.currentIndex;

    setPageTitle(snapshot.pageTitle || 'Untitled Webpage');
    setBlocks(snapshot.blocks);
    sessionMetaRef.current = { tabId: snapshot.tabId, pageUrl: snapshot.pageUrl };
    engine.restore(
      snapshot.blocks,
      snapshot.tabId,
      resumeIndex,
      stillPlaying ? 'PLAYING' : 'PAUSED',
      liveAudio
    );
    if (liveAudio) engine.resumePrefetch();

    const position = `${resumeIndex + 1} / ${snapshot.blocks.length}`;
    setResumeNotice(
      stillPlaying
        ? `Still reading ${position} — reopened`
        : `Resumed at ${position} — press play to continue`
    );
    return true;
  };

  // 1. Initialize settings, the engine and any session left behind by a closed popup
  useEffect(() => {
    const engine = new ReadingEngine(settings, {
      onStateChange: (newState) => setReadingState(newState),
      onBlockChange: (idx, blk) => {
        setCurrentIndex(idx);
        setCurrentBlock(blk);
      },
      onError: (err) => setErrorMessage(err),
      // A 15 s warm-up is not an error, but 15 s of silence looks like one.
      onNotice: (text) => setResumeNotice(text)
    });
    engineRef.current = engine;

    void (async () => {
      const saved = await browserAdapter
        .getStorage<LocalVoiceSettings>(STORAGE_KEYS.SETTINGS)
        .catch(() => null);
      const effective: LocalVoiceSettings = saved ? { ...settings, ...saved } : settings;
      if (saved) {
        setSettings((prev) => ({ ...prev, ...saved }));
        // Hand the engine the real settings *before* restoring: a settings update arriving after
        // a restore would read as an engine switch and stop the playback it just re-attached to.
        engine.updateSettings(effective);
      }

      const restored = await restoreSession(engine, effective).catch(() => false);
      if (!restored) {
        // Name the page before it has been read: the panel should say what it *would*
        // read instead of showing a placeholder until the first extraction lands.
        const tab = await browserAdapter.getActiveTab().catch(() => null);
        if (tab?.title) setPageTitle(tab.title);
      }

      checkBackendHealth();
      void checkController();
      fetchAllVoices();
    })();

    // One poll for both: "is the engine up" and "can anything start it" are two halves of the
    // same question, and polling /status also keeps the controller's idle timer honest while
    // the popup is open.
    const interval = setInterval(() => {
      void checkBackendHealth();
      void checkController();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update engine whenever settings change
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateSettings(settings);
    }
    browserAdapter.setStorage(STORAGE_KEYS.SETTINGS, settings);
  }, [settings]);

  /**
   * Persist the read so the next popup can resume it.
   *
   * There is no "popup is closing" event to hook - the document is torn down without warning -
   * so the position is written as it changes. The write is debounced because one paragraph
   * hand-off moves through SYNTHESIZING and PLAYING inside the same tick.
   */
  useEffect(() => {
    const meta = sessionMetaRef.current;
    if (!meta || blocks.length === 0) return;

    const resumableState =
      readingState === 'PLAYING' || readingState === 'PAUSED' ||
      readingState === 'SYNTHESIZING' || readingState === 'READY'
        ? readingState
        : null;

    if (!resumableState) {
      // Stopped, finished, or failed: there is nothing to come back to.
      void browserAdapter.removeSessionStorage(STORAGE_KEYS.SESSION).catch(() => {});
      return;
    }

    const snapshot: ReadingSessionSnapshot = {
      version: 1,
      savedAt: Date.now(),
      tabId: meta.tabId,
      pageUrl: meta.pageUrl,
      pageTitle,
      blocks,
      currentIndex,
      state: resumableState,
      engine: settings.selectedEngine,
      playbackSpeed: settings.playbackSpeed
    };

    // storage.session holds 10 MB. Summing the text is enough to spot a page that cannot fit,
    // and it costs one pass instead of serialising the whole snapshot on every paragraph.
    const payloadChars = blocks.reduce((sum, block) => sum + block.text.length + block.id.length, 0);
    if (payloadChars > MAX_SESSION_SNAPSHOT_CHARS) return;

    const handle = setTimeout(() => {
      void browserAdapter.setSessionStorage(STORAGE_KEYS.SESSION, snapshot).catch(() => {});
    }, 250);

    return () => clearTimeout(handle);
  }, [blocks, currentIndex, readingState, pageTitle, settings.selectedEngine, settings.playbackSpeed]);

  const checkBackendHealth = async () => {
    try {
      const res = await fetch(`${settings.backendUrl}/api/v1/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
        setBackendReachable(true);
      } else {
        setHealth(null);
        setBackendReachable(false);
      }
    } catch {
      setHealth(null);
      setBackendReachable(false);
    }
  };

  const checkController = async () => {
    const status = await readControllerStatus(DEFAULT_CONTROLLER_URL);
    setController(status);
  };

  const fetchAllVoices = async () => {
    try {
      // Fetch Piper voices
      const resPiper = await fetch(`${settings.backendUrl}/api/v1/voices?engine=piper`);
      if (resPiper.ok) {
        const dataPiper = await resPiper.json();
        setPiperVoices(dataPiper.voices || []);
      }

      // Fetch Kokoro voices
      const resKokoro = await fetch(`${settings.backendUrl}/api/v1/voices?engine=kokoro`);
      if (resKokoro.ok) {
        const dataKokoro = await resKokoro.json();
        setKokoroVoices(dataKokoro.voices || []);
      }
    } catch (e) {
      console.warn('Could not fetch voices:', e);
    }
  };

  const handleSelectEngine = async (newEngine: TTSEngineType) => {
    if (newEngine === settings.selectedEngine) return;

    const resumeAt = currentIndex;
    const total = blocks.length;

    // 1. Immediately abort any in-flight synthesis / audio on frontend
    engineRef.current?.switchEngine(newEngine);

    // 2. Immediately update state so UI switches instantly
    setSettings((s) => ({ ...s, selectedEngine: newEngine }));

    // 3. Notify backend asynchronously
    try {
      await fetch(`${settings.backendUrl}/api/v1/engines/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: newEngine })
      });
      checkBackendHealth();
    } catch (e: any) {
      console.warn(`Backend engine select sync: ${e?.message}`);
    }

    // 4. Keep the position. The switch is not a new read: get *this* paragraph ready so the
    //    next Continue speaks immediately, and say where the read will resume.
    if (total > 0) {
      setResumeNotice(
        `Switched to ${newEngine === 'piper' ? 'Piper' : 'Kokoro'} - continue at paragraph ${resumeAt + 1} of ${total}`
      );
      engineRef.current?.prepareCurrent();
    }
  };

  /**
   * Kokoro is ~43x more expensive than Piper on a 2-core CPU, so a full-page read with
   * it stalls for minutes at every paragraph. This switches to Piper *and* resumes at the
   * paragraph being read, instead of dropping the user back into a stopped player.
   */
  const handleReadWithPiper = async () => {
    const resumeAt = currentIndex;
    await handleSelectEngine('piper');
    if (blocks.length > 0) {
      await engineRef.current?.startReading(resumeAt);
    }
  };

  // Actions
  /**
   * "Read Page" continues the current read; it does not restart it.
   *
   * It used to re-extract and call setContent() on every press, which resets the position to
   * paragraph 1 - so every pause, reopened popup and engine switch paid for paragraph 1 again
   * and showed "Synthesizing..." for audio the user had already heard. The page is only
   * re-extracted when the tab really moved to another document, when there are no blocks yet,
   * or when the last read ran to the end.
   */
  const handleReadPage = async () => {
    setErrorMessage(null);

    const tab = await browserAdapter.getActiveTab();
    if (!tab?.id) {
      setErrorMessage('No active browser tab found. Please switch to a webpage tab.');
      setReadingState('IDLE');
      return;
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
      setErrorMessage('Browser internal pages (like chrome://) cannot be read. Switch to an article or website tab.');
      setReadingState('IDLE');
      return;
    }

    // Same document as the live session? Then this press means "keep going", not "start over".
    // COMPLETED and ERROR are deliberately excluded: a finished or broken read starts clean.
    const meta = sessionMetaRef.current;
    const sameDocument =
      blocks.length > 0 &&
      meta !== null &&
      meta.tabId === tab.id &&
      // Hash-only navigation (in-page anchors) must not be mistaken for a new article.
      meta.pageUrl.split('#')[0] === (tab.url || '').split('#')[0] &&
      (readingState === 'READY' ||
        readingState === 'PAUSED' ||
        readingState === 'PLAYING' ||
        readingState === 'SYNTHESIZING' ||
        readingState === 'IDLE');

    if (sameDocument) {
      if (readingState === 'PLAYING') {
        // Already speaking: nothing to do.
      } else if (readingState === 'PAUSED' && engineRef.current?.canResumeInPlace()) {
        // Mid-paragraph and the player still holds the audio: resume, don't restart it.
        await engineRef.current?.resume();
      } else {
        // Speaks the paragraph the reader is on; cached audio plays without touching the engine.
        await engineRef.current?.startReading(currentIndex);
      }
      setResumeNotice(
        currentIndex > 0 ? `Continuing at paragraph ${currentIndex + 1} of ${blocks.length}` : null
      );
      return;
    }

    setReadingState('EXTRACTING');

    try {
      const result: ExtractionResult = await browserAdapter.sendMessageToTab(tab.id, { type: 'EXTRACT_PAGE' });
      if ((result as any)?.error) {
        setErrorMessage((result as any).error);
        setReadingState('IDLE');
        return;
      }
      if (!result || !result.blocks || result.blocks.length === 0) {
        setErrorMessage('No readable paragraphs or text blocks found on this page.');
        setReadingState('IDLE');
        return;
      }

      if (result.diagnostics) {
        setDiagnosticsData(result.diagnostics);
      }

      setPageTitle(result.pageTitle || 'Webpage');
      setBlocks(result.blocks);
      sessionMetaRef.current = { tabId: tab.id, pageUrl: result.pageUrl || tab.url || '' };
      setResumeNotice(null);
      engineRef.current?.setContent(result.blocks, tab.id);
      await engineRef.current?.startReading(0);
    } catch (err: any) {
      console.error('Read Page extraction error:', err);
      setErrorMessage(err?.message || 'Could not extract page text. Ensure the page is fully loaded.');
      setReadingState('IDLE');
    }
  };

  const handleReadSelection = async () => {
    setErrorMessage(null);
    setReadingState('EXTRACTING');
    const tab = await browserAdapter.getActiveTab();
    if (!tab?.id) {
      setErrorMessage('No active browser tab found. Please switch to a webpage tab.');
      setReadingState('IDLE');
      return;
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
      setErrorMessage('Browser internal pages (like chrome://) cannot be read. Switch to an article or website tab.');
      setReadingState('IDLE');
      return;
    }

    try {
      const result: ExtractionResult = await browserAdapter.sendMessageToTab(tab.id, { type: 'EXTRACT_SELECTION' });
      if ((result as any)?.error) {
        setErrorMessage((result as any).error);
        setReadingState('IDLE');
        return;
      }
      if (!result || !result.blocks || result.blocks.length === 0) {
        setErrorMessage('No text currently selected. Highlight some text on the webpage first.');
        setReadingState('IDLE');
        return;
      }

      if (result.diagnostics) {
        setDiagnosticsData(result.diagnostics);
      }

      setPageTitle(result.pageTitle || 'Webpage');
      setBlocks(result.blocks);
      sessionMetaRef.current = { tabId: tab.id, pageUrl: result.pageUrl || tab.url || '' };
      setResumeNotice(null);
      engineRef.current?.setContent(result.blocks, tab.id);
      await engineRef.current?.startReading(0);
    } catch (err: any) {
      console.error('Read Selection error:', err);
      setErrorMessage(err?.message || 'Could not extract selected text.');
      setReadingState('IDLE');
    }
  };

  const handlePlayPause = async () => {
    if (readingState === 'PLAYING') {
      await engineRef.current?.pause();
    } else if (readingState === 'PAUSED') {
      // A restored session is paused at a bookmark, not inside audio: the blob URL it played
      // belonged to the popup document that was closed, so resuming the element would fail.
      // Only re-attach when the offscreen player genuinely still holds this paragraph.
      if (engineRef.current?.canResumeInPlace()) {
        await engineRef.current?.resume();
      } else {
        await engineRef.current?.startReading(currentIndex);
      }
    } else if (readingState === 'READY' || readingState === 'COMPLETED' || readingState === 'ERROR' || (readingState === 'IDLE' && blocks.length > 0)) {
      await engineRef.current?.startReading(currentIndex);
    } else if (readingState === 'IDLE') {
      await handleReadPage();
    }
    setResumeNotice(null);
  };

  const handleStop = async () => {
    await engineRef.current?.stop();
    setResumeNotice(null);
  };

  const handleNext = async () => {
    await engineRef.current?.nextParagraph();
  };

  const handlePrev = async () => {
    await engineRef.current?.prevParagraph();
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSettings((s) => ({ ...s, playbackSpeed: newSpeed }));
  };

  const handleSelectVoice = (voiceId: string) => {
    if (settings.selectedEngine === 'kokoro') {
      setSettings((s) => ({ ...s, selectedKokoroVoiceId: voiceId }));
    } else {
      setSettings((s) => ({ ...s, selectedPiperVoiceId: voiceId }));
    }
  };

  const handleTestVoice = async (voiceId: string) => {
    try {
      const res = await fetch(`${settings.backendUrl}/api/v1/voices/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_id: voiceId,
          engine: settings.selectedEngine
        })
      });

      if (!res.ok) throw new Error('Voice test generation failed');

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.playbackRate = settings.playbackSpeed;
      await audio.play();
    } catch (e: any) {
      setErrorMessage(describeBackendError(e, settings.backendUrl));
    }
  };

  const handleClearCache = async () => {
    // Both halves of the cache: the backend's disk cache and the clip store this extension keeps
    // in IndexedDB. Clearing only the backend left the extension replaying its own copies.
    await Promise.all([
      fetch(`${settings.backendUrl}/api/v1/cache/clear`, { method: 'POST' }).catch(() => {}),
      clearClips()
    ]);
    setResumeNotice('Cleared cached audio');
  };

  /**
   * The power button. Turning the engine on is the slow direction (~15 s of ONNX loading),
   * so the row shows "warm-up" rather than pretending the toggle was instant; turning it off
   * is immediate and also has to clear the voice list, which described a backend that is
   * no longer running.
   */
  const handleToggleBackend = async () => {
    if (!controller || backendBusy) return;

    const wantStop = controller.backend === 'running' || backendReachable === true;
    setBackendBusy(true);
    try {
      const next = wantStop
        ? await stopBackend(DEFAULT_CONTROLLER_URL)
        : await startBackend(DEFAULT_CONTROLLER_URL);
      if (next) setController(next);
      await checkBackendHealth();
      if (!wantStop) await fetchAllVoices();
    } finally {
      setBackendBusy(false);
    }
  };

  const activeVoices = settings.selectedEngine === 'kokoro' ? kokoroVoices : piperVoices;
  const activeSelectedVoiceId = settings.selectedEngine === 'kokoro' ? settings.selectedKokoroVoiceId : settings.selectedPiperVoiceId;

  // Pace guard: warn *before* burning minutes of CPU on an engine that cannot keep up.
  // Prefetching cannot compensate for an engine with RTF > 1, so the only honest fix is to
  // surface the cost up front and make the switch to Piper a single click.
  const kokoroPageSeconds = estimatePageSynthSeconds('kokoro', blocks);
  const piperPageSeconds = estimatePageSynthSeconds('piper', blocks);
  const kokoroPerParagraphSeconds = blocks.length > 0 ? kokoroPageSeconds / blocks.length : 0;
  const showKokoroPaceWarning =
    settings.selectedEngine === 'kokoro' &&
    blocks.length > 1 &&
    isSlowerThanRealtime('kokoro') &&
    kokoroPageSeconds >= 60;

  const anyModalOpen = settingsOpen || diagnosticsOpen || comparisonOpen;

  return (
    <div className="panel-container" data-modal={anyModalOpen ? 'open' : undefined}>
      {/* Header with Dual Engine Toggle */}
      <Header
        health={health}
        activeEngine={settings.selectedEngine}
        onSelectEngine={handleSelectEngine}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        onOpenComparison={() => setComparisonOpen(true)}
        disabled={readingState === 'PLAYING' || readingState === 'SYNTHESIZING'}
      />

      {/* One row owns the backend's power state: whether it is up, where, the idle window,
          and the toggle. It replaced the old offline banner rather than sitting beside it -
          both answered the same question and a popup cannot afford two rows saying "down". */}
      <BackendPower
        status={controller}
        backendReachable={backendReachable}
        backendUrl={settings.backendUrl}
        busy={backendBusy}
        onToggle={handleToggleBackend}
      />

      {/* Engine cost as one line of numbers with the escape hatch attached. Kokoro
          needs this much CPU per second of audio on a small CPU; Piper does not. */}
      {showKokoroPaceWarning && (
        <div className="banner">
          <span className="meta" style={{ fontWeight: 600, color: 'var(--accent)' }}>Kokoro</span>
          <span className="meta">
            {formatDuration(kokoroPerParagraphSeconds)}/para · {formatDuration(kokoroPageSeconds)} total
          </span>
          <button
            className="btn-primary"
            onClick={handleReadWithPiper}
            style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '10px' }}
            title="Switch to Piper and continue from this paragraph"
          >
            Piper {formatDuration(piperPageSeconds)}
          </button>
        </div>
      )}

      {/* Errors are the only prose the panel allows, because they carry a recovery action. */}
      {errorMessage && (
        <div className="banner" data-tone="danger">
          <span style={{ color: 'var(--danger)', flex: 1, lineHeight: 1.4 }}>{errorMessage}</span>
          <button className="icon-btn" onClick={() => setErrorMessage(null)} title="Dismiss" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      {/* A reopened popup has to say where it came back to: a half-filled player with no
          explanation reads as a bug, and one line is cheaper than re-reading the page. */}
      {resumeNotice && (
        <div className="banner">
          <span className="meta" style={{ flex: 1, color: 'var(--text-primary)' }}>{resumeNotice}</span>
          <button className="icon-btn" onClick={() => setResumeNotice(null)} title="Dismiss" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Page Info */}
      <PageInfo pageTitle={pageTitle} blocks={blocks} />

      {/* Current Paragraph & Progress */}
      <PlaybackInfo
        state={readingState}
        currentIndex={currentIndex}
        totalBlocks={blocks.length}
        currentBlock={currentBlock}
        activeEngine={settings.selectedEngine}
      />

      {/* Action Buttons & Playback Controls */}
      {/* `continueAt` makes the primary button say "Continue" while a session is parked past
          paragraph 1; COMPLETED and ERROR start the page over and keep the "Read Page" label. */}
      <Controls
        state={readingState}
        hasBlocks={blocks.length > 0}
        speed={settings.playbackSpeed}
        continueAt={
          currentIndex > 0 &&
          (readingState === 'READY' ||
            readingState === 'PAUSED' ||
            readingState === 'PLAYING' ||
            readingState === 'SYNTHESIZING' ||
            readingState === 'IDLE')
            ? currentIndex + 1
            : 0
        }
        totalParagraphs={blocks.length}
        onReadPage={handleReadPage}
        onReadSelection={handleReadSelection}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        onPrev={handlePrev}
        onNext={handleNext}
        onSpeedChange={handleSpeedChange}
      />

      {/* Engine-Specific Voice Selector */}
      <VoiceSelector
        voices={activeVoices}
        selectedVoiceId={activeSelectedVoiceId}
        onSelectVoice={handleSelectVoice}
        onTestVoice={handleTestVoice}
        disabled={readingState === 'PLAYING' || readingState === 'SYNTHESIZING'}
      />

      {/* Modals */}
      <SettingsModal
        settings={settings}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={(newSettings) => setSettings(newSettings)}
        onClearCache={handleClearCache}
      />

      <DiagnosticsModal
        isOpen={diagnosticsOpen}
        backendUrl={settings.backendUrl}
        diagnostics={diagnosticsData}
        onClose={() => setDiagnosticsOpen(false)}
      />

      <ComparisonModal
        isOpen={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
        backendUrl={settings.backendUrl}
        defaultText={currentBlock?.text || ''}
        piperVoices={piperVoices}
        kokoroVoices={kokoroVoices}
        selectedPiperVoiceId={settings.selectedPiperVoiceId}
        selectedKokoroVoiceId={settings.selectedKokoroVoiceId}
      />
    </div>
  );
};

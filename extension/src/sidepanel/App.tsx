import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { PageInfo } from './components/PageInfo';
import { PlaybackInfo } from './components/PlaybackInfo';
import { Controls } from './components/Controls';
import { VoiceSelector } from './components/VoiceSelector';
import { SettingsModal } from './components/SettingsModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { ComparisonModal } from './components/ComparisonModal';

import {
  ReadingState,
  TextBlock,
  VoiceMetadata,
  BackendHealth,
  LocalVoiceSettings,
  ExtractionResult,
  ExtractionDiagnostics,
  TTSEngineType
} from '../shared/types';
import { DEFAULT_BACKEND_URL, STORAGE_KEYS } from '../shared/constants';
import { describeBackendError } from '../shared/errors';
import { ReadingEngine } from './state/readingStateMachine';
import { browserAdapter } from '../adapters/browser_adapter';

export const App: React.FC = () => {
  // Settings State
  const [settings, setSettings] = useState<LocalVoiceSettings>({
    backendUrl: DEFAULT_BACKEND_URL,
    selectedEngine: 'piper',
    selectedPiperVoiceId: 'en_US-lessac-medium',
    selectedKokoroVoiceId: 'af_heart',
    playbackSpeed: 1.0,
    autoScroll: true,
    highlightEnabled: true
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

  // Engine Ref
  const engineRef = useRef<ReadingEngine | null>(null);

  // 1. Initialize Settings and Engine on Mount
  useEffect(() => {
    browserAdapter.getStorage<LocalVoiceSettings>(STORAGE_KEYS.SETTINGS).then((saved) => {
      if (saved) {
        setSettings((prev) => ({ ...prev, ...saved }));
      }
    });

    const engine = new ReadingEngine(settings, {
      onStateChange: (newState) => setReadingState(newState),
      onBlockChange: (idx, blk) => {
        setCurrentIndex(idx);
        setCurrentBlock(blk);
      },
      onError: (err) => setErrorMessage(err)
    });
    engineRef.current = engine;

    checkBackendHealth();
    fetchAllVoices();

    const interval = setInterval(checkBackendHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update engine whenever settings change
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateSettings(settings);
    }
    browserAdapter.setStorage(STORAGE_KEYS.SETTINGS, settings);
  }, [settings]);

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
  };

  // Actions
  const handleReadPage = async () => {
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

      setPageTitle(`${result.pageTitle || 'Webpage'} (Selected Text)`);
      setBlocks(result.blocks);
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
      await engineRef.current?.resume();
    } else if (readingState === 'READY' || readingState === 'COMPLETED' || (readingState === 'IDLE' && blocks.length > 0)) {
      await engineRef.current?.startReading(currentIndex);
    } else if (readingState === 'IDLE') {
      await handleReadPage();
    }
  };

  const handleStop = async () => {
    await engineRef.current?.stop();
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
    await fetch(`${settings.backendUrl}/api/v1/cache/clear`, { method: 'POST' });
  };

  const activeVoices = settings.selectedEngine === 'kokoro' ? kokoroVoices : piperVoices;
  const activeSelectedVoiceId = settings.selectedEngine === 'kokoro' ? settings.selectedKokoroVoiceId : settings.selectedPiperVoiceId;

  return (
    <div className="panel-container">
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

      {/* Backend offline hint - self-clears as soon as a health poll succeeds */}
      {backendReachable === false && (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          color: 'var(--text-secondary)',
          fontSize: '10.5px',
          lineHeight: 1.4
        }}>
          Backend not reachable at <strong style={{ color: 'var(--text-primary)' }}>{settings.backendUrl}</strong>.
          <br />
          Start it with <strong style={{ color: 'var(--text-primary)' }}>.\scripts\start.ps1</strong> in the LocalVoice folder.
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--danger)',
          padding: '6px 10px',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--danger)',
          fontSize: '10.5px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{errorMessage}</span>
          <button style={{ color: 'var(--text-secondary)', fontWeight: 600, marginLeft: '6px' }} onClick={() => setErrorMessage(null)}>
            ✕
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
        onSwitchToPiper={() => handleSelectEngine('piper')}
      />

      {/* Action Buttons & Playback Controls */}
      <Controls
        state={readingState}
        hasBlocks={blocks.length > 0}
        speed={settings.playbackSpeed}
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
        engine={settings.selectedEngine}
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

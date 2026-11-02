import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { PageInfo } from './components/PageInfo';
import { PlaybackInfo } from './components/PlaybackInfo';
import { Controls } from './components/Controls';
import { VoiceSelector } from './components/VoiceSelector';
import { SettingsModal } from './components/SettingsModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';

import {
  ReadingState,
  TextBlock,
  VoiceMetadata,
  BackendHealth,
  LocalVoiceSettings,
  ExtractionResult
} from '../shared/types';
import { DEFAULT_BACKEND_URL, STORAGE_KEYS } from '../shared/constants';
import { ReadingEngine } from './state/readingStateMachine';
import { browserAdapter } from '../adapters/browser_adapter';

export const App: React.FC = () => {
  // Settings State
  const [settings, setSettings] = useState<LocalVoiceSettings>({
    backendUrl: DEFAULT_BACKEND_URL,
    selectedVoiceId: 'en_US-lessac-medium',
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
  const [voices, setVoices] = useState<VoiceMetadata[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  // Engine Ref
  const engineRef = useRef<ReadingEngine | null>(null);

  // 1. Initialize Settings and Engine on Mount
  useEffect(() => {
    browserAdapter.getStorage<LocalVoiceSettings>(STORAGE_KEYS.SETTINGS).then((saved) => {
      if (saved) setSettings(saved);
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
    fetchVoices();

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
      } else {
        setHealth(null);
      }
    } catch {
      setHealth(null);
    }
  };

  const fetchVoices = async () => {
    try {
      const res = await fetch(`${settings.backendUrl}/api/v1/voices`);
      if (res.ok) {
        const data = await res.json();
        setVoices(data.voices || []);
        if (data.voices?.length > 0 && !settings.selectedVoiceId) {
          setSettings((s) => ({ ...s, selectedVoiceId: data.voices[0].voice_id }));
        }
      }
    } catch (e) {
      console.warn('Could not fetch voices:', e);
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
      const result: any = await browserAdapter.sendMessageToTab(tab.id, { type: 'EXTRACT_PAGE' });
      if (result?.error) {
        setErrorMessage(result.error);
        setReadingState('IDLE');
        return;
      }
      if (!result || !result.blocks || result.blocks.length === 0) {
        setErrorMessage('No readable paragraphs or text blocks found on this page.');
        setReadingState('IDLE');
        return;
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
      const result: any = await browserAdapter.sendMessageToTab(tab.id, { type: 'EXTRACT_SELECTION' });
      if (result?.error) {
        setErrorMessage(result.error);
        setReadingState('IDLE');
        return;
      }
      if (!result || !result.blocks || result.blocks.length === 0) {
        setErrorMessage('No text currently selected. Highlight some text on the webpage first.');
        setReadingState('IDLE');
        return;
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
    } else if (readingState === 'READY' || readingState === 'COMPLETED') {
      await engineRef.current?.startReading(currentIndex);
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

  const handleVoiceSelect = (voiceId: string) => {
    setSettings((s) => ({ ...s, selectedVoiceId: voiceId }));
  };

  const handleTestVoice = async (voiceId: string) => {
    try {
      const res = await fetch(`${settings.backendUrl}/api/v1/voices/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId })
      });
      if (!res.ok) throw new Error('Voice test generation failed');
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.playbackRate = settings.playbackSpeed;
      await audio.play();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not test voice');
    }
  };

  const handleClearCache = async () => {
    await fetch(`${settings.backendUrl}/api/v1/cache/clear`, { method: 'POST' });
  };

  return (
    <div className="panel-container">
      <Header
        health={health}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
      />

      {errorMessage && (
        <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--danger)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{errorMessage}</span>
          <button style={{ color: 'var(--text-secondary)', fontWeight: 600 }} onClick={() => setErrorMessage(null)}>✕</button>
        </div>
      )}

      <PageInfo pageTitle={pageTitle} blocks={blocks} />

      <PlaybackInfo
        state={readingState}
        currentIndex={currentIndex}
        totalBlocks={blocks.length}
        currentBlock={currentBlock}
      />

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

      <VoiceSelector
        voices={voices}
        selectedVoiceId={settings.selectedVoiceId}
        onSelectVoice={handleVoiceSelect}
        onTestVoice={handleTestVoice}
      />

      <SettingsModal
        settings={settings}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => setSettings(s)}
        onClearCache={handleClearCache}
      />

      <DiagnosticsModal
        isOpen={diagnosticsOpen}
        backendUrl={settings.backendUrl}
        onClose={() => setDiagnosticsOpen(false)}
      />
    </div>
  );
};

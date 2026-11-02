import React from 'react';
import { Volume2, Settings as SettingsIcon, Activity, PanelRight, GitCompare } from 'lucide-react';
import { BackendHealth, TTSEngineType } from '../../shared/types';

interface HeaderProps {
  health: BackendHealth | null;
  activeEngine: TTSEngineType;
  onSelectEngine: (engine: TTSEngineType) => void;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
  onOpenComparison: () => void;
  disabled?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  activeEngine,
  onSelectEngine,
  onOpenSettings,
  onOpenDiagnostics,
  onOpenComparison,
  disabled = false,
}) => {
  const isOnline = health?.status === 'healthy';

  const handleOpenSidePanel = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ backgroundColor: 'var(--primary)', color: '#fff', padding: '4px', borderRadius: '6px', display: 'flex' }}>
            <Volume2 size={14} />
          </div>
          <div>
            <h1 style={{ fontSize: '13px', fontWeight: 600, margin: 0, lineHeight: 1.2 }}>LocalVoice</h1>
            <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>Dual TTS • 100% Local CPU</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <div className="status-badge" title={isOnline ? 'Local backend connected' : 'Backend offline'}>
            <div className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
            <span>{isOnline ? 'Ready' : 'Offline'}</span>
          </div>

          <button className="icon-btn" onClick={onOpenComparison} title="Compare Piper & Kokoro Side-by-Side">
            <GitCompare size={13} />
          </button>

          <button className="icon-btn" onClick={handleOpenSidePanel} title="Dock to Side Panel">
            <PanelRight size={13} />
          </button>

          <button className="icon-btn" onClick={onOpenDiagnostics} title="Extraction & System Diagnostics">
            <Activity size={13} />
          </button>

          <button className="icon-btn" onClick={onOpenSettings} title="Settings">
            <SettingsIcon size={13} />
          </button>
        </div>
      </div>

      {/* Dual Engine Switcher Segmented Control */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', backgroundColor: 'var(--bg-secondary)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
        <button
          onClick={() => onSelectEngine('piper')}
          disabled={disabled}
          style={{
            padding: '3px 8px',
            fontSize: '10.5px',
            fontWeight: activeEngine === 'piper' ? 600 : 500,
            borderRadius: '4px',
            border: 'none',
            backgroundColor: activeEngine === 'piper' ? 'var(--card-bg)' : 'transparent',
            color: activeEngine === 'piper' ? 'var(--primary)' : 'var(--text-secondary)',
            boxShadow: activeEngine === 'piper' ? 'var(--shadow-sm)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          title="Piper: Ultra-fast real-time speech (0.2x RTF)"
        >
          ⚡ Piper TTS
        </button>
        <button
          onClick={() => onSelectEngine('kokoro')}
          disabled={disabled}
          style={{
            padding: '3px 8px',
            fontSize: '10.5px',
            fontWeight: activeEngine === 'kokoro' ? 600 : 500,
            borderRadius: '4px',
            border: 'none',
            backgroundColor: activeEngine === 'kokoro' ? 'var(--card-bg)' : 'transparent',
            color: activeEngine === 'kokoro' ? 'var(--accent)' : 'var(--text-secondary)',
            boxShadow: activeEngine === 'kokoro' ? 'var(--shadow-sm)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          title="Kokoro: High-fidelity 82M neural model (54 voices)"
        >
          ✨ Kokoro (82M)
        </button>
      </div>
    </div>
  );
};

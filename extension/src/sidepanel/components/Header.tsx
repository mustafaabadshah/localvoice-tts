import React from 'react';
import { Volume2, Settings as SettingsIcon, Activity, PanelRight } from 'lucide-react';
import { BackendHealth } from '../../shared/types';

interface HeaderProps {
  health: BackendHealth | null;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
}

export const Header: React.FC<HeaderProps> = ({ health, onOpenSettings, onOpenDiagnostics }) => {
  const isOnline = health?.status === 'healthy';

  const handleOpenSidePanel = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ backgroundColor: 'var(--primary)', color: '#fff', padding: '4px', borderRadius: '6px', display: 'flex' }}>
          <Volume2 size={15} />
        </div>
        <div>
          <h1 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>LocalVoice</h1>
          <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>Piper TTS • Local CPU</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <div className="status-badge" title={isOnline ? 'Local backend connected' : 'Backend offline'}>
          <div className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
          <span>{isOnline ? 'Ready' : 'Offline'}</span>
        </div>

        <button className="icon-btn" onClick={handleOpenSidePanel} title="Dock to Side Panel">
          <PanelRight size={14} />
        </button>

        <button className="icon-btn" onClick={onOpenDiagnostics} title="Diagnostics">
          <Activity size={14} />
        </button>

        <button className="icon-btn" onClick={onOpenSettings} title="Settings">
          <SettingsIcon size={14} />
        </button>
      </div>
    </div>
  );
};

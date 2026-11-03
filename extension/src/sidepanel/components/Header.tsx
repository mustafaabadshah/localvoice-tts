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
    <div className="header">
      <div className="spread">
        <div className="row">
          <div className="brand-mark">
            <Volume2 size={13} />
          </div>
          <h1>LocalVoice</h1>
        </div>

        <div className="row" style={{ gap: '2px' }}>
          {isOnline ? (
            <div className="status-dot online" role="img" aria-label="Backend connected" title="Backend connected" />
          ) : (
            <div className="status-badge" title="Backend not reachable">
              <div className="status-dot offline" />
              <span>Offline</span>
            </div>
          )}

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

      {/* Two engines, one choice. Names only: the cost of each is surfaced in context. */}
      <div className="segmented" role="tablist" aria-label="Speech engine">
        <button
          role="tab"
          aria-selected={activeEngine === 'piper'}
          data-active={activeEngine === 'piper'}
          onClick={() => onSelectEngine('piper')}
          title="Piper - synthesises faster than playback on CPU"
        >
          Piper
        </button>
        <button
          role="tab"
          aria-selected={activeEngine === 'kokoro'}
          data-active={activeEngine === 'kokoro'}
          onClick={() => onSelectEngine('kokoro')}
          title="Kokoro - 82M model, more natural, slower than real time on CPU"
        >
          Kokoro
        </button>
      </div>
    </div>
  );
};

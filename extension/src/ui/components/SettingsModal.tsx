import React, { useState } from 'react';
import { X, Trash2, Check } from 'lucide-react';
import { LocalVoiceSettings } from '../../shared/types';

interface SettingsModalProps {
  settings: LocalVoiceSettings;
  isOpen: boolean;
  onClose: () => void;
  onSave: (newSettings: LocalVoiceSettings) => void;
  onClearCache: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
  onClearCache
}) => {
  const [localSettings, setLocalSettings] = useState<LocalVoiceSettings>(settings);
  const [clearing, setClearing] = useState(false);
  const [cacheClearedMsg, setCacheClearedMsg] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClearCache();
      setCacheClearedMsg(true);
      setTimeout(() => setCacheClearedMsg(false), 2500);
    } finally {
      setClearing(false);
    }
  };

  // Settings contains settings. No sublabels explaining what a toggle does, no
  // privacy essay: the header badge already states connectivity and the README
  // states the privacy model once, for everyone.
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="spread" style={{ marginBottom: '12px' }}>
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            className="field"
            type="text"
            value={localSettings.backendUrl}
            onChange={(e) => setLocalSettings({ ...localSettings, backendUrl: e.target.value })}
            aria-label="Backend URL"
            title="Backend URL"
            spellCheck={false}
          />

          <div className="spread">
            <span style={{ fontSize: '11.5px' }}>Auto-scroll</span>
            <button
              className="switch"
              role="switch"
              aria-checked={localSettings.autoScroll}
              aria-label="Auto-scroll"
              data-on={localSettings.autoScroll}
              onClick={() => setLocalSettings({ ...localSettings, autoScroll: !localSettings.autoScroll })}
            />
          </div>

          <div className="spread">
            <span style={{ fontSize: '11.5px' }}>Highlight</span>
            <button
              className="switch"
              role="switch"
              aria-checked={localSettings.highlightEnabled}
              aria-label="Highlight the paragraph being read"
              data-on={localSettings.highlightEnabled}
              onClick={() => setLocalSettings({ ...localSettings, highlightEnabled: !localSettings.highlightEnabled })}
            />
          </div>

          <div className="spread">
            <span style={{ fontSize: '11.5px' }}>Auto-start backend</span>
            <button
              className="switch"
              role="switch"
              aria-checked={localSettings.autoStartBackend}
              aria-label="Start the backend automatically when a read needs it"
              data-on={localSettings.autoStartBackend}
              onClick={() => setLocalSettings({ ...localSettings, autoStartBackend: !localSettings.autoStartBackend })}
            />
          </div>

          <div className="divider" />

          <button
            className="btn-secondary"
            onClick={handleClear}
            disabled={clearing}
            style={{ width: '100%', gap: '5px' }}
          >
            {cacheClearedMsg ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Trash2 size={13} />}
            <span>{cacheClearedMsg ? 'Cache cleared' : 'Clear cache'}</span>
          </button>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

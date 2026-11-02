import React, { useState } from 'react';
import { X, Trash2, ShieldCheck, Check } from 'lucide-react';
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

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600 }}>LocalVoice Settings</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Backend URL */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Backend Server URL
            </label>
            <input
              type="text"
              value={localSettings.backendUrl}
              onChange={(e) => setLocalSettings({ ...localSettings, backendUrl: e.target.value })}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)'
              }}
            />
          </div>

          {/* Auto Scroll */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 500 }}>Auto-Scroll</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Scroll webpage smoothly to active block</div>
            </div>
            <input
              type="checkbox"
              checked={localSettings.autoScroll}
              onChange={(e) => setLocalSettings({ ...localSettings, autoScroll: e.target.checked })}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
          </div>

          {/* Highlighting */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 500 }}>DOM Highlighting</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Visually highlight paragraph being spoken</div>
            </div>
            <input
              type="checkbox"
              checked={localSettings.highlightEnabled}
              onChange={(e) => setLocalSettings({ ...localSettings, highlightEnabled: e.target.checked })}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
          </div>

          {/* Cache Management */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Audio Cache</div>
            <button
              className="btn-secondary"
              onClick={handleClear}
              disabled={clearing}
              style={{ width: '100%', fontSize: '11px', gap: '6px' }}
            >
              {cacheClearedMsg ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Trash2 size={14} />}
              <span>{cacheClearedMsg ? 'Cache Cleared!' : 'Clear Disk Audio Cache'}</span>
            </button>
          </div>

          {/* Privacy Guarantee */}
          <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '10px', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <ShieldCheck size={18} style={{ color: 'var(--success)', flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              <strong>100% Local & Private:</strong> Webpage text is never sent to the cloud, third-party APIs, or external servers. All speech is generated on your CPU by Piper.
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
};

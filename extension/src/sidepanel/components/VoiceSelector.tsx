import React, { useState, useMemo, useEffect } from 'react';
import { PlayCircle, Loader2 } from 'lucide-react';
import { VoiceMetadata } from '../../shared/types';

interface VoiceSelectorProps {
  voices: VoiceMetadata[];
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  onTestVoice: (voiceId: string) => Promise<void>;
  disabled?: boolean;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onTestVoice,
  disabled = false,
}) => {
  const [testing, setTesting] = useState(false);

  const languages = useMemo(() => {
    const map = new Map<string, string>();
    voices.forEach((v) => {
      map.set(v.language_code, v.language_name);
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [voices]);

  const activeVoice = voices.find((v) => v.voice_id === selectedVoiceId) || voices[0];
  const [selectedLang, setSelectedLang] = useState<string>(activeVoice?.language_code || 'en_US');

  // Sync the language picker with the active voice whenever the voice list changes
  // (switching engines swaps the whole list, so `voices` is the only trigger needed).
  useEffect(() => {
    if (activeVoice) {
      setSelectedLang(activeVoice.language_code);
    } else if (voices.length > 0) {
      setSelectedLang(voices[0].language_code);
      onSelectVoice(voices[0].voice_id);
    }
  }, [voices]);

  const filteredVoices = useMemo(() => {
    return voices.filter((v) => v.language_code === selectedLang || v.language_code.startsWith(selectedLang.split('_')[0]));
  }, [voices, selectedLang]);

  const handleTest = async () => {
    if (!activeVoice) return;
    setTesting(true);
    try {
      await onTestVoice(activeVoice.voice_id);
    } finally {
      setTesting(false);
    }
  };

  // One row, no section header, no "N available" count. A dropdown only exists when
  // there is a choice to make: with a single installed voice the name is a fact, so
  // it renders as text instead of a dead one-option control.
  const showLanguage = languages.length > 1;
  const showVoicePicker = filteredVoices.length > 1;

  return (
    <div className="row" style={{ gap: '6px' }}>
      {showLanguage && (
        <select
          className="select"
          value={selectedLang}
          disabled={disabled}
          onChange={(e) => {
            setSelectedLang(e.target.value);
            const firstInLang = voices.find((v) => v.language_code === e.target.value);
            if (firstInLang) onSelectVoice(firstInLang.voice_id);
          }}
          aria-label="Language"
          title="Language"
          style={{ flex: '0 0 44%' }}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      )}

      {showVoicePicker ? (
        <select
          className="select"
          value={activeVoice?.voice_id || ''}
          disabled={disabled}
          onChange={(e) => onSelectVoice(e.target.value)}
          aria-label="Voice"
          title="Voice"
        >
          {filteredVoices.map((v) => (
            <option key={v.voice_id} value={v.voice_id}>
              {v.speaker_name}
            </option>
          ))}
        </select>
      ) : (
        <span
          title={activeVoice?.speaker_name}
          style={{
            flex: 1,
            fontSize: '11px',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {activeVoice?.speaker_name || '—'}
        </span>
      )}

      <button
        className="icon-btn"
        onClick={handleTest}
        disabled={disabled || testing || !activeVoice}
        title="Preview voice"
        aria-label="Preview voice"
      >
        {testing ? <Loader2 size={13} className="spin" /> : <PlayCircle size={13} />}
      </button>
    </div>
  );
};

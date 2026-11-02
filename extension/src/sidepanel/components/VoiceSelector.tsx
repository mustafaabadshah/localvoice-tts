import React, { useState, useMemo, useEffect } from 'react';
import { Volume2, PlayCircle, Loader2 } from 'lucide-react';
import { VoiceMetadata, TTSEngineType } from '../../shared/types';

interface VoiceSelectorProps {
  engine: TTSEngineType;
  voices: VoiceMetadata[];
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  onTestVoice: (voiceId: string) => Promise<void>;
  disabled?: boolean;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  engine,
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

  // When engine or voices change, sync language
  useEffect(() => {
    if (activeVoice) {
      setSelectedLang(activeVoice.language_code);
    } else if (voices.length > 0) {
      setSelectedLang(voices[0].language_code);
      onSelectVoice(voices[0].voice_id);
    }
  }, [engine, voices]);

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

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '6px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          <Volume2 size={12} />
          <span style={{ textTransform: 'uppercase' }}>
            {engine === 'kokoro' ? 'Kokoro Voice (82M)' : 'Piper Voice'}
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>({voices.length} available)</span>
        </div>
        <button
          className="btn-secondary"
          onClick={handleTest}
          disabled={disabled || testing || !activeVoice}
          style={{ padding: '2px 6px', fontSize: '10px', gap: '3px' }}
          title={`Test preview for ${activeVoice?.speaker_name || 'voice'}`}
        >
          {testing ? <Loader2 size={10} className="spin" /> : <PlayCircle size={10} />}
          <span>Test</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <div>
          <select
            value={selectedLang}
            disabled={disabled || languages.length === 0}
            onChange={(e) => {
              setSelectedLang(e.target.value);
              const firstInLang = voices.find((v) => v.language_code === e.target.value);
              if (firstInLang) onSelectVoice(firstInLang.voice_id);
            }}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 4px',
              fontSize: '10.5px'
            }}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={activeVoice?.voice_id || ''}
            disabled={disabled || filteredVoices.length === 0}
            onChange={(e) => onSelectVoice(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 4px',
              fontSize: '10.5px'
            }}
          >
            {filteredVoices.map((v) => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.speaker_name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

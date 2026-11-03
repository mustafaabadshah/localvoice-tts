import React, { useState } from 'react';
import { X, Play, Pause, Loader2, GitCompare, ThumbsUp, Sparkles, Zap, Activity } from 'lucide-react';
import { VoiceMetadata, EngineComparisonResult } from '../../shared/types';
import { describeBackendError } from '../../shared/errors';

interface ComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  backendUrl: string;
  defaultText: string;
  piperVoices: VoiceMetadata[];
  kokoroVoices: VoiceMetadata[];
  selectedPiperVoiceId: string;
  selectedKokoroVoiceId: string;
}

export const ComparisonModal: React.FC<ComparisonModalProps> = ({
  isOpen,
  onClose,
  backendUrl,
  defaultText,
  piperVoices,
  kokoroVoices,
  selectedPiperVoiceId,
  selectedKokoroVoiceId,
}) => {
  const [testText, setTestText] = useState(
    defaultText || 'In an era dominated by edge computing, running neural networks locally on commodity laptops marks a major transition toward digital sovereignty.'
  );
  const [piperVoice, setPiperVoice] = useState(selectedPiperVoiceId || piperVoices[0]?.voice_id || 'en_US-lessac-medium');
  const [kokoroVoice, setKokoroVoice] = useState(selectedKokoroVoiceId || kokoroVoices[0]?.voice_id || 'af_heart');
  const [speed, setSpeed] = useState(1.0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<EngineComparisonResult | null>(null);

  // Audio elements
  const [playingEngine, setPlayingEngine] = useState<'piper' | 'kokoro' | null>(null);
  const [audioObj, setAudioObj] = useState<HTMLAudioElement | null>(null);

  // Subjective feedback
  const [preference, setPreference] = useState<'piper' | 'kokoro' | 'equal' | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);

  if (!isOpen) return null;

  const handleRunComparison = async () => {
    setLoading(true);
    setError(null);
    if (audioObj) {
      audioObj.pause();
      setAudioObj(null);
      setPlayingEngine(null);
    }

    try {
      const resp = await fetch(`${backendUrl}/api/v1/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          piper_voice_id: piperVoice,
          kokoro_voice_id: kokoroVoice,
          speed: speed
        })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ detail: 'Comparison request failed' }));
        throw new Error(errData.detail || `Server returned ${resp.status}`);
      }

      const data: EngineComparisonResult = await resp.json();
      setComparison(data);
    } catch (err: any) {
      setError(describeBackendError(err, backendUrl));
    } finally {
      setLoading(false);
    }
  };

  const playAudio = (engine: 'piper' | 'kokoro') => {
    if (!comparison) return;
    const urlPath = engine === 'piper' ? comparison.piper.audio_url : comparison.kokoro.audio_url;
    if (!urlPath) return;

    if (playingEngine === engine && audioObj) {
      audioObj.pause();
      setPlayingEngine(null);
      return;
    }

    if (audioObj) {
      audioObj.pause();
    }

    const fullUrl = `${backendUrl}${urlPath}`;
    const newAudio = new Audio(fullUrl);
    newAudio.onended = () => setPlayingEngine(null);
    newAudio.onerror = () => setPlayingEngine(null);
    newAudio.play();
    setAudioObj(newAudio);
    setPlayingEngine(engine);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxHeight: '90vh', overflowY: 'auto', width: '92%', maxWidth: '370px', padding: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <GitCompare size={15} style={{ color: 'var(--primary)' }} />
            <h2 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>Engine Benchmark</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '6px 8px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '10.5px', marginBottom: '8px' }}>
            {error}
          </div>
        )}

        {/* Input Text Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
          <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            EVALUATION TEXT:
          </label>
          <textarea
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            rows={2}
            style={{
              width: '100%',
              fontSize: '10px',
              lineHeight: 1.3,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              padding: '4px 6px',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Voice Selection Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
          <div>
            <label style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--primary)', display: 'block', marginBottom: '2px' }}>
              ⚡ Piper Voice:
            </label>
            <select
              value={piperVoice}
              onChange={(e) => setPiperVoice(e.target.value)}
              style={{ width: '100%', fontSize: '10px', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            >
              {piperVoices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.speaker_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--accent)', display: 'block', marginBottom: '2px' }}>
              ✨ Kokoro Voice:
            </label>
            <select
              value={kokoroVoice}
              onChange={(e) => setKokoroVoice(e.target.value)}
              style={{ width: '100%', fontSize: '10px', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            >
              {kokoroVoices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.speaker_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Execute Button */}
        <button
          className="btn-primary"
          onClick={handleRunComparison}
          disabled={loading || !testText.trim()}
          style={{ width: '100%', padding: '5px', fontSize: '11px', marginBottom: '10px', gap: '5px' }}
        >
          {loading ? <Loader2 size={12} className="spin" /> : <GitCompare size={12} />}
          <span>{loading ? 'Evaluating Sequentially (CPU)...' : 'Run Side-by-Side Benchmark'}</span>
        </button>

        {/* Results Cards */}
        {comparison && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Piper Card */}
            <div className="card" style={{ padding: '8px', borderLeft: '3px solid var(--primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Zap size={11} /> Piper TTS
                </span>
                <button
                  className="btn-secondary"
                  onClick={() => playAudio('piper')}
                  style={{ padding: '2px 8px', fontSize: '10px', gap: '4px' }}
                >
                  {playingEngine === 'piper' ? <Pause size={10} /> : <Play size={10} />}
                  <span>{playingEngine === 'piper' ? 'Pause' : 'Play'}</span>
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
                <div>Latency: <strong>{comparison.piper.synthesis_time_seconds}s</strong></div>
                <div>Duration: <strong>{comparison.piper.audio_duration_seconds}s</strong></div>
                <div>RTF: <strong>{comparison.piper.real_time_factor}x</strong></div>
                <div>Peak RAM: <strong>{comparison.piper.peak_memory_mb} MB</strong></div>
              </div>
            </div>

            {/* Kokoro Card */}
            <div className="card" style={{ padding: '8px', borderLeft: '3px solid var(--accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Sparkles size={11} /> Kokoro (82M)
                </span>
                {comparison.kokoro.status === 'success' ? (
                  <button
                    className="btn-secondary"
                    onClick={() => playAudio('kokoro')}
                    style={{ padding: '2px 8px', fontSize: '10px', gap: '4px' }}
                  >
                    {playingEngine === 'kokoro' ? <Pause size={10} /> : <Play size={10} />}
                    <span>{playingEngine === 'kokoro' ? 'Pause' : 'Play'}</span>
                  </button>
                ) : (
                  <span style={{ fontSize: '9px', color: 'var(--danger)' }}>Unavailable</span>
                )}
              </div>

              {comparison.kokoro.status === 'success' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
                  <div>Latency: <strong>{comparison.kokoro.synthesis_time_seconds}s</strong></div>
                  <div>Duration: <strong>{comparison.kokoro.audio_duration_seconds}s</strong></div>
                  <div>RTF: <strong>{comparison.kokoro.real_time_factor}x</strong></div>
                  <div>Peak RAM: <strong>{comparison.kokoro.peak_memory_mb} MB</strong></div>
                </div>
              ) : (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{comparison.kokoro.error}</div>
              )}
            </div>

            {/* Subjective Preference Rating */}
            <div className="card" style={{ padding: '6px 8px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                WHICH VOICE DID YOU PREFER?
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  className="btn-secondary"
                  onClick={() => { setPreference('piper'); setSavedFeedback(true); }}
                  style={{ flex: 1, padding: '2px 4px', fontSize: '9.5px', backgroundColor: preference === 'piper' ? 'var(--primary-light)' : undefined, color: preference === 'piper' ? 'var(--primary)' : undefined }}
                >
                  Piper
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => { setPreference('kokoro'); setSavedFeedback(true); }}
                  style={{ flex: 1, padding: '2px 4px', fontSize: '9.5px', backgroundColor: preference === 'kokoro' ? 'rgba(234, 179, 8, 0.2)' : undefined, color: preference === 'kokoro' ? 'var(--accent)' : undefined }}
                >
                  Kokoro
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => { setPreference('equal'); setSavedFeedback(true); }}
                  style={{ flex: 1, padding: '2px 4px', fontSize: '9.5px', backgroundColor: preference === 'equal' ? 'var(--bg-secondary)' : undefined }}
                >
                  Tie
                </button>
              </div>
              {savedFeedback && (
                <div style={{ fontSize: '9px', color: 'var(--success)', marginTop: '3px', textAlign: 'center' }}>
                  ✓ Feedback recorded for this session!
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button className="btn-secondary" onClick={onClose} style={{ fontSize: '10.5px', padding: '3px 8px' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

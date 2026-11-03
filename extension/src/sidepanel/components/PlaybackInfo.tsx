import React from 'react';
import { ReadingState, TextBlock } from '../../shared/types';
import { estimateSynthSeconds, formatDuration } from '../../shared/enginePerf';

interface PlaybackInfoProps {
  state: ReadingState;
  currentIndex: number;
  totalBlocks: number;
  currentBlock: TextBlock | null;
  activeEngine?: 'piper' | 'kokoro';
  onSwitchToPiper?: () => void;
}

export const PlaybackInfo: React.FC<PlaybackInfoProps> = ({
  state,
  currentIndex,
  totalBlocks,
  currentBlock,
  activeEngine = 'piper',
  onSwitchToPiper
}) => {
  const currentNum = totalBlocks > 0 ? currentIndex + 1 : 0;
  const progressPct = totalBlocks > 0 ? Math.round((currentNum / totalBlocks) * 100) : 0;

  const getStatusLabel = () => {
    if (state === 'SYNTHESIZING') {
      if (activeEngine === 'kokoro') {
        // Kokoro runs at ~8.7x real time on this class of CPU, so the honest figure for
        // a full paragraph is minutes, not the "~15s" this panel used to promise.
        const eta = currentBlock ? formatDuration(estimateSynthSeconds('kokoro', currentBlock.text)) : null;
        return eta ? `Synthesizing Kokoro (~${eta})...` : 'Synthesizing Kokoro (slow)...';
      }
      const eta = currentBlock ? formatDuration(estimateSynthSeconds('piper', currentBlock.text)) : null;
      return eta ? `Synthesizing Piper (~${eta})...` : 'Synthesizing Piper (Fast)...';
    }

    switch (state) {
      case 'PLAYING': return 'Reading';
      case 'PAUSED': return 'Paused';
      case 'EXTRACTING': return 'Extracting...';
      case 'COMPLETED': return 'Completed';
      case 'READY': return 'Ready';
      default: return 'Idle';
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
          PARAGRAPH {currentNum} / {totalBlocks}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {state === 'SYNTHESIZING' && activeEngine === 'kokoro' && onSwitchToPiper && (
            <button
              onClick={onSwitchToPiper}
              style={{
                fontSize: '9px',
                padding: '1px 5px',
                borderRadius: '3px',
                backgroundColor: 'var(--primary)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              title="Cancel Kokoro and switch to high-speed Piper immediately"
            >
              ⚡ Fast Piper
            </button>
          )}
          <span style={{
            padding: '1px 6px',
            borderRadius: '3px',
            fontWeight: 600,
            fontSize: '9.5px',
            backgroundColor: state === 'PLAYING'
              ? 'var(--primary-light)'
              : state === 'SYNTHESIZING'
              ? 'rgba(245, 158, 11, 0.15)'
              : 'var(--bg-secondary)',
            color: state === 'PLAYING'
              ? 'var(--primary)'
              : state === 'SYNTHESIZING'
              ? 'var(--accent)'
              : 'var(--text-secondary)'
          }}>
            {getStatusLabel()}
          </span>
        </div>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {currentBlock ? (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 8px',
          fontSize: '11px',
          lineHeight: 1.4,
          color: 'var(--text-primary)',
          maxHeight: '55px',
          overflowY: 'auto',
          borderLeft: '3px solid var(--accent)'
        }}>
          {currentBlock.text}
        </div>
      ) : (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>
          Click "Read Page" or select text to read.
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { ReadingState, TextBlock } from '../../shared/types';

interface PlaybackInfoProps {
  state: ReadingState;
  currentIndex: number;
  totalBlocks: number;
  currentBlock: TextBlock | null;
}

export const PlaybackInfo: React.FC<PlaybackInfoProps> = ({
  state,
  currentIndex,
  totalBlocks,
  currentBlock
}) => {
  const currentNum = totalBlocks > 0 ? currentIndex + 1 : 0;
  const progressPct = totalBlocks > 0 ? Math.round((currentNum / totalBlocks) * 100) : 0;

  const getStatusLabel = () => {
    switch (state) {
      case 'SYNTHESIZING': return 'Synthesizing...';
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
        <span style={{
          padding: '1px 6px',
          borderRadius: '3px',
          fontWeight: 600,
          fontSize: '9.5px',
          backgroundColor: state === 'PLAYING' ? 'var(--primary-light)' : 'var(--bg-secondary)',
          color: state === 'PLAYING' ? 'var(--primary)' : 'var(--text-secondary)'
        }}>
          {getStatusLabel()}
        </span>
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

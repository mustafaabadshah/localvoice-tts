import React from 'react';
import { ReadingState, TextBlock } from '../../shared/types';
import { estimateSynthSeconds, formatDuration } from '../../shared/enginePerf';

interface PlaybackInfoProps {
  state: ReadingState;
  currentIndex: number;
  totalBlocks: number;
  currentBlock: TextBlock | null;
  activeEngine?: 'piper' | 'kokoro';
}

export const PlaybackInfo: React.FC<PlaybackInfoProps> = ({
  state,
  currentIndex,
  totalBlocks,
  currentBlock,
  activeEngine = 'piper'
}) => {
  const currentNum = totalBlocks > 0 ? currentIndex + 1 : 0;
  const progressPct = totalBlocks > 0 ? Math.round((currentNum / totalBlocks) * 100) : 0;

  // The engine is already the selected tab above, so the status owes the user one
  // thing only: the wait. Kokoro's ETA is minutes, not the "~15s" this panel once
  // promised, so it is stated as a duration and nothing else.
  const statusLabel = (): string | null => {
    switch (state) {
      case 'SYNTHESIZING': {
        const eta = currentBlock ? formatDuration(estimateSynthSeconds(activeEngine, currentBlock.text)) : null;
        return eta ? `Synthesizing ${eta}` : 'Synthesizing';
      }
      case 'PLAYING': return 'Reading';
      case 'PAUSED': return 'Paused';
      case 'EXTRACTING': return 'Extracting';
      case 'COMPLETED': return 'Done';
      case 'READY': return 'Ready';
      default: return null;
    }
  };

  const label = statusLabel();

  // Nothing read yet means nothing to show: the two action buttons below are the
  // entire empty state, so the old "Click Read Page or select text to read" line
  // and the duplicate "Fast Piper" escape hatch are both gone.
  if (state === 'IDLE' && totalBlocks === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div className="spread">
        <span className="meta" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {totalBlocks > 0 ? `${currentNum} / ${totalBlocks}` : ''}
        </span>
        {label && (
          <span className="chip" data-tone={state === 'PLAYING' ? 'active' : state === 'SYNTHESIZING' ? 'busy' : undefined}>
            {label}
          </span>
        )}
      </div>

      {totalBlocks > 0 && (
        <div
          className="progress-bar"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {currentBlock && <div className="paragraph">{currentBlock.text}</div>}
    </div>
  );
};

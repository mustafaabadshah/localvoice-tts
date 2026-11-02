import React from 'react';
import { Play, Pause, Square, SkipBack, SkipForward, BookOpen, MousePointer } from 'lucide-react';
import { ReadingState } from '../../shared/types';
import { PLAYBACK_SPEEDS } from '../../shared/constants';

interface ControlsProps {
  state: ReadingState;
  hasBlocks: boolean;
  speed: number;
  onReadPage: () => void;
  onReadSelection: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSpeedChange: (speed: number) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  state,
  hasBlocks,
  speed,
  onReadPage,
  onReadSelection,
  onPlayPause,
  onStop,
  onPrev,
  onNext,
  onSpeedChange
}) => {
  const isPlaying = state === 'PLAYING';
  const isPaused = state === 'PAUSED';
  const isSynthesizing = state === 'SYNTHESIZING';
  const isActive = isPlaying || isPaused || isSynthesizing;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Extract Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <button
          className="btn-primary"
          onClick={onReadPage}
          disabled={isActive}
          title="Extract and read the full webpage"
        >
          <BookOpen size={13} />
          <span>Read Page</span>
        </button>

        <button
          className="btn-secondary"
          onClick={onReadSelection}
          disabled={isActive}
          title="Read highlighted text on the page"
        >
          <MousePointer size={13} />
          <span>Read Selection</span>
        </button>
      </div>

      {/* Main Playback Controls */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="icon-btn"
            onClick={onPrev}
            disabled={!hasBlocks || !isActive}
            title="Previous paragraph"
          >
            <SkipBack size={15} />
          </button>

          <button
            style={{
              backgroundColor: isPlaying ? 'var(--accent)' : 'var(--primary)',
              color: '#fff',
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-sm)'
            }}
            onClick={onPlayPause}
            disabled={!hasBlocks && !isActive}
            title={isPlaying ? 'Pause' : 'Play / Resume'}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: '1px' }} />}
          </button>

          <button
            className="icon-btn"
            onClick={onNext}
            disabled={!hasBlocks || !isActive}
            title="Next paragraph"
          >
            <SkipForward size={15} />
          </button>

          <button
            className="icon-btn"
            onClick={onStop}
            disabled={!isActive && state !== 'READY'}
            title="Stop reading and clear highlights"
            style={{ color: isActive ? 'var(--danger)' : undefined }}
          >
            <Square size={13} />
          </button>
        </div>

        {/* Speed Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 500 }}>Speed:</span>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 4px',
              fontWeight: 500,
              fontSize: '10.5px'
            }}
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s.toFixed(2)}x
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

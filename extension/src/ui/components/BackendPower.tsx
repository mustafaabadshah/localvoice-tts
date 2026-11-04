import React from 'react';
import { Power } from 'lucide-react';
import { ControllerStatus } from '../../shared/types';

interface BackendPowerProps {
  /** Controller status, or null when nothing answers on 127.0.0.1:8766. */
  status: ControllerStatus | null;
  /** Health of the backend itself: the controller can be up while the engine is not. */
  backendReachable: boolean | null;
  backendUrl: string;
  busy: boolean;
  onToggle: () => void;
}

/** 300 -> "5 min", 900 -> "15 min". Idle stop is off only when the controller was started with 0. */
function formatIdle(seconds: number): string {
  if (seconds <= 0) return 'no auto-off';
  if (seconds < 90) return `auto-off ${seconds}s`;
  return `auto-off ${Math.round(seconds / 60)} min`;
}

/**
 * The one row that owns the backend's power state.
 *
 * It replaces the old offline banner instead of sitting next to it: both answer the same
 * question, and a popup cannot afford two rows saying "the backend is down". When the
 * controller is missing the row stops offering a toggle and names the script that installs
 * it, because a disabled button with no reason is a dead end.
 */
export const BackendPower: React.FC<BackendPowerProps> = ({
  status,
  backendReachable,
  backendUrl,
  busy,
  onToggle
}) => {
  const on = Boolean(status && status.backend === 'running') || backendReachable === true;
  // `busy && !on` is the power button's own warm-up: /start blocks for the whole ONNX load,
  // and a row that still says "Backend off" for 25 s looks like a click that did nothing.
  const starting = status?.backend === 'starting' || (busy && !on);
  const host = backendUrl.replace(/^https?:\/\//, '');

  const hint = !status
    ? '.\\scripts\\controller.ps1'
    : starting
      ? 'starting...'
      : on
        ? formatIdle(status.idle_seconds)
        : 'stopped';

  return (
    <div className="banner" data-tone={on ? undefined : 'danger'}>
      <span className={`status-dot ${on ? 'online' : 'offline'}`} />
      <span
        style={{
          fontSize: '10.5px',
          fontWeight: 600,
          color: on ? 'var(--text-primary)' : 'var(--danger)'
        }}
      >
        {starting ? 'Backend warm-up' : on ? 'Backend on' : 'Backend off'}
      </span>
      <span className="meta mono">{host}</span>
      <span className="meta mono" style={{ marginLeft: 'auto' }} title={status ? undefined : 'Install the controller to start and stop the backend from here'}>
        {hint}
      </span>
      <button
        className="icon-btn"
        onClick={onToggle}
        disabled={!status || busy || starting}
        title={!status ? 'No controller on 127.0.0.1:8766' : on ? 'Unload the backend' : 'Start the backend'}
        aria-label={on ? 'Stop the backend' : 'Start the backend'}
      >
        <Power size={12} />
      </button>
    </div>
  );
};

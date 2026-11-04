import { ControllerStatus } from './types';

/**
 * Client for the backend controller (127.0.0.1:8766).
 *
 * Every function returns `null` instead of throwing when the controller is not installed:
 * that is the common case on a fresh clone, and it must degrade to the old behaviour
 * ("start the backend yourself") rather than take the panel down with an exception.
 */
export const CONTROLLER_TIMEOUTS = {
  /** /status is polled every few seconds and must never stall the popup. */
  status: 4000,
  /** /start blocks until /api/v1/health answers - Piper's ONNX load alone is ~15 s. */
  start: 150000,
  stop: 30000,
  touch: 5000
} as const;

async function request(
  controllerUrl: string,
  path: string,
  timeoutMs: number
): Promise<ControllerStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${controllerUrl}${path}`, {
      method: 'POST',
      signal: controller.signal,
      // No body and no Content-Type: a "simple" request, so no CORS preflight round trip.
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return (await response.json()) as ControllerStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** What the power row renders. `null` means "no controller installed". */
export async function readControllerStatus(controllerUrl: string): Promise<ControllerStatus | null> {
  return request(controllerUrl, '/status', CONTROLLER_TIMEOUTS.status);
}

/** Starts the backend if it is not already up, and waits for it to answer health checks. */
export async function startBackend(controllerUrl: string): Promise<ControllerStatus | null> {
  return request(controllerUrl, '/start', CONTROLLER_TIMEOUTS.start);
}

/** Unloads the backend. The controller keeps listening, so the next read can start it again. */
export async function stopBackend(controllerUrl: string): Promise<ControllerStatus | null> {
  return request(controllerUrl, '/stop', CONTROLLER_TIMEOUTS.stop);
}

/**
 * "Still using it" - resets the controller's idle timer.
 *
 * Sent by the offscreen player while audio runs, because the popup that started the read is
 * usually closed long before the read is: without this the backend would idle out
 * mid-chapter.
 */
export async function touchBackendActivity(controllerUrl: string): Promise<void> {
  await request(controllerUrl, '/touch', CONTROLLER_TIMEOUTS.touch);
}

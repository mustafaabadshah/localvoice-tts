/**
 * Chrome reports a network-level failure as a bare `TypeError: Failed to fetch`.
 *
 * Exported because it is the trigger for the controller hand-off too: "unreachable" is
 * exactly the case where starting the backend is worth trying before failing the read.
 */
export function isBackendUnreachable(err: unknown): boolean {
  const message = (err as { message?: string } | null | undefined)?.message ?? '';
  return (
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(message)
  );
}

/**
 * Translate that failure into an actionable hint before it reaches the user.
 */
export function describeBackendError(err: unknown, backendUrl: string): string {
  if (isBackendUnreachable(err)) {
    return `Cannot reach the LocalVoice backend at ${backendUrl}. Start it with .\\scripts\\start.ps1, or install the controller (.\\scripts\\controller.ps1) so it starts on demand.`;
  }
  return (err as { message?: string } | null | undefined)?.message || 'Speech generation failed';
}


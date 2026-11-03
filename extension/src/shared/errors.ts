/**
 * Chrome reports a network-level failure as a bare `TypeError: Failed to fetch`.
 * That string is meaningless in the UI, so translate it into an actionable hint
 * before it reaches the user.
 */
export function describeBackendError(err: unknown, backendUrl: string): string {
  const message = (err as { message?: string } | null | undefined)?.message ?? '';
  const isNetworkFailure =
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(message);

  if (isNetworkFailure) {
    return `Cannot reach the LocalVoice backend at ${backendUrl}. Start it with .\\scripts\\start.ps1, then try again.`;
  }
  return message || 'Speech generation failed';
}

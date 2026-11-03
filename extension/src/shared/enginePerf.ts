import { TextBlock, TTSEngineType } from './types';

/**
 * Empirical synthesis cost per engine, measured on the reference machine
 * (Intel Core i3-7100U, 2 physical cores, ONNX Runtime CPU EP) and recorded in
 * `docs/performance_report.md`.
 *
 * RTF (real-time factor) = synthesis seconds per second of generated audio.
 *   RTF <= 1  the engine outruns playback, so a one-block prefetch is enough to
 *             make paragraph hand-offs seamless.
 *   RTF >> 1  no amount of prefetching can hide the gap: the CPU is the floor and
 *             every paragraph boundary must stall for (RTF - 1) x audio length.
 *
 *   Piper  lessac-medium : 88 chars -> 4.49 s audio in  2.06 s -> RTF 0.20
 *   Kokoro af_heart int8 : 88 chars -> 4.40 s audio in 38.12 s -> RTF 8.66
 */
export const ENGINE_RTF: Record<TTSEngineType, number> = {
  piper: 0.2,
  kokoro: 8.66,
};

/** Both en_US voices articulate at ~19.8 characters per second (88 chars -> 4.45 s). */
export const CHARS_PER_AUDIO_SECOND = 19.8;

/** Generated audio length for a block, estimated from its character count. */
export function estimateAudioSeconds(text: string): number {
  return Math.max(0.3, text.length / CHARS_PER_AUDIO_SECOND);
}

/** CPU time the backend needs to synthesise a single block. */
export function estimateSynthSeconds(engine: TTSEngineType, text: string): number {
  return Math.max(0.2, estimateAudioSeconds(text) * ENGINE_RTF[engine]);
}

/**
 * True when the engine is slower than real time on this class of hardware, i.e.
 * gapless continuous reading is physically impossible and every block boundary stalls.
 */
export function isSlowerThanRealtime(engine: TTSEngineType): boolean {
  return ENGINE_RTF[engine] > 1;
}

/** Total synthesis time a whole page costs, ignoring cache hits. */
export function estimatePageSynthSeconds(engine: TTSEngineType, blocks: TextBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    total += estimateSynthSeconds(engine, block.text);
  }
  return total;
}

/** Human-readable duration: `0.8 s`, `38 s`, `3.6 min`, `1 h 52 min`. */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0 s';
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 90) return `${Math.round(seconds)} s`;

  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = Math.round(minutes - hours * 60);
  return `${hours} h ${String(restMinutes).padStart(2, '0')} min`;
}

export type BlockType = 'heading' | 'paragraph' | 'list_item';

export interface TextBlock {
  id: string;
  type: BlockType;
  text: string;
  order: number;
  tagName?: string;
}

export interface ExtractionDiagnostics {
  pageTitle: string;
  pageUrl: string;
  readyState: string;
  strategyUsed: string;
  totalBlocks: number;
  totalCharacters: number;
  totalWords: number;
  excludedCount: number;
  durationMs: number;
  previewBlocks: string[];
}

export interface ExtractionResult {
  pageTitle: string;
  pageUrl: string;
  blocks: TextBlock[];
  diagnostics?: ExtractionDiagnostics;
}

export type ReadingState =
  | 'IDLE'
  | 'EXTRACTING'
  | 'READY'
  | 'SYNTHESIZING'
  | 'PLAYING'
  | 'PAUSED'
  | 'STOPPING'
  | 'COMPLETED'
  | 'ERROR';

export type TTSEngineType = 'piper' | 'kokoro';

export interface EngineInfo {
  id: TTSEngineType;
  name: string;
  installed: boolean;
  ready: boolean;
  current_loaded_voice: string | null;
  device: string;
  runtime: string;
  sample_rate?: number;
  model_size_mb?: number;
  description?: string;
  is_active: boolean;
}

export interface VoiceMetadata {
  voice_id: string;
  engine: TTSEngineType;
  language_code: string;
  language_name: string;
  speaker_name: string;
  quality: string;
  sample_rate: number;
  num_speakers: number;
  model_size_mb: number;
  is_valid: boolean;
}

export interface BackendHealth {
  status: string;
  active_engine: TTSEngineType;
  piper_runtime: string;
  kokoro_runtime: string;
  cpu_execution: boolean;
  installed_voices_count: number;
  piper_installed_voices: number;
  kokoro_installed_voices: number;
  current_loaded_voice: string | null;
  version: string;
}

export interface BackendMetrics {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  average_latency_seconds: number;
  current_voice: string | null;
  cache_stats: {
    file_count: number;
    total_bytes: number;
    total_mb: number;
    max_bytes: number;
    max_mb: number;
    hits: number;
    misses: number;
    hit_rate_pct: number;
  };
}

export interface LocalVoiceSettings {
  backendUrl: string;
  selectedEngine: TTSEngineType;
  selectedPiperVoiceId: string;
  selectedKokoroVoiceId: string;
  playbackSpeed: number;
  autoScroll: boolean;
  highlightEnabled: boolean;
}

export interface EngineComparisonResult {
  session_id: string;
  text: string;
  word_count: number;
  character_count: number;
  speed: number;
  timestamp: number;
  piper: {
    engine: string;
    voice_id: string;
    audio_id?: string;
    audio_url?: string;
    synthesis_time_seconds?: number;
    audio_duration_seconds?: number;
    real_time_factor?: number;
    peak_memory_mb?: number;
    memory_delta_mb?: number;
    cache_hit: boolean;
    status: string;
    error?: string;
  };
  kokoro: {
    engine: string;
    voice_id: string;
    audio_id?: string;
    audio_url?: string;
    synthesis_time_seconds?: number;
    audio_duration_seconds?: number;
    real_time_factor?: number;
    peak_memory_mb?: number;
    memory_delta_mb?: number;
    cache_hit: boolean;
    status: string;
    error?: string;
  };
}

export type ExtensionMessage =
  | { type: 'EXTRACT_PAGE' }
  | { type: 'EXTRACT_SELECTION' }
  | { type: 'PAGE_EXTRACTED'; payload: ExtractionResult }
  | { type: 'HIGHLIGHT_BLOCK'; blockId: string; autoScroll: boolean }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | { type: 'PLAY_AUDIO'; audioUrl: string; blockId: string; speed: number }
  | { type: 'PAUSE_AUDIO' }
  | { type: 'RESUME_AUDIO' }
  | { type: 'STOP_AUDIO' }
  | { type: 'AUDIO_ENDED'; blockId: string }
  | { type: 'AUDIO_ERROR'; error: string; blockId: string }
  | { type: 'SET_AUDIO_SPEED'; speed: number };

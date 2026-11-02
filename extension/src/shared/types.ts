export type BlockType = 'heading' | 'paragraph' | 'list_item';

export interface TextBlock {
  id: string;
  type: BlockType;
  text: string;
  order: number;
  tagName?: string;
}

export interface ExtractionResult {
  pageTitle: string;
  pageUrl: string;
  blocks: TextBlock[];
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

export interface VoiceMetadata {
  voice_id: string;
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
  piper_runtime: string;
  cpu_execution: boolean;
  installed_voices_count: number;
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
  selectedVoiceId: string;
  playbackSpeed: number;
  autoScroll: boolean;
  highlightEnabled: boolean;
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

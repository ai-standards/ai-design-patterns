export interface StreamChunk {
  id: string;
  content: string;
  timestamp: Date;
  isComplete: boolean;
  metadata?: Record<string, any>;
}

export interface StreamResult {
  id: string;
  fullContent: string;
  chunks: StreamChunk[];
  startTime: Date;
  endTime?: Date;
  totalTokens: number;
  status: 'streaming' | 'completed' | 'error';
}

export interface StreamOptions {
  chunkDelayMs?: number;
  maxChunkSize?: number;
  onChunk?: (chunk: StreamChunk) => void;
  onComplete?: (result: StreamResult) => void;
  onError?: (error: Error) => void;
}

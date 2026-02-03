
export enum Role {
  USER = 'user',
  NEXUS = 'nexus'
}

export type Modality = 'STRATEGIC' | 'TACTICAL' | 'CREATIVE' | 'RISK';
export type ModelID = 'gemini-3-flash-preview' | 'gemini-3-pro-preview' | 'gemini-2.5-flash-lite-latest';

export interface FileData {
  mimeType: string;
  data: string; // base64
  fileName: string;
}

export interface UIComponent {
  type: 'CHART_SUGGESTION' | 'IMAGE_PROJECTION' | 'AUDIO_BRIEFING' | 'ANALYTICS_DASHBOARD' | 'UNKNOWN';
  content: string;
  url?: string;
  chartData?: any[]; // For Holographic Data
}

export interface RagChunk {
  id: string;
  text: string;
  embedding: number[];
  sourceName: string;
}

export interface RagDocument {
  id: string;
  name: string;
  timestamp: number;
  chunkCount: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  executiveSummary?: string;
  actionItems?: string[];
  uiComponents?: UIComponent[];
  sources?: Array<{ title: string; uri: string }>;
  groundedChunks?: string[]; // References to retrieved context
  thinkingBudget?: number;
  attachments?: FileData[];
  isFromCache?: boolean;
  isSystemError?: boolean;
  isThinking?: boolean; // Cognitive Trace
  isPinned?: boolean;   // Context Pinning
}

export interface AppState {
  messages: Message[];
  isBooting: boolean;
  isProcessing: boolean;
  systemStatus: 'IDLE' | 'ANALYZING' | 'CONSULTING' | 'SYNTHESIZING';
  modality: Modality;
  selectedModel: ModelID;
  thinkingBudget: number;
}

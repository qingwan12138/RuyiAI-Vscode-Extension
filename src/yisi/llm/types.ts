export interface ModelCapabilities {
  toolCalling: boolean;
  streaming: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  maxContextTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
}

export interface ChatDelta {
  text: string;
}

export interface LLMProvider {
  readonly id: string;
  listModels(signal?: AbortSignal): Promise<string[]>;
  capabilities(model: string): Promise<ModelCapabilities>;
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta>;
}

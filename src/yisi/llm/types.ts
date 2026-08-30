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

export interface LLMProvider {
  readonly id: string;
  listModels(): Promise<string[]>;
  capabilities(model: string): Promise<ModelCapabilities>;
  chat(request: ChatRequest, signal?: AbortSignal): Promise<string>;
}

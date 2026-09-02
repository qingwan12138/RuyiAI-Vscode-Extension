import { ReasoningPreset } from '../domain/session';

export interface ModelCapabilities {
  toolCalling: boolean;
  streaming: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  maxContextTokens?: number;
}

// Optional sampling overrides carried from the session model state to the
// provider adapter. Adapters translate the unified preset into wire-specific
// parameters and only send fields their capability profile supports.
export interface RequestSampling {
  temperature?: number;
  maxTokens?: number;
  reasoningPreset?: ReasoningPreset;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatRequest extends RequestSampling {
  model: string;
  messages: ChatMessage[];
}

export interface ChatDelta {
  text: string;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AgentConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AgentRequest extends RequestSampling {
  model: string;
  messages: AgentConversationMessage[];
  tools: AgentToolDefinition[];
}

export type AgentStreamEvent =
  | { type: 'textDelta'; text: string }
  | { type: 'toolCall'; call: AgentToolCall };

export interface LLMProvider {
  readonly id: string;
  listModels(signal?: AbortSignal): Promise<string[]>;
  capabilities(model: string): Promise<ModelCapabilities>;
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta>;
  streamAgent?(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentStreamEvent>;
  testConnection?(signal?: AbortSignal): Promise<void>;
}

export function parseAgentToolDefinition(value: unknown): AgentToolDefinition {
  if (!isExactRecord(value, ['name', 'description', 'parameters'])) {
    throw new Error('Invalid agent tool definition.');
  }
  const name = normalizeText(value.name, 256);
  const description = normalizeText(value.description, 4_096);
  if (!name || !description || !isRecord(value.parameters)) {
    throw new Error('Invalid agent tool definition.');
  }
  try {
    return { name, description, parameters: structuredClone(value.parameters) };
  } catch {
    throw new Error('Invalid agent tool definition.');
  }
}

export function parseAgentToolCall(value: unknown): AgentToolCall {
  if (!isExactRecord(value, ['id', 'name', 'input'])) {
    throw new Error('Invalid agent tool call.');
  }
  const id = normalizeText(value.id, 256);
  const name = normalizeText(value.name, 256);
  if (!id || !name || !isRecord(value.input)) {
    throw new Error('Invalid agent tool call.');
  }
  try {
    return { id, name, input: structuredClone(value.input) };
  } catch {
    throw new Error('Invalid agent tool call.');
  }
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength && !normalized.includes('\0')
    ? normalized
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

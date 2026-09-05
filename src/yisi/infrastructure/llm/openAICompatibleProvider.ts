import {
  AgentConversationMessage,
  AgentRequest,
  AgentStreamEvent,
  ChatDelta,
  ChatRequest,
  LLMProvider,
  MessageContent,
  ModelCapabilities,
  RequestSampling,
  parseAgentToolCall,
  parseAgentToolDefinition
} from '../../llm/types';
import { ProviderKind } from '../../domain/providerConfiguration';
import { modelSupportsVision } from '../../domain/modelCapabilities';
import { parseServerSentEvents } from './sseParser';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const MAX_TOOL_CALLS = 16;
const MAX_TOOL_ARGUMENT_BYTES = 65_536;

export interface OpenAICompatibleProviderOptions {
  id: string;
  providerKind?: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: FetchImplementation;
  toolCalling?: boolean;
  // Capability gating for sampling fields. The transport only forwards a field
  // when the request carries it AND the provider profile says it supports it.
  temperature?: boolean;
  maxTokens?: boolean;
  reasoningEffort?: boolean;
  /** Explicit model-family override; otherwise the centralized registry decides. */
  vision?: boolean;
  /** Retry a connect/network failure this many times before giving up. */
  retries?: number;
  /** Base delay before the first retry (doubles per attempt). */
  retryBackoffMs?: number;
}

export class ProviderTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ProviderTransportError';
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly imageInputTransport = true;
  private readonly fetchImpl: FetchImplementation;
  private readonly retries: number;
  private readonly retryBackoffMs: number;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.id = options.id;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retries = options.retries ?? 1;
    this.retryBackoffMs = options.retryBackoffMs ?? 1_500;
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    await this.listModels(signal);
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.fetchImpl(this.endpoint('models'), {
      method: 'GET',
      headers: this.headers(),
      signal
    });
    await this.requireSuccess(response);
    let payload: unknown;
    try { payload = await response.json(); } catch (error) {
      throw new ProviderTransportError('Provider returned malformed model JSON.', response.status, requestId(response), { cause: error });
    }
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new ProviderTransportError('Provider returned a malformed model list.', response.status, requestId(response));
    }
    return [...new Set(payload.data.flatMap(item => (
      isRecord(item) && typeof item.id === 'string' && item.id.trim() ? [item.id.trim()] : []
    )))].sort();
  }

  async capabilities(model: string): Promise<ModelCapabilities> {
    return {
      toolCalling: this.options.toolCalling ?? false,
      streaming: true,
      vision: modelSupportsVision(this.options.providerKind ?? 'openaiCompatible', model, this.options.vision),
      reasoning: this.options.reasoningEffort ?? false,
      structuredOutput: false
    };
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta> {
    const response = await this.fetchWithRetry(this.endpoint('chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(openAIWireMessage),
        stream: true,
        ...this.samplingBody(request)
      }),
      signal
    }, signal);
    await this.requireSuccess(response);
    if (!response.body) {
      throw new ProviderTransportError('Provider stream has no response body.', response.status, requestId(response));
    }

    let emitted = false;
    for await (const data of parseServerSentEvents(response.body, signal)) {
      if (data === '[DONE]') break;
      let event: unknown;
      try { event = JSON.parse(data) as unknown; } catch (error) {
        throw new ProviderTransportError('Malformed provider stream event.', response.status, requestId(response), { cause: error });
      }
      const deltas = textDeltas(event);
      for (const text of deltas) {
        emitted = true;
        yield { text };
      }
    }
    if (!emitted) {
      throw new ProviderTransportError('Provider returned an empty response.', response.status, requestId(response));
    }
  }

  async *streamAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentStreamEvent> {
    const tools = request.tools.map(definition => ({
      type: 'function',
      function: parseAgentToolDefinition(definition)
    }));
    const response = await this.fetchWithRetry(this.endpoint('chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(agentWireMessage),
        tools,
        tool_choice: 'auto',
        stream: true,
        ...this.samplingBody(request)
      }),
      signal
    }, signal);
    await this.requireSuccess(response);
    if (!response.body) {
      throw new ProviderTransportError('Provider stream has no response body.', response.status, requestId(response));
    }

    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let emitted = false;
    let sawTool = false;
    for await (const data of parseServerSentEvents(response.body, signal)) {
      if (data === '[DONE]') break;
      let event: unknown;
      try { event = JSON.parse(data) as unknown; } catch (error) {
        throw new ProviderTransportError('Malformed provider stream event.', response.status, requestId(response), { cause: error });
      }
      const choice = firstChoice(event);
      const delta = choice.delta;
      // A single assistant turn may legally carry BOTH text (e.g. a short
      // preamble like "let me read that first") and tool calls. Keep both:
      // stream the text, and accumulate the tool fragments so the agent loop
      // attaches the text to the assistant message alongside the calls instead
      // of rejecting the whole round.
      if (typeof delta.content === 'string' && delta.content) {
        emitted = true;
        yield { type: 'textDelta', text: delta.content };
      }
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls)) {
          throw new ProviderTransportError('Malformed provider tool call.');
        }
        sawTool = true;
        for (const fragment of delta.tool_calls) appendToolFragment(calls, fragment);
      }
      if (choice.finish_reason === 'tool_calls') {
        if (!sawTool || calls.size === 0) throw new ProviderTransportError('Malformed provider tool call.');
        for (const [, call] of [...calls.entries()].sort(([left], [right]) => left - right)) {
          let input: unknown;
          try { input = JSON.parse(call.arguments); } catch (error) {
            throw new ProviderTransportError('Malformed provider tool call arguments.', undefined, undefined, { cause: error });
          }
          try {
            yield { type: 'toolCall', call: parseAgentToolCall({ id: call.id, name: call.name, input }) };
          } catch (error) {
            throw new ProviderTransportError('Malformed provider tool call.', undefined, undefined, { cause: error });
          }
          emitted = true;
        }
      }
    }
    if (!emitted) throw new ProviderTransportError('Provider returned an empty response.', response.status, requestId(response));
  }

  private endpoint(path: string): string {
    return `${this.options.baseUrl.replace(/\/$/, '')}/${path}`;
  }

  /**
   * Fetch with a bounded retry on connect/network failure (fetch rejects on
   * transport errors). HTTP success/error statuses are NOT retried: they come
   * back as a Response and are surfaced to the caller as provider errors. Tuned
   * to be conservative: one retry with an exponential backoff, abortable.
   */
  private async fetchWithRetry(
    input: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.fetchImpl(input, { ...init, signal });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt >= this.retries || this.retries <= 0) throw error;
        await abortableDelay(this.retryBackoffMs * 2 ** attempt, signal);
      }
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    return headers;
  }

  // Sampling overrides are only forwarded when the capability profile enables
  // that field and the request actually carries a value.
  private samplingBody(request: RequestSampling): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (this.options.temperature && request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (this.options.maxTokens && request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (
      this.options.reasoningEffort
      && request.reasoningPreset !== undefined
      && (request.reasoningPreset === 'low' || request.reasoningPreset === 'medium' || request.reasoningPreset === 'high')
    ) {
      body.reasoning_effort = request.reasoningPreset;
    }
    return body;
  }

  private async requireSuccess(response: Response): Promise<void> {
    if (response.ok) return;
    let body = '';
    try { body = (await response.text()).slice(0, 240); } catch { body = ''; }
    if (this.options.apiKey) body = body.split(this.options.apiKey).join('[REDACTED]');
    const suffix = body ? `: ${body}` : '';
    throw new ProviderTransportError(`Provider HTTP ${response.status}${suffix}`, response.status, requestId(response));
  }
}

function agentWireMessage(message: AgentConversationMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content
    };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.input) }
      }))
    };
  }
  return { role: message.role, content: openAIWireContent(message.content) };
}

function openAIWireMessage(message: { role: string; content: MessageContent }): Record<string, unknown> {
  return { role: message.role, content: openAIWireContent(message.content) };
}

function openAIWireContent(content: MessageContent): unknown {
  if (typeof content === 'string') return content;
  return content.map(part => part.type === 'text'
    ? { type: 'text', text: part.text }
    : {
        type: 'image_url',
        image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` }
      });
}

function firstChoice(value: unknown): { delta: Record<string, unknown>; finish_reason?: unknown } {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    throw new ProviderTransportError('Malformed provider stream event.');
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) {
    throw new ProviderTransportError('Malformed provider stream event.');
  }
  return { delta: choice.delta, finish_reason: choice.finish_reason };
}

function appendToolFragment(
  calls: Map<number, { id: string; name: string; arguments: string }>,
  value: unknown
): void {
  if (!isRecord(value) || !Number.isInteger(value.index) || (value.index as number) < 0) {
    throw new ProviderTransportError('Malformed provider tool call.');
  }
  const index = value.index as number;
  if (index >= MAX_TOOL_CALLS || (!calls.has(index) && calls.size >= MAX_TOOL_CALLS)) {
    throw new ProviderTransportError('Provider returned too many tool calls.');
  }
  if (value.type !== undefined && value.type !== 'function') {
    throw new ProviderTransportError('Malformed provider tool call.');
  }
  const current = calls.get(index) ?? { id: '', name: '', arguments: '' };
  if (value.id !== undefined) {
    if (typeof value.id !== 'string' || (current.id && current.id !== value.id)) {
      throw new ProviderTransportError('Malformed provider tool call.');
    }
    current.id = value.id;
  }
  if (value.function !== undefined) {
    if (!isRecord(value.function)) throw new ProviderTransportError('Malformed provider tool call.');
    if (value.function.name !== undefined) {
      if (typeof value.function.name !== 'string') throw new ProviderTransportError('Malformed provider tool call.');
      current.name += value.function.name;
    }
    if (value.function.arguments !== undefined) {
      if (typeof value.function.arguments !== 'string') throw new ProviderTransportError('Malformed provider tool call.');
      current.arguments += value.function.arguments;
      if (Buffer.byteLength(current.arguments, 'utf8') > MAX_TOOL_ARGUMENT_BYTES) {
        throw new ProviderTransportError('Provider tool call arguments are too large.');
      }
    }
  }
  calls.set(index, current);
}

function textDeltas(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new ProviderTransportError('Malformed provider stream event.');
  }
  return value.choices.flatMap(choice => {
    if (!isRecord(choice) || !isRecord(choice.delta)) return [];
    return typeof choice.delta.content === 'string' && choice.delta.content ? [choice.delta.content] : [];
  });
}

function requestId(response: Response): string | undefined {
  return response.headers.get('x-request-id')?.slice(0, 128) || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Sleep that rejects with an AbortError as soon as the signal aborts. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

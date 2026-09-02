import {
  ChatDelta,
  ChatRequest,
  LLMProvider,
  MessageContent,
  ModelCapabilities
} from '../../llm/types';
import { modelSupportsVision } from '../../domain/modelCapabilities';
import { parseServerSentEvents } from './sseParser';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

const REASONING_BUDGET_TOKENS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32000
};

export interface AnthropicProviderOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  // Curated official model list for providers without a public /models endpoint.
  models?: string[];
  fetchImpl?: FetchImplementation;
  temperature?: boolean;
  maxTokens?: boolean;
  // Whether extended thinking budget control is enabled for this profile.
  thinking?: boolean;
  /** Explicit model-family override; otherwise the centralized registry decides. */
  vision?: boolean;
}

export class AnthropicTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AnthropicTransportError';
  }
}

export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  readonly imageInputTransport = true;
  private readonly fetchImpl: FetchImplementation;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.id = options.id;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listModels(): Promise<string[]> {
    return [...(this.options.models ?? [])];
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    const model = this.options.models?.[0];
    if (!model) throw new AnthropicTransportError('Anthropic requires a known model id to test the connection.');
    const response = await this.fetchImpl(this.endpoint('v1/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      signal
    });
    await this.requireSuccess(response, model);
  }

  async capabilities(model: string): Promise<ModelCapabilities> {
    return {
      toolCalling: false,
      streaming: true,
      vision: modelSupportsVision('anthropic', model, this.options.vision),
      reasoning: this.options.thinking ?? false,
      structuredOutput: false
    };
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta> {
    const body = this.requestBody(request, true);
    const response = await this.fetchImpl(this.endpoint('v1/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal
    });
    await this.requireSuccess(response, request.model);
    if (!response.body) {
      throw new AnthropicTransportError('Provider stream has no response body.', response.status);
    }

    let emitted = false;
    for await (const data of parseServerSentEvents(response.body, signal)) {
      if (data === '[DONE]') break;
      let event: unknown;
      try { event = JSON.parse(data) as unknown; } catch (error) {
        throw new AnthropicTransportError('Malformed provider stream event.', undefined, { cause: error });
      }
      if (!isRecord(event)) throw new AnthropicTransportError('Malformed provider stream event.');
      if (event.type === 'error') {
        const message = isRecord(event.error) && typeof event.error.message === 'string'
          ? event.error.message
          : 'Anthropic stream error';
        throw new AnthropicTransportError(message.slice(0, 240));
      }
      if (event.type === 'content_block_delta' && isRecord(event.delta) && event.delta.type === 'text_delta') {
        if (typeof event.delta.text === 'string' && event.delta.text) {
          emitted = true;
          yield { text: event.delta.text };
        }
      }
    }
    if (!emitted) throw new AnthropicTransportError('Provider returned an empty response.', response.status);
  }

  private requestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    let system: string | undefined;
    const messages = [];
    for (const message of request.messages) {
      if (message.role === 'system') {
        const text = contentAsText(message.content);
        system = system === undefined ? text : `${system}\n\n${text}`;
        continue;
      }
      messages.push({ role: message.role, content: anthropicWireContent(message.content) });
    }

    const maxTokens = this.options.maxTokens && request.maxTokens !== undefined
      ? request.maxTokens
      : DEFAULT_MAX_TOKENS;
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: maxTokens,
      messages,
      stream
    };
    if (system) body.system = system;
    if (this.options.temperature && request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (this.options.thinking && request.reasoningPreset !== undefined
      && request.reasoningPreset !== 'auto'
      && request.reasoningPreset !== 'off'
    ) {
      const budget = Math.min(
        REASONING_BUDGET_TOKENS[request.reasoningPreset] ?? REASONING_BUDGET_TOKENS.medium,
        Math.max(1024, maxTokens - 1024)
      );
      body.thinking = { type: 'enabled', budget_tokens: budget };
    }
    return body;
  }

  private endpoint(path: string): string {
    return `${this.options.baseUrl.replace(/\/$/, '')}/${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION
    };
    if (this.options.apiKey) {
      headers['x-api-key'] = this.options.apiKey;
      headers.Authorization = `Bearer ${this.options.apiKey}`;
    }
    return headers;
  }

  private async requireSuccess(response: Response, model: string): Promise<void> {
    if (response.ok) return;
    let body = '';
    try { body = (await response.text()).slice(0, 240); } catch { body = ''; }
    if (this.options.apiKey) body = body.split(this.options.apiKey).join('[REDACTED]');
    const suffix = body ? `: ${body}` : '';
    throw new AnthropicTransportError(`Provider HTTP ${response.status}${suffix}`, response.status);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentAsText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}

function anthropicWireContent(content: MessageContent): unknown {
  if (typeof content === 'string') return content;
  return content.map(part => part.type === 'text'
    ? { type: 'text', text: part.text }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mimeType,
          data: part.dataBase64
        }
      });
}

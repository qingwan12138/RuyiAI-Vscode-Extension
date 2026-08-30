import { ChatDelta, ChatRequest, LLMProvider, ModelCapabilities } from '../../llm/types';
import { parseServerSentEvents } from './sseParser';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: FetchImplementation;
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
  private readonly fetchImpl: FetchImplementation;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.id = options.id;
    this.fetchImpl = options.fetchImpl ?? fetch;
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

  async capabilities(_model: string): Promise<ModelCapabilities> {
    return {
      toolCalling: false,
      streaming: true,
      vision: false,
      reasoning: false,
      structuredOutput: false
    };
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta> {
    const response = await this.fetchImpl(this.endpoint('chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: request.model, messages: request.messages, stream: true }),
      signal
    });
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

  private endpoint(path: string): string {
    return `${this.options.baseUrl.replace(/\/$/, '')}/${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    return headers;
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

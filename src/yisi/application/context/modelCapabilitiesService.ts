import { YisiTool } from '../../domain/tool';
import type { ModelCapabilities } from '../../llm/types';

export interface ModelCapabilitiesReport {
  modelId: string | null;
  available: boolean;
  toolCalling: boolean;
  vision: boolean;
  reasoning: boolean;
  streaming: boolean;
  maxContextTokens?: number;
  /** Human list of capabilities the selected model is missing (clear degradation). */
  degraded: string[];
}

export type CapabilitiesResolver = () => Promise<ModelCapabilitiesReport | null>;

/** Build the human capability report including a clear list of missing ones. */
export function buildCapabilitiesReport(modelId: string, caps: ModelCapabilities): ModelCapabilitiesReport {
  const degraded: string[] = [];
  if (!caps.toolCalling) degraded.push('tool calling');
  if (!caps.vision) degraded.push('vision / image input');
  if (!caps.reasoning) degraded.push('reasoning effort control');
  if (!caps.streaming) degraded.push('streaming');
  const report: ModelCapabilitiesReport = {
    modelId,
    available: true,
    toolCalling: caps.toolCalling,
    vision: caps.vision === true,
    reasoning: caps.reasoning === true,
    streaming: caps.streaming,
    degraded
  };
  if (caps.maxContextTokens !== undefined) report.maxContextTokens = caps.maxContextTokens;
  return report;
}

/**
 * Explicit capability degradation surface (v0.7 DoD): the model can call this
 * read-only tool to learn what it supports and what is missing, so it degrades
 * gracefully instead of attempting an unsupported operation.
 */
export function createModelCapabilitiesTool(resolve: CapabilitiesResolver): YisiTool {
  return {
    id: 'model_capabilities',
    description:
      'Report the selected model capabilities (tool calling, vision, streaming, reasoning, context window) and list any that are missing. Check this before relying on a capability the model may not support, and degrade gracefully when something is unavailable.',
    risk: 'readOnly',
    mutatesWorkspace: false,
    supportsCancellation: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async (_input, context) => {
      const report = await resolve().catch(() => null);
      return report ?? {
        modelId: null,
        available: false,
        toolCalling: false,
        vision: false,
        reasoning: false,
        streaming: false,
        degraded: ['No model is selected or the provider could not be resolved.']
      };
    }
  };
}

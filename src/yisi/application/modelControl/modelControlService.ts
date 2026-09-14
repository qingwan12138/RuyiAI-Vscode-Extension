import { ProviderConfigurationService } from '../provider/providerConfigurationService';
import { SessionService } from '../session/sessionService';
import { ProviderConfiguration, ReasoningMode, isReasoningPreset } from '../../domain/providerConfiguration';
import { ReasoningPreset, SpeedMode } from '../../domain/session';
import { knownModelsFor } from '../../domain/providerDefaults';

export interface ModelControlCapabilities {
  reasoningMode: ReasoningMode;
  // Presets offered in the compact UI (empty => no reasoning control).
  reasoningPresets: ReasoningPreset[];
  // Highlighted preset when the session has not chosen explicitly.
  reasoningDefault: ReasoningPreset;
  speedMode: boolean;
  temperature: boolean;
  maxTokens: boolean;
  contextLength?: number;
}

export interface ModelControlModelView {
  id: string;
  name: string;
  available: boolean;
  capabilities: ModelControlCapabilities;
  /**
   * Set when this is a retired id the provider still accepts: the current model
   * that serves those requests. The picker labels it instead of hiding the id,
   * so a legacy choice is never silently presented as a current model.
   */
  legacyOf?: string;
}

export interface ModelControlProviderView {
  id: string;
  name: string;
  configured: boolean;
  models: ModelControlModelView[];
}

export interface ModelControlCurrentView {
  providerId: string;
  modelId: string;
  reasoningEffort?: ReasoningPreset;
  speedMode?: SpeedMode;
  temperature?: number;
  maxTokens?: number;
  displayName: string;
  available: boolean;
  capabilities: ModelControlCapabilities;
}

export interface ModelControlState {
  current: ModelControlCurrentView;
  providers: ModelControlProviderView[];
}

const EMPTY_CAPABILITIES: ModelControlCapabilities = {
  reasoningMode: 'none',
  reasoningPresets: [],
  reasoningDefault: 'auto',
  speedMode: false,
  temperature: false,
  maxTokens: false
};

export class ModelControlService {
  constructor(
    private readonly configurations: ProviderConfigurationService,
    private readonly sessions: SessionService,
    private readonly environment: Readonly<Record<string, string | undefined>>
  ) {}

  async getState(): Promise<ModelControlState> {
    const model = this.sessions.getActiveSession().model;
    const providers: ModelControlProviderView[] = [];
    for (const configuration of this.configurations.list()) {
      // Which of this provider's ids are retired, by kind. Kept in the domain so
      // the Webview never learns model naming rules.
      const known = new Map(knownModelsFor(configuration.kind).map(entry => [entry.id, entry]));
      providers.push({
        id: configuration.id,
        name: configuration.name,
        configured: await this.isConfigured(configuration),
        // offeredModels, not configuration.models: the known roster is merged on
        // read so a configuration saved before the retired ids were offered still
        // exposes them (the stored list is never rewritten).
        models: this.configurations.offeredModels(configuration).map(modelId => {
          const entry = known.get(modelId);
          const legacyOf = entry?.status === 'legacy' ? entry.servedBy : undefined;
          return {
            id: modelId,
            name: modelId,
            available: true,
            capabilities: capabilitiesOf(configuration, modelId),
            ...(legacyOf ? { legacyOf } : {})
          };
        })
      });
    }

    const provider = this.configurations.get(model.providerId);
    const available = !!provider && this.configurations.offeredModels(provider).includes(model.modelId);
    const capabilities = provider ? capabilitiesOf(provider, model.modelId) : EMPTY_CAPABILITIES;
    const displayName = !model.providerId || !model.modelId
      ? '选择模型'
      : model.modelId || '模型不可用';

    return {
      current: {
        providerId: model.providerId,
        modelId: model.modelId,
        reasoningEffort: model.reasoningEffort,
        speedMode: model.speedMode,
        temperature: model.temperature,
        maxTokens: model.maxTokens,
        displayName,
        available,
        capabilities
      },
      providers
    };
  }

  private async isConfigured(configuration: ProviderConfiguration): Promise<boolean> {
    if (configuration.credential.source === 'none') return true;
    if (configuration.credential.source === 'environment') {
      const value = this.environment[configuration.credential.variableName];
      return typeof value === 'string' && value.trim().length > 0;
    }
    return this.configurations.hasSecretKey(configuration.id);
  }
}

// Reasoning capability for a specific model. Instance-level capability is the
// base; a small central registry refines known models so the UI never has to
// guess. Unknown models fall back to the configured profile.
function capabilitiesOf(configuration: ProviderConfiguration, modelId: string): ModelControlCapabilities {
  const reasoning = reasoningFor(configuration, modelId);
  return {
    reasoningMode: reasoning.mode,
    reasoningPresets: reasoning.presets,
    reasoningDefault: reasoning.default,
    speedMode: configuration.capabilities.speedMode ?? false,
    temperature: configuration.capabilities.temperature ?? false,
    maxTokens: configuration.capabilities.maxTokens ?? false,
    contextLength: configuration.capabilities.contextLength
  };
}

function reasoningFor(
  configuration: ProviderConfiguration,
  modelId: string
): { mode: ReasoningMode; presets: ReasoningPreset[]; default: ReasoningPreset } {
  const base = configuration.capabilities.reasoning;
  const legacyEffort = configuration.capabilities.reasoningEffort ?? false;

  const mode = base?.mode
    ?? (legacyEffort ? 'effort' : 'none');
  const presets: ReasoningPreset[] = (base?.presets ?? [])
    .filter(isReasoningPreset);
  if (presets.length === 0 && legacyEffort) {
    presets.push('auto', 'low', 'medium', 'high');
  }
  const fallbackDefault: ReasoningPreset = base?.defaultPreset && isReasoningPreset(base.defaultPreset)
    ? base.defaultPreset
    : 'auto';
  const activeDefault = presets.includes(fallbackDefault) ? fallbackDefault : 'auto';

  // Centralized known-model refinement (kept out of the Webview).
  if (configuration.kind === 'deepseek' && /reasoner/i.test(modelId)) {
    return { mode: 'fixed', presets: [], default: 'auto' };
  }
  if (configuration.kind === 'anthropic' && /haiku|sonnet-4-5-5|opus-4-5-5/i.test(modelId)) {
    // Sonnet/Opus 4.5+ support thinking; haiku class models generally do not.
    if (/haiku/i.test(modelId)) return { mode: 'none', presets: [], default: 'auto' };
  }
  if (configuration.kind === 'openaiCompatible' || configuration.kind === 'llamaCpp') {
    // Unknown remote/local model; never fabricate a reasoning UI.
    return { mode: mode === 'effort' ? 'effort' : 'none', presets: mode === 'effort' ? presets : [], default: 'auto' };
  }

  return { mode, presets: presets.length > 0 ? presets : [], default: presets.length > 0 ? activeDefault : 'auto' };
}

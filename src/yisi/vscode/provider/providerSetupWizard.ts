import * as vscode from 'vscode';
import { ProviderConfigurationService } from '../../application/provider/providerConfigurationService';
import { ProviderFactory } from '../../application/provider/providerCatalog';
import { SessionService } from '../../application/session/sessionService';
import {
  CredentialSource,
  PROVIDER_KIND_LABELS,
  PROVIDER_KIND_ORDER,
  ProviderCapabilities,
  ProviderConfiguration,
  ProviderConfigurationInput,
  ProviderKind,
  createProviderConfiguration,
  providerKindRequiresCredential
} from '../../domain/providerConfiguration';

const DISCOVERY_TIMEOUT_MS = 15_000;

interface ProviderProfile {
  kind: ProviderKind;
  defaultName: string;
  defaultBaseUrl: string;
  defaultModels?: string[];
  capabilities: ProviderCapabilities;
}

const PROFILES: Record<ProviderKind, ProviderProfile> = {
  openai: {
    kind: 'openai',
    defaultName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    capabilities: {
      toolCalling: true,
      temperature: true,
      maxTokens: true,
      speedMode: false,
      reasoning: {
        mode: 'effort',
        presets: ['auto', 'low', 'medium', 'high'],
        defaultPreset: 'auto'
      }
    }
  },
  deepseek: {
    kind: 'deepseek',
    defaultName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    capabilities: {
      toolCalling: true,
      temperature: true,
      maxTokens: true,
      speedMode: false,
      reasoning: { mode: 'none' }
    }
  },
  anthropic: {
    kind: 'anthropic',
    defaultName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModels: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
    capabilities: {
      toolCalling: false,
      temperature: true,
      maxTokens: true,
      speedMode: false,
      reasoning: {
        mode: 'budget',
        presets: ['auto', 'off', 'low', 'medium', 'high', 'xhigh'],
        defaultPreset: 'auto',
        minBudgetTokens: 1024,
        maxBudgetTokens: 32000
      }
    }
  },
  openaiCompatible: {
    kind: 'openaiCompatible',
    defaultName: 'My API',
    defaultBaseUrl: 'https://example.com/v1',
    capabilities: {
      toolCalling: false,
      temperature: true,
      maxTokens: true,
      speedMode: false,
      reasoning: { mode: 'none' }
    }
  },
  llamaCpp: {
    kind: 'llamaCpp',
    defaultName: 'llama.cpp',
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    capabilities: {
      toolCalling: false,
      temperature: true,
      maxTokens: true,
      speedMode: false,
      reasoning: { mode: 'none' }
    }
  }
};

export class ProviderSetupWizard {
  constructor(
    private readonly configurations: ProviderConfigurationService,
    private readonly sessions: SessionService,
    private readonly factory: ProviderFactory,
    private readonly environment: Readonly<Record<string, string | undefined>>
  ) {}

  async run(): Promise<void> {
    await this.managementLoop();
  }

  async applyWorkspaceDefaultToActiveSession(): Promise<void> {
    const active = this.sessions.getActiveSession();
    const resolved = this.configurations.resolveSelection(active.model);
    if (resolved && (resolved.providerId !== active.model.providerId || resolved.modelId !== active.model.modelId)) {
      await this.sessions.setModelSelection(resolved);
    }
  }

  private async managementLoop(): Promise<void> {
    for (;;) {
      const providers = this.configurations.list();
      const items: Array<vscode.QuickPickItem & { id?: string; action?: 'add' }> = [
        { label: '$(add)  Add Provider…', action: 'add' }
      ];
      for (const provider of providers) {
        items.push({
          label: provider.name,
          description: `${PROVIDER_KIND_LABELS[provider.kind]} · ${provider.models.length} model(s)`,
          id: provider.id
        });
      }
      if (providers.length === 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: 'No providers configured yet.', description: 'Add one to start chatting with models.' });
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Yisi AI · Providers',
        placeHolder: 'Manage your API connections'
      });
      if (!picked) return;
      if (picked.action === 'add') {
        await this.addProviderFlow();
      } else if (picked.id) {
        const finished = await this.manageProviderFlow(picked.id);
        if (finished) return;
      }
    }
  }

  private async addProviderFlow(): Promise<ProviderConfiguration | undefined> {
    const profile = await this.pickProviderProfile();
    if (!profile) return undefined;

    const name = await vscode.window.showInputBox({
      title: 'Yisi AI · Add Provider',
      prompt: 'Provider name (display only)',
      value: profile.defaultName,
      validateInput: required
    });
    if (name === undefined) return undefined;

    const baseUrl = await vscode.window.showInputBox({
      title: 'Yisi AI · Add Provider',
      prompt: 'API Base URL',
      value: profile.defaultBaseUrl,
      validateInput: required
    });
    if (baseUrl === undefined) return undefined;

    const credential = await this.pickCredential(profile.kind);
    if (!credential) return undefined;
    let apiKey: string | undefined;
    if (credential.source === 'secretStorage') {
      apiKey = await vscode.window.showInputBox({
        title: 'Yisi AI · Add Provider',
        prompt: 'API Key (stored only in VS Code SecretStorage)',
        password: true,
        ignoreFocusOut: true,
        validateInput: required
      });
      if (apiKey === undefined) return undefined;
    }

    const resolvedKey = this.resolveApiKey(credential, apiKey);
    if (resolvedKey === null) return undefined;

    const draft: ProviderConfigurationInput = {
      kind: profile.kind,
      name,
      baseUrl,
      credential,
      models: [...(profile.defaultModels ?? [])],
      capabilities: profile.capabilities
    };

    const discovered = await this.testAndDiscover(draft, resolvedKey, profile.defaultName);
    if (discovered === undefined) return undefined;

    let models = discovered;
    if (models.length === 0) {
      const manual = await this.enterModelsManually();
      if (manual === undefined) return undefined;
      models = manual;
    }

    try {
      const created = await this.configurations.create({ ...draft, models }, apiKey);
      const configured = resolvedKey ? ' and connected' : '';
      void vscode.window.showInformationMessage(
        `Yisi AI provider “${created.name}” saved${configured} with ${created.models.length} model(s).`
      );
      return created;
    } catch (error: unknown) {
      void vscode.window.showErrorMessage(`Could not save provider: ${safeMessage(error)}`);
      return undefined;
    }
  }

  private async manageProviderFlow(providerId: string): Promise<boolean> {
    for (;;) {
      const provider = this.configurations.get(providerId);
      if (!provider) {
        void vscode.window.showWarningMessage('This provider no longer exists.');
        return false;
      }
      const action = await vscode.window.showQuickPick([
        { label: 'Test Connection', description: `Check ${provider.baseUrl}`, action: 'test' },
        { label: 'Refresh Models', description: 'Re-discover the model list', action: 'refresh' },
        { label: 'Edit Provider', description: 'Rename / Base URL / API Key', action: 'edit' },
        { label: 'Delete Provider…', description: 'Remove config, secret and models', action: 'delete' },
        { label: '← Back', action: 'back' }
      ], {
        title: `Yisi AI · ${provider.name} · ${PROVIDER_KIND_LABELS[provider.kind]}`,
        placeHolder: 'Manage this API connection'
      });
      if (!action || action.action === 'back') return false;

      if (action.action === 'test') {
        const ok = await this.testProvider(provider);
        if (!ok) return false;
      } else if (action.action === 'refresh') {
        const finished = await this.refreshModels(provider);
        if (finished) return false;
      } else if (action.action === 'edit') {
        const edited = await this.editProvider(provider);
        if (edited) continue;
      } else if (action.action === 'delete') {
        const deleted = await this.deleteProvider(provider);
        if (deleted) return true;
      }
    }
  }

  private async pickProviderProfile(): Promise<ProviderProfile | undefined> {
    const picked = await vscode.window.showQuickPick(
      PROVIDER_KIND_ORDER.map(kind => ({
        label: PROFILES[kind].defaultName,
        description: kindDetail(kind),
        profile: PROFILES[kind]
      })),
      { title: 'Yisi AI · Add Provider', placeHolder: 'Choose the provider type' }
    );
    return picked?.profile;
  }

  private async pickCredential(kind: ProviderKind): Promise<CredentialSource | undefined> {
    const choices: Array<vscode.QuickPickItem & { source: CredentialSource['source'] }> = [
      { label: 'Secure key storage', detail: 'Enter an API key; it stays in VS Code SecretStorage', source: 'secretStorage' as const },
      { label: 'Environment variable', detail: 'Read the key from the extension host environment', source: 'environment' as const }
    ];
    if (!providerKindRequiresCredential(kind)) {
      choices.unshift({ label: 'No credential', detail: 'Only for a trusted local endpoint', source: 'none' as const });
    }
    const choice = await vscode.window.showQuickPick(choices, { title: 'Yisi AI · Credential source' });
    if (!choice) return undefined;
    if (choice.source !== 'environment') return { source: choice.source };
    const variableName = await vscode.window.showInputBox({
      title: 'Yisi AI · Environment credential',
      prompt: 'Environment variable name',
      value: '',
      validateInput: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim()) ? undefined : 'Enter a valid environment variable name.'
    });
    return variableName === undefined ? undefined : { source: 'environment', variableName: variableName.trim() };
  }

  private resolveApiKey(credential: CredentialSource, provided?: string): string | null {
    if (credential.source === 'none') return null;
    if (credential.source === 'environment') {
      const value = this.environment[credential.variableName];
      if (!value?.trim()) {
        void vscode.window.showErrorMessage(
          `Environment variable ${credential.variableName} is not set or empty.`
        );
        return null;
      }
      return value.trim();
    }
    return provided ?? null;
  }

  private async testAndDiscover(
    draft: ProviderConfigurationInput,
    apiKey: string | null,
    defaultName: string
  ): Promise<string[] | undefined> {
    const baseModels = [...draft.models];
    for (;;) {
      try {
        const temporary = createProviderConfiguration('provider-discovery', 0, {
          ...draft,
          models: baseModels.length > 0 ? baseModels : ['discovery']
        });
        const provider = this.factory.create(temporary, apiKey ?? undefined);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
        let discovered: string[];
        try {
          discovered = await provider.listModels(controller.signal);
        } finally {
          clearTimeout(timer);
        }
        if (discovered.length === 0 && baseModels.length === 0) {
          // Provider connected but exposes no model list endpoint.
          const choice = await vscode.window.showWarningMessage(
            `Connection to ${defaultName} succeeded, but no models were returned.`,
            'Enter Models Manually',
            'Save without models'
          );
          if (choice === 'Enter Models Manually') {
            const manual = await this.enterModelsManually();
            if (manual === undefined) return undefined;
            return manual;
          }
          if (choice === 'Save without models') return [];
          return undefined;
        }
        return discovered;
      } catch (error: unknown) {
        const message = describeConnectionError(error);
        const choice = await vscode.window.showWarningMessage(
          `Connection failed: ${message}\n\nCheck the Base URL and API Key, then retry.`,
          'Enter Models Manually',
          'Cancel'
        );
        if (choice !== 'Enter Models Manually') return undefined;
        const manual = await this.enterModelsManually();
        if (manual === undefined) return undefined;
        return manual;
      }
    }
  }

  private async enterModelsManually(): Promise<string[] | undefined> {
    const value = await vscode.window.showInputBox({
      title: 'Yisi AI · Models',
      prompt: 'Comma-separated model IDs (optional)',
      validateInput: () => undefined
    });
    if (value === undefined) return undefined;
    return [...new Set(value.split(',').map(model => model.trim()).filter(Boolean))];
  }

  private async testProvider(provider: ProviderConfiguration): Promise<boolean> {
    const apiKey = await this.resolveStoredKey(provider);
    if (apiKey === null) return false;
    try {
      const instance = this.factory.create(provider, apiKey ?? undefined);
      if (instance.testConnection) {
        await instance.testConnection();
      } else {
        await instance.listModels();
      }
      void vscode.window.showInformationMessage(`${provider.name}: connection OK.`);
      return true;
    } catch (error: unknown) {
      void vscode.window.showErrorMessage(`${provider.name}: ${describeConnectionError(error)}`);
      return false;
    }
  }

  private async refreshModels(provider: ProviderConfiguration): Promise<boolean> {
    const apiKey = await this.resolveStoredKey(provider);
    if (apiKey === null) return false;
    const baseModels = [...provider.models];
    const choice = await vscode.window.showWarningMessage(
      `Re-query ${provider.name} for its model list?`,
      'Refresh',
      'Cancel'
    );
    if (choice !== 'Refresh') return false;
    try {
      const instance = this.factory.create({ ...provider, models: baseModels }, apiKey ?? undefined);
      const discovered = await instance.listModels();
      await this.configurations.replaceModels(provider.id, discovered);
      void vscode.window.showInformationMessage(
        `${provider.name}: refreshed to ${discovered.length} model(s).`
      );
      return false;
    } catch (error: unknown) {
      const message = describeConnectionError(error);
      const manual = await vscode.window.showWarningMessage(
        `Refresh failed: ${message}`,
        'Enter Models Manually',
        'Cancel'
      );
      if (manual === 'Enter Models Manually') {
        const models = await this.enterModelsManually();
        if (models === undefined) return false;
        await this.configurations.replaceModels(provider.id, models);
      }
      return false;
    }
  }

  private async editProvider(provider: ProviderConfiguration): Promise<boolean> {
    const field = await vscode.window.showQuickPick([
      { label: 'Rename', description: provider.name, field: 'name' },
      { label: 'Base URL', description: provider.baseUrl, field: 'baseUrl' },
      ...(provider.credential.source === 'secretStorage'
        ? [{ label: 'Replace API Key', description: 'Update the stored secret', field: 'apiKey' as const }]
        : [])
    ], { title: `Yisi AI · Edit ${provider.name}` });
    if (!field) return false;

    if (field.field === 'name') {
      const name = await vscode.window.showInputBox({
        title: 'Yisi AI · Rename Provider',
        value: provider.name,
        validateInput: required
      });
      if (name === undefined) return false;
      await this.configurations.updateProvider(provider.id, { name });
      return true;
    }
    if (field.field === 'baseUrl') {
      const baseUrl = await vscode.window.showInputBox({
        title: 'Yisi AI · Base URL',
        value: provider.baseUrl,
        validateInput: required
      });
      if (baseUrl === undefined) return false;
      await this.configurations.updateProvider(provider.id, { baseUrl });
      return true;
    }
    // apiKey
    const apiKey = await vscode.window.showInputBox({
      title: 'Yisi AI · Replace API Key',
      prompt: 'New API Key',
      password: true,
      ignoreFocusOut: true,
      validateInput: required
    });
    if (apiKey === undefined) return false;
    await this.configurations.updateProvider(provider.id, {}, apiKey);
    return true;
  }

  private async deleteProvider(provider: ProviderConfiguration): Promise<boolean> {
    const affected = this.sessions.findByProvider(provider.id);
    const referenceNote = affected.length > 0
      ? `\n\n${affected.length} session(s) are currently using this provider. Their history stays, but their bound model will become unavailable (no automatic switch).`
      : '';
    const message = `Delete Provider “${provider.name}”?\n\nThis removes its configuration, API Key/Secret, and model list. Chat history and other providers are not affected.${referenceNote}`;
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Delete',
      'Cancel'
    );
    if (choice !== 'Delete') return false;
    await this.configurations.remove(provider.id);
    void vscode.window.showInformationMessage(`Deleted provider “${provider.name}”.`);
    return true;
  }

  private async resolveStoredKey(provider: ProviderConfiguration): Promise<string | null> {
    if (provider.credential.source === 'none') return null;
    if (provider.credential.source === 'environment') {
      const value = this.environment[provider.credential.variableName];
      if (!value?.trim()) {
        void vscode.window.showErrorMessage(`Environment variable ${provider.credential.variableName} is not set.`);
        return null;
      }
      return value.trim();
    }
    return (await this.configurations.getSecretKey(provider.id)) ?? null;
  }
}

function kindDetail(kind: ProviderKind): string {
  switch (kind) {
    case 'openai': return 'Official OpenAI API';
    case 'deepseek': return 'Official DeepSeek API';
    case 'anthropic': return 'Official Claude API';
    case 'openaiCompatible': return 'OpenRouter, proxies, vLLM, LM Studio…';
    case 'llamaCpp': return 'Local inference server';
  }
}

function describeConnectionError(error: unknown): string {
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
  if (status !== undefined) {
    if (status === 401 || status === 403) return 'Unauthorized — API Key invalid or missing.';
    if (status === 404) return 'Not Found — please check the Base URL.';
    if (status === 429) return 'Rate limited — slow down or check quota.';
    if (status >= 500) return 'Provider server error.';
  }
  const message = safeMessage(error);
  if (/ECONNREFUSED|connection refused/i.test(message)) return 'Connection refused — make sure the server is running.';
  if (/ETIMEDOUT|timeout|aborted/i.test(message)) return 'Timed out — check your network or proxy.';
  return message || 'Connection failed.';
}

function required(value: string): string | undefined {
  return value.trim() ? undefined : 'This value is required.';
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : 'Unknown provider error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

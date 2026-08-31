import * as vscode from 'vscode';
import { ProviderConfigurationService } from '../../application/provider/providerConfigurationService';
import { ProviderFactory } from '../../application/provider/providerCatalog';
import { SessionService } from '../../application/session/sessionService';
import { CredentialSource, ProviderConfiguration, ProviderConfigurationInput, ProviderKind, createProviderConfiguration } from '../../domain/providerConfiguration';
import { SessionModelSelection } from '../../domain/session';

const DISCOVERY_TIMEOUT_MS = 15_000;

export class ProviderSetupWizard {
  constructor(
    private readonly configurations: ProviderConfigurationService,
    private readonly sessions: SessionService,
    private readonly factory: ProviderFactory,
    private readonly environment: Readonly<Record<string, string | undefined>>
  ) {}

  async run(): Promise<ProviderConfiguration | undefined> {
    const kind = await this.pickProviderKind();
    if (!kind) return undefined;
    const name = await vscode.window.showInputBox({
      title: 'Yisi AI · Add provider',
      prompt: 'Provider name',
      value: kind === 'openai' ? 'OpenAI' : 'Local provider',
      validateInput: required
    });
    if (name === undefined) return undefined;
    const baseUrl = await vscode.window.showInputBox({
      title: 'Yisi AI · Add provider',
      prompt: 'OpenAI-compatible API base URL',
      value: kind === 'openai' ? 'https://api.openai.com/v1' : 'http://127.0.0.1:8080/v1',
      validateInput: required
    });
    if (baseUrl === undefined) return undefined;

    const credential = await this.pickCredential(kind);
    if (!credential) return undefined;
    let apiKey: string | undefined;
    if (credential.source === 'secretStorage') {
      apiKey = await vscode.window.showInputBox({
        title: 'Yisi AI · Add provider',
        prompt: 'API key (stored only in VS Code SecretStorage)',
        password: true,
        ignoreFocusOut: true,
        validateInput: required
      });
      if (apiKey === undefined) return undefined;
    }

    const draft: ProviderConfigurationInput = {
      kind, name, baseUrl, credential, models: ['discovery-placeholder'],
      capabilities: { toolCalling: false }
    };
    const resolvedKey = credential.source === 'environment' ? this.environment[credential.variableName] : apiKey;
    const models = await this.discoverOrEnterModels(draft, resolvedKey);
    if (!models) return undefined;
    const toolCalling = await this.pickToolCalling();
    if (toolCalling === undefined) return undefined;
    const created = await this.configurations.create({
      ...draft,
      models,
      capabilities: { toolCalling }
    }, apiKey);
    const selection = { providerId: created.id, modelId: models[0] };
    await this.select(selection, true);
    void vscode.window.showInformationMessage(`Yisi AI provider “${created.name}” is ready with ${models.length} model(s).`);
    return created;
  }

  async pickModelForSession(): Promise<SessionModelSelection | undefined> {
    const providers = this.configurations.list();
    if (providers.length === 0) {
      const action = await vscode.window.showInformationMessage(
        'No model provider is configured.',
        'Add Provider'
      );
      if (action === 'Add Provider') {
        const created = await this.run();
        return created && { providerId: created.id, modelId: created.models[0] };
      }
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(
      providers.flatMap(provider => provider.models.map(modelId => ({
        label: modelId,
        description: provider.name,
        selection: { providerId: provider.id, modelId }
      }))),
      { title: 'Yisi AI · Select model', placeHolder: 'Choose a configured provider and model' }
    );
    if (!picked) return undefined;
    const makeDefault = await vscode.window.showQuickPick([
      { label: 'Use for this session', defaultForWorkspace: false },
      { label: 'Use and make workspace default', defaultForWorkspace: true }
    ], { title: 'Yisi AI · Apply model' });
    if (!makeDefault) return undefined;
    await this.select(picked.selection, makeDefault.defaultForWorkspace);
    return picked.selection;
  }

  async applyWorkspaceDefaultToActiveSession(): Promise<void> {
    const active = this.sessions.getActiveSession();
    const resolved = this.configurations.resolveSelection(active.model);
    if (resolved && (resolved.providerId !== active.model.providerId || resolved.modelId !== active.model.modelId)) {
      await this.sessions.setModelSelection(resolved);
    }
  }

  private async select(selection: SessionModelSelection, workspaceDefault: boolean): Promise<void> {
    await this.sessions.setModelSelection(selection);
    if (workspaceDefault) await this.configurations.setWorkspaceDefault(selection);
  }

  private async pickProviderKind(): Promise<ProviderKind | undefined> {
    const choice = await vscode.window.showQuickPick([
      { label: 'OpenAI', detail: 'Official OpenAI API', providerKind: 'openai' as const },
      { label: 'OpenAI-compatible', detail: 'Local or custom compatible endpoint', providerKind: 'openaiCompatible' as const }
    ], { title: 'Yisi AI · Add provider' });
    return choice?.providerKind;
  }

  private async pickCredential(kind: ProviderKind): Promise<CredentialSource | undefined> {
    const choices: Array<vscode.QuickPickItem & { source: CredentialSource['source'] }> = [
      { label: 'Secure key storage', detail: 'Enter an API key; it stays in VS Code SecretStorage', source: 'secretStorage' as const },
      { label: 'Environment variable', detail: 'Read the key from the extension host environment', source: 'environment' as const }
    ];
    if (kind === 'openaiCompatible') {
      choices.push({ label: 'No credential', detail: 'Only for a trusted local endpoint', source: 'none' as const });
    }
    const choice = await vscode.window.showQuickPick(choices, { title: 'Yisi AI · Credential source' });
    if (!choice) return undefined;
    if (choice.source !== 'environment') return { source: choice.source };
    const variableName = await vscode.window.showInputBox({
      title: 'Yisi AI · Environment credential',
      prompt: 'Environment variable name',
      value: kind === 'openai' ? 'OPENAI_API_KEY' : '',
      validateInput: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim()) ? undefined : 'Enter a valid environment variable name.'
    });
    return variableName === undefined ? undefined : { source: 'environment', variableName: variableName.trim() };
  }

  private async pickToolCalling(): Promise<boolean | undefined> {
    const choice = await vscode.window.showQuickPick([
      {
        label: 'Enable read-only Agent tools',
        detail: 'The model may request bounded workspace Read, List, and Search operations',
        enabled: true
      },
      {
        label: 'Text chat only',
        detail: 'Use this when the provider or model does not support structured tool calling',
        enabled: false
      }
    ], {
      title: 'Yisi AI · Provider capability',
      placeHolder: 'Does this provider support OpenAI-compatible tool calling?'
    });
    return choice?.enabled;
  }

  private async discoverOrEnterModels(input: ProviderConfigurationInput, apiKey?: string): Promise<string[] | undefined> {
    try {
      const temporary = createProviderConfiguration('provider-discovery', 0, input);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
      try {
        const discovered = await this.factory.create(temporary, apiKey?.trim()).listModels(controller.signal);
        if (discovered.length > 0) return discovered;
        throw new Error('The provider returned no models.');
      } finally {
        clearTimeout(timer);
      }
    } catch (error: unknown) {
      const action = await vscode.window.showWarningMessage(
        `Model discovery failed: ${safeMessage(error)}`,
        'Enter Models Manually',
        'Cancel'
      );
      if (action !== 'Enter Models Manually') return undefined;
      const value = await vscode.window.showInputBox({
        title: 'Yisi AI · Models',
        prompt: 'Comma-separated model IDs. Saving now skips the connection test.',
        validateInput: value => parseModels(value).length > 0 ? undefined : 'Enter at least one model ID.'
      });
      return value === undefined ? undefined : parseModels(value);
    }
  }
}

function required(value: string): string | undefined {
  return value.trim() ? undefined : 'This value is required.';
}

function parseModels(value: string): string[] {
  return [...new Set(value.split(',').map(model => model.trim()).filter(Boolean))];
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : 'Unknown provider error';
}

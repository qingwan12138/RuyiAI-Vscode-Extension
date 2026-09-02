import {
  ProviderConfiguration,
  ProviderConfigurationDocument,
  ProviderConfigurationInput,
  createProviderConfiguration,
  parseProviderConfigurationDocument
} from '../../domain/providerConfiguration';
import { SessionModelSelection } from '../../domain/session';
import { ProviderConfigurationRepository } from './providerConfigurationRepository';
import { SecretStore } from './secretStore';

export class ProviderConfigurationService {
  private document: ProviderConfigurationDocument = { schemaVersion: 2, configurations: [] };
  private workspaceDefault?: SessionModelSelection;

  constructor(
    private readonly repository: ProviderConfigurationRepository,
    private readonly secrets: SecretStore,
    private readonly options: { createId: () => string; now: () => number }
  ) {}

  async initialize(): Promise<void> {
    const loaded = await this.repository.loadConfigurations();
    this.document = loaded ? parseProviderConfigurationDocument(loaded) : { schemaVersion: 2, configurations: [] };
    const selection = await this.repository.loadWorkspaceDefault();
    this.workspaceDefault = selection && this.isAvailable(selection) ? { ...selection } : undefined;
  }

  list(): ProviderConfiguration[] {
    return structuredClone(this.document.configurations);
  }

  get(providerId: string): ProviderConfiguration | undefined {
    const found = this.document.configurations.find(item => item.id === providerId);
    return found && structuredClone(found);
  }

  async create(input: ProviderConfigurationInput, apiKey?: string): Promise<ProviderConfiguration> {
    const configuration = createProviderConfiguration(this.options.createId(), this.options.now(), input);
    const key = providerSecretKey(configuration.id);
    if (configuration.credential.source === 'secretStorage') {
      if (!apiKey?.trim()) throw new Error('API key is required for SecretStorage credentials.');
      await this.secrets.set(key, apiKey.trim());
    } else if (apiKey !== undefined) {
      throw new Error('API key is only accepted for SecretStorage credentials.');
    }
    const next = parseProviderConfigurationDocument(this.document);
    next.configurations.push(configuration);
    try {
      await this.repository.saveConfigurations(next);
    } catch (error) {
      if (configuration.credential.source === 'secretStorage') await this.secrets.delete(key).catch(() => undefined);
      throw error;
    }
    this.document = next;
    return structuredClone(configuration);
  }

  async remove(providerId: string): Promise<void> {
    const existing = this.document.configurations.find(item => item.id === providerId);
    if (!existing) return;
    const next = parseProviderConfigurationDocument(this.document);
    next.configurations = next.configurations.filter(item => item.id !== providerId);
    await this.repository.saveConfigurations(next);
    this.document = next;
    if (this.workspaceDefault?.providerId === providerId) {
      await this.repository.saveWorkspaceDefault(undefined);
      this.workspaceDefault = undefined;
    }
    await this.secrets.delete(providerSecretKey(providerId));
  }

  async setWorkspaceDefault(selection: SessionModelSelection | undefined): Promise<void> {
    if (selection && !this.isAvailable(selection)) throw new Error('Provider/model selection is unavailable.');
    await this.repository.saveWorkspaceDefault(selection);
    this.workspaceDefault = selection && { ...selection };
  }

  getWorkspaceDefault(): SessionModelSelection | undefined {
    return this.workspaceDefault && { ...this.workspaceDefault };
  }

  resolveSelection(sessionSelection: SessionModelSelection): SessionModelSelection | undefined {
    if (sessionSelection.providerId || sessionSelection.modelId) {
      return this.isAvailable(sessionSelection) ? { ...sessionSelection } : undefined;
    }
    return this.workspaceDefault && this.isAvailable(this.workspaceDefault) ? { ...this.workspaceDefault } : undefined;
  }

  async hasSecretKey(providerId: string): Promise<boolean> {
    const configuration = this.document.configurations.find(item => item.id === providerId);
    if (!configuration || configuration.credential.source !== 'secretStorage') return false;
    return !!(await this.secrets.get(providerSecretKey(providerId)));
  }

  // Reads a stored secret without ever sending it to a Webview. Only used by
  // extension-host code (test connection / refresh / request routing).
  async getSecretKey(providerId: string): Promise<string | undefined> {
    const configuration = this.document.configurations.find(item => item.id === providerId);
    if (!configuration || configuration.credential.source !== 'secretStorage') return undefined;
    return this.secrets.get(providerSecretKey(providerId));
  }

  async updateProvider(
    providerId: string,
    patch: Partial<ProviderConfigurationInput>,
    apiKey?: string
  ): Promise<ProviderConfiguration> {
    const next = parseProviderConfigurationDocument(this.document);
    const index = next.configurations.findIndex(item => item.id === providerId);
    if (index < 0) throw new Error('Provider not found.');
    const existing = next.configurations[index];
    const merged = createProviderConfiguration(providerId, existing.createdAt, {
      kind: existing.kind,
      name: patch.name ?? existing.name,
      baseUrl: patch.baseUrl ?? existing.baseUrl,
      credential: patch.credential ?? existing.credential,
      models: patch.models ?? existing.models,
      capabilities: patch.capabilities ?? existing.capabilities
    });
    merged.updatedAt = this.options.now();
    next.configurations[index] = merged;
    await this.repository.saveConfigurations(next);
    this.document = next;
    if (apiKey !== undefined && merged.credential.source === 'secretStorage') {
      await this.secrets.set(providerSecretKey(providerId), apiKey);
    }
    return structuredClone(merged);
  }

  async replaceModels(providerId: string, models: string[]): Promise<ProviderConfiguration> {
    const normalized = [...new Set(models.map(model => model.trim()).filter(Boolean))];
    return this.updateProvider(providerId, { models: normalized });
  }

  private isAvailable(selection: SessionModelSelection): boolean {
    const provider = this.document.configurations.find(item => item.id === selection.providerId);
    return provider?.models.includes(selection.modelId) ?? false;
  }
}

export function providerSecretKey(providerId: string): string {
  return `yisiAI.provider.${providerId}.apiKey`;
}

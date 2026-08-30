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
  private document: ProviderConfigurationDocument = { schemaVersion: 1, configurations: [] };
  private workspaceDefault?: SessionModelSelection;

  constructor(
    private readonly repository: ProviderConfigurationRepository,
    private readonly secrets: SecretStore,
    private readonly options: { createId: () => string; now: () => number }
  ) {}

  async initialize(): Promise<void> {
    const loaded = await this.repository.loadConfigurations();
    this.document = loaded ? parseProviderConfigurationDocument(loaded) : { schemaVersion: 1, configurations: [] };
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

  private isAvailable(selection: SessionModelSelection): boolean {
    const provider = this.document.configurations.find(item => item.id === selection.providerId);
    return provider?.models.includes(selection.modelId) ?? false;
  }
}

export function providerSecretKey(providerId: string): string {
  return `yisiAI.provider.${providerId}.apiKey`;
}

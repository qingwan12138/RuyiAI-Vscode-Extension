import { ProviderConfigurationDocument, parseModelSelection, parseProviderConfigurationDocument } from '../../domain/providerConfiguration';
import { SessionModelSelection } from '../../domain/session';
import { ProviderConfigurationRepository } from '../../application/provider/providerConfigurationRepository';

export const PROVIDER_CONFIGURATIONS_KEY = 'yisiAI.providerConfigurations.v1';
export const WORKSPACE_DEFAULT_KEY = 'yisiAI.workspaceProviderDefault.v1';

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export class VsCodeProviderConfigurationRepository implements ProviderConfigurationRepository {
  constructor(
    private readonly globalState: MementoLike,
    private readonly workspaceState: MementoLike
  ) {}

  async loadConfigurations(): Promise<ProviderConfigurationDocument | undefined> {
    const value = this.globalState.get<unknown>(PROVIDER_CONFIGURATIONS_KEY);
    return value === undefined ? undefined : parseProviderConfigurationDocument(value);
  }

  async saveConfigurations(document: ProviderConfigurationDocument): Promise<void> {
    await this.globalState.update(PROVIDER_CONFIGURATIONS_KEY, parseProviderConfigurationDocument(document));
  }

  async loadWorkspaceDefault(): Promise<SessionModelSelection | undefined> {
    return parseModelSelection(this.workspaceState.get<unknown>(WORKSPACE_DEFAULT_KEY));
  }

  async saveWorkspaceDefault(selection: SessionModelSelection | undefined): Promise<void> {
    await this.workspaceState.update(WORKSPACE_DEFAULT_KEY, selection ? { ...selection } : undefined);
  }
}

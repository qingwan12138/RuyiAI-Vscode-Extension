import { ProviderConfiguration } from '../../domain/providerConfiguration';
import { LLMProvider } from '../../llm/types';
import { ProviderConfigurationService, providerSecretKey } from './providerConfigurationService';
import { SecretStore } from './secretStore';

export interface ProviderFactory {
  create(configuration: ProviderConfiguration, apiKey?: string): LLMProvider;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderCatalog {
  constructor(
    private readonly configurations: Pick<ProviderConfigurationService, 'get'>,
    private readonly secrets: Pick<SecretStore, 'get'>,
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly factory: ProviderFactory
  ) {}

  async resolve(providerId: string): Promise<LLMProvider> {
    const configuration = this.configurations.get(providerId);
    if (!configuration) throw new ProviderUnavailableError('The selected provider is unavailable.');

    let apiKey: string | undefined;
    if (configuration.credential.source === 'secretStorage') {
      apiKey = await this.secrets.get(providerSecretKey(providerId));
    } else if (configuration.credential.source === 'environment') {
      apiKey = this.environment[configuration.credential.variableName];
    }
    if (configuration.credential.source !== 'none' && !apiKey?.trim()) {
      throw new ProviderUnavailableError('The selected provider credential is unavailable.');
    }
    return this.factory.create(configuration, apiKey?.trim());
  }
}

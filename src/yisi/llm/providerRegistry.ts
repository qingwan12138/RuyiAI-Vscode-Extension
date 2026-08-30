import * as vscode from 'vscode';
import { LLMProvider } from './types';

export class ProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  constructor(private readonly secrets: vscode.SecretStorage) {}

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): LLMProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.secrets.store(`yisiAI.provider.${providerId}.apiKey`, apiKey);
  }

  async getApiKey(providerId: string): Promise<string | undefined> {
    return this.secrets.get(`yisiAI.provider.${providerId}.apiKey`);
  }
}

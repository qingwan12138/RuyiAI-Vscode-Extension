import { SecretStore } from '../../application/provider/secretStore';

export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export class VsCodeSecretStore implements SecretStore {
  constructor(private readonly storage: SecretStorageLike) {}

  async get(key: string): Promise<string | undefined> {
    return this.storage.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.storage.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}

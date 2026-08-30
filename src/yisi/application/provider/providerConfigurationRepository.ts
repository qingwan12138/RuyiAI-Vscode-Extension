import { ProviderConfigurationDocument } from '../../domain/providerConfiguration';
import { SessionModelSelection } from '../../domain/session';

export interface ProviderConfigurationRepository {
  loadConfigurations(): Promise<ProviderConfigurationDocument | undefined>;
  saveConfigurations(document: ProviderConfigurationDocument): Promise<void>;
  loadWorkspaceDefault(): Promise<SessionModelSelection | undefined>;
  saveWorkspaceDefault(selection: SessionModelSelection | undefined): Promise<void>;
}

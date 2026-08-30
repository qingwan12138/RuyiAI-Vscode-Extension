import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { ProviderConfigurationService } from './application/provider/providerConfigurationService';
import { LegacySessionMetadata, SessionService } from './application/session/sessionService';
import { ProviderFactory } from './application/provider/providerCatalog';
import { OpenAICompatibleProvider } from './infrastructure/llm/openAICompatibleProvider';
import { JsonSessionRepository } from './infrastructure/persistence/jsonSessionRepository';
import { YisiChatViewProvider } from './ui/chatViewProvider';
import { ProviderSetupWizard } from './vscode/provider/providerSetupWizard';
import { VsCodeProviderConfigurationRepository } from './vscode/provider/vsCodeProviderConfigurationRepository';
import { VsCodeSecretStore } from './vscode/provider/vsCodeSecretStore';

const LEGACY_STORAGE_KEY = 'yisiAI.sessions.v1';

export async function registerYisiAI(context: vscode.ExtensionContext): Promise<void> {
  const repository = new JsonSessionRepository(context.globalStorageUri.fsPath);
  const sessions = new SessionService(repository);
  const legacySessions = context.workspaceState.get<LegacySessionMetadata[]>(LEGACY_STORAGE_KEY, []);
  const initialization = await sessions.initialize(getWorkspaceId(), legacySessions);
  if (initialization.importedLegacy) {
    await context.workspaceState.update(LEGACY_STORAGE_KEY, undefined);
  }
  const secrets = new VsCodeSecretStore(context.secrets);
  const providerConfigurations = new ProviderConfigurationService(
    new VsCodeProviderConfigurationRepository(context.globalState, context.workspaceState),
    secrets,
    { createId: randomUUID, now: Date.now }
  );
  await providerConfigurations.initialize();
  const providerFactory: ProviderFactory = {
    create: (configuration, apiKey) => new OpenAICompatibleProvider({
      id: configuration.id,
      baseUrl: configuration.baseUrl,
      apiKey
    })
  };
  const providerSetup = new ProviderSetupWizard(
    providerConfigurations,
    sessions,
    providerFactory,
    process.env
  );
  const chatView = new YisiChatViewProvider(context.extensionUri, sessions, providerSetup);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('yisiAI.chat', chatView),
    vscode.commands.registerCommand('yisiAI.newChat', () => chatView.newSession()),
    vscode.commands.registerCommand('yisiAI.openSettings', () => chatView.openModelSettings()),
    vscode.commands.registerCommand('yisiAI.stop', () => chatView.stopCurrentRun()),
    vscode.commands.registerCommand('yisiAI.continue', () => chatView.continueCurrentSession())
  );
}

function getWorkspaceId(): string {
  if (vscode.workspace.workspaceFile) {
    return vscode.workspace.workspaceFile.toString();
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.length > 0
    ? folders.map(folder => folder.uri.toString()).sort().join('|')
    : 'no-workspace';
}

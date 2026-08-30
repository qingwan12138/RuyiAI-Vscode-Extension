import * as vscode from 'vscode';
import { SessionStore } from './session/sessionStore';
import { PermissionEngine } from './permissions/permissionEngine';
import { ProviderRegistry } from './llm/providerRegistry';
import { YisiChatViewProvider } from './ui/chatViewProvider';

export async function registerYisiAI(context: vscode.ExtensionContext): Promise<void> {
  const sessions = new SessionStore(context);
  const permissions = new PermissionEngine();
  const providers = new ProviderRegistry(context.secrets);
  const chatView = new YisiChatViewProvider(context.extensionUri, sessions, permissions, providers);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('yisiAI.chat', chatView),
    vscode.commands.registerCommand('yisiAI.newChat', () => chatView.newSession()),
    vscode.commands.registerCommand('yisiAI.openSettings', () => chatView.openModelSettings()),
    vscode.commands.registerCommand('yisiAI.stop', () => chatView.stopCurrentRun()),
    vscode.commands.registerCommand('yisiAI.continue', () => chatView.continueCurrentSession())
  );
}

import * as vscode from 'vscode';
import { createChatViewHtml } from './chatViewHtml';
import { SessionService } from '../application/session/sessionService';
import { WebviewMessage, parseWebviewMessage } from './webviewProtocol';
import { ProviderSetupWizard } from '../vscode/provider/providerSetupWizard';
import { ChatService, ExplicitFileContext } from '../application/chat/chatService';
import { ChatRunCoordinator } from './chatRunCoordinator';
import { ExplicitContextPicker } from '../application/context/explicitContextPicker';

export class YisiChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private readonly runs: ChatRunCoordinator;
  private readonly pendingContexts = new Map<string, ExplicitFileContext[]>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionService,
    private readonly providerSetup: ProviderSetupWizard,
    chat: ChatService,
    private readonly contextPicker: ExplicitContextPicker
  ) {
    this.runs = new ChatRunCoordinator(chat, event => {
      void this.view?.webview.postMessage(event);
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    // Suppress the redundant VS Code view title so our session navigation
    // becomes the first visible row in the sidebar.
    view.title = '';
    view.description = undefined;
    this.disposeViewListeners();

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    view.webview.html = createChatViewHtml(view.webview, this.extensionUri);

    this.disposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => this.receiveMessage(message)),
      view.onDidDispose(() => {
        this.disposeViewListeners();
        this.view = undefined;
      })
    );
  }

  async newSession(): Promise<void> {
    if (!this.requireIdle()) return;
    await this.sessions.createSession();
    await this.providerSetup.applyWorkspaceDefaultToActiveSession();
    await this.publishState();
  }

  async openModelSettings(): Promise<void> {
    await this.providerSetup.run();
    await this.publishState();
  }

  stopCurrentRun(): void {
    if (!this.runs.stop()) {
      void this.view?.webview.postMessage({ type: 'runStopped' });
    }
  }

  continueCurrentSession(): void {
    void this.view?.webview.postMessage({ type: 'continueRequested' });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.publishState();
        return;

      case 'newChat':
        await this.newSession();
        return;

      case 'switchSession':
        if (!this.requireIdle()) return;
        await this.sessions.switchSession(message.sessionId);
        await this.publishState();
        return;

      case 'renameSession':
        await this.sessions.renameSession(message.sessionId, message.title);
        await this.publishState();
        return;

      case 'deleteSession':
        if (!this.requireIdle()) return;
        await this.sessions.deleteSession(message.sessionId);
        this.pendingContexts.delete(message.sessionId);
        await this.publishState();
        return;

      case 'openSettings':
        if (!this.requireIdle()) return;
        await this.openModelSettings();
        return;

      case 'selectModel':
        if (!this.requireIdle()) return;
        await this.providerSetup.pickModelForSession();
        await this.publishState();
        return;

      case 'selectPermission':
        await vscode.window.showInformationMessage(
          'Permission mode UI is connected. The full selector will be implemented with the Permission Engine milestone.'
        );
        return;

      case 'addContext':
        if (!this.requireIdle()) return;
        await this.addFileContext();
        return;

      case 'clearContext':
        if (!this.requireIdle()) return;
        this.pendingContexts.delete(this.sessions.getActiveSession().id);
        await this.publishContextState();
        return;

      case 'sendMessage': {
        void this.runChat(message.text);
        return;
      }

      case 'stop':
        this.stopCurrentRun();
        return;

      case 'continue':
        this.continueCurrentSession();
        return;
    }
  }

  private async runChat(text: string): Promise<void> {
    const sessionId = this.sessions.getActiveSession().id;
    const contexts = this.pendingContexts.get(sessionId) ?? [];
    this.pendingContexts.delete(sessionId);
    await this.publishContextState();
    await this.runs.start(text, contexts);
    await this.publishState();
  }

  private async addFileContext(): Promise<void> {
    const context = await this.contextPicker.pickFile();
    if (!context) return;
    const sessionId = this.sessions.getActiveSession().id;
    const existing = this.pendingContexts.get(sessionId) ?? [];
    const next = existing.filter(item => (
      item.reference.path !== context.reference.path
      || item.reference.workspaceFolderUri !== context.reference.workspaceFolderUri
    ));
    next.push(context);
    this.pendingContexts.set(sessionId, next.slice(-4));
    await this.publishContextState();
  }

  private requireIdle(): boolean {
    if (!this.runs.isRunning()) return true;
    void this.view?.webview.postMessage({
      type: 'sessionError',
      message: 'Stop the current run before changing sessions or models.'
    });
    return false;
  }

  private async receiveMessage(value: unknown): Promise<void> {
    try {
      await this.handleMessage(parseWebviewMessage(value));
    } catch (error: unknown) {
      const diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown session error';
      console.error(`[Yisi AI] ${diagnostic}`);
      await this.view?.webview.postMessage({
        type: 'sessionError',
        message: 'Yisi AI could not complete that session action. Previously saved session data remains available.'
      });
    }
  }

  private async publishState(): Promise<void> {
    await this.view?.webview.postMessage({
      type: 'sessionState',
      sessions: this.sessions.listSessions(),
      activeSession: this.sessions.getActiveSession()
    });
    await this.publishContextState();
  }

  private async publishContextState(): Promise<void> {
    const sessionId = this.sessions.getActiveSession().id;
    await this.view?.webview.postMessage({
      type: 'contextState',
      contexts: (this.pendingContexts.get(sessionId) ?? []).map(context => context.reference)
    });
  }

  private disposeViewListeners(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}

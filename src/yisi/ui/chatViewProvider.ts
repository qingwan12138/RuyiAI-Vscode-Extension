import * as vscode from 'vscode';
import { createChatViewHtml } from './chatViewHtml';
import { SessionService } from '../application/session/sessionService';
import { WebviewMessage, parseWebviewMessage } from './webviewProtocol';

const BASELINE_ASSISTANT_NOTICE = 'Message saved. A model provider is not connected yet, so Yisi AI has not generated a response.';

export class YisiChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionService
  ) {}

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
    await this.sessions.createSession();
    await this.publishState();
  }

  async openModelSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'Yisi AI');
  }

  stopCurrentRun(): void {
    void this.view?.webview.postMessage({ type: 'runStopped' });
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
        await this.sessions.switchSession(message.sessionId);
        await this.publishState();
        return;

      case 'renameSession':
        await this.sessions.renameSession(message.sessionId, message.title);
        await this.publishState();
        return;

      case 'deleteSession':
        await this.sessions.deleteSession(message.sessionId);
        await this.publishState();
        return;

      case 'openSettings':
      case 'selectModel':
        await this.openModelSettings();
        return;

      case 'selectPermission':
        await vscode.window.showInformationMessage(
          'Permission mode UI is connected. The full selector will be implemented with the Permission Engine milestone.'
        );
        return;

      case 'addContext':
        await vscode.window.showInformationMessage(
          'Context picker placeholder: @file / @folder / @symbol will be connected in the Context Engine milestone.'
        );
        return;

      case 'sendMessage': {
        await this.sessions.appendUserMessage(message.text);
        await this.sessions.appendAssistantMessage(BASELINE_ASSISTANT_NOTICE, 'baseline');
        await this.publishState();
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
  }

  private disposeViewListeners(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}

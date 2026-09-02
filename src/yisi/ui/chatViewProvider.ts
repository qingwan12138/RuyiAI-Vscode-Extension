import * as vscode from 'vscode';
import { createChatViewHtml } from './chatViewHtml';
import { SessionService } from '../application/session/sessionService';
import { WebviewMessage, parseWebviewMessage } from './webviewProtocol';
import { ProviderSetupWizard } from '../vscode/provider/providerSetupWizard';
import { ChatService, ExplicitFileContext } from '../application/chat/chatService';
import { ChatRunCoordinator } from './chatRunCoordinator';
import { AttachmentContextPicker } from '../application/context/explicitContextPicker';
import { AttachmentOutcome } from '../application/attachment/attachmentService';
import { ATTACHMENT_LIMITS } from '../context/attachment/attachmentTypes';
import { ModelControlService } from '../application/modelControl/modelControlService';
import type { PermissionMode } from '../domain/session';

export class YisiChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private readonly runs: ChatRunCoordinator;
  private readonly pendingContexts = new Map<string, AttachmentOutcome[]>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionService,
    private readonly providerSetup: ProviderSetupWizard,
    chat: ChatService,
    private readonly contextPicker: AttachmentContextPicker,
    private readonly modelControl: ModelControlService
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
        try {
          await this.sessions.renameSession(message.sessionId, message.title);
          await this.publishState();
        } catch (error) {
          this.reportSessionError('Failed to rename session.', error);
        }
        return;

      case 'deleteSession':
        if (!this.requireIdle()) return;
        try {
          await this.sessions.deleteSession(message.sessionId);
          this.pendingContexts.delete(message.sessionId);
          await this.publishState();
        } catch (error) {
          this.reportSessionError('Failed to delete session.', error);
        }
        return;

      case 'openSettings':
        if (!this.requireIdle()) return;
        await this.openModelSettings();
        return;

      case 'modelControl.selectModel':
        if (!this.requireIdle()) return;
        await this.applyModelSelection(message.providerId, message.modelId);
        await this.publishState();
        return;

      case 'modelControl.setReasoning':
        if (!this.requireIdle()) return;
        await this.sessions.setReasoningEffort(message.value);
        await this.publishState();
        return;

      case 'modelControl.setSpeed':
        if (!this.requireIdle()) return;
        await this.sessions.setSpeedMode(message.value);
        await this.publishState();
        return;

      case 'modelControl.setTemperature':
        if (!this.requireIdle()) return;
        await this.sessions.setTemperature(message.value);
        await this.publishState();
        return;

      case 'modelControl.setMaxTokens':
        if (!this.requireIdle()) return;
        await this.sessions.setMaxTokens(message.value);
        await this.publishState();
        return;

      case 'permission.setMode':
        if (!this.requireIdle()) return;
        await this.applyPermissionMode(message.value);
        await this.publishState();
        return;

      case 'addContext':
        if (!this.requireIdle()) return;
        await this.addFileContext();
        return;

      case 'removeAttachment':
        if (!this.requireIdle()) return;
        this.removeAttachment(message.attachmentId);
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
    const contexts: ExplicitFileContext[] = (this.pendingContexts.get(sessionId) ?? [])
      .flatMap(outcome => outcome.context ? [outcome.context as ExplicitFileContext] : []);
    this.pendingContexts.delete(sessionId);
    await this.publishContextState();
    await this.runs.start(text, contexts);
    await this.publishState();
  }

  private async addFileContext(): Promise<void> {
    const outcomes = await this.contextPicker.pickAttachments();
    if (outcomes.length === 0) return;
    const sessionId = this.sessions.getActiveSession().id;
    const existing = this.pendingContexts.get(sessionId) ?? [];
    const addedKeys = new Set(outcomes.map(attachmentKey));
    const kept = existing.filter(item => !addedKeys.has(attachmentKey(item)));
    const next = [...kept, ...outcomes];
    this.pendingContexts.set(sessionId, next.slice(-ATTACHMENT_LIMITS.maxAttachmentsPerSession));
    await this.publishContextState();
  }

  private removeAttachment(attachmentId: string): void {
    const sessionId = this.sessions.getActiveSession().id;
    const existing = this.pendingContexts.get(sessionId);
    if (!existing) return;
    this.pendingContexts.set(sessionId, existing.filter(item => item.view.id !== attachmentId));
    void this.publishContextState();
  }

  private async applyPermissionMode(mode: PermissionMode): Promise<void> {
    const active = this.sessions.getActiveSession();
    if (mode === 'fullAccess' && active.permissionMode !== 'fullAccess') {
      const choice = await vscode.window.showWarningMessage(
        'Enable Full Access for this session?',
        { modal: true, detail: 'Yisi may perform broad workspace and terminal actions without routine approval. Critical safety confirmations remain.' },
        'Enable Full Access',
        'Cancel'
      );
      if (choice !== 'Enable Full Access') return;
    }
    await this.sessions.setPermissionMode(mode);
  }

  private async applyModelSelection(providerId: string, modelId: string): Promise<void> {
    const current = this.sessions.getActiveSession().model;
    await this.sessions.setModelSelection({ ...current, providerId, modelId });
  }

  private requireIdle(): boolean {
    if (!this.runs.isRunning()) return true;
    void this.view?.webview.postMessage({
      type: 'sessionError',
      message: 'Stop the current run before changing sessions or models.'
    });
    return false;
  }

  /** Surface a specific operation error (rename/delete) instead of the generic
   * session fallback, while still logging the real cause to the Output channel. */
  private reportSessionError(message: string, error: unknown): void {
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown session error';
    console.error(`[Yisi AI] ${diagnostic}`);
    void this.view?.webview.postMessage({ type: 'sessionError', message });
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
    await this.view?.webview.postMessage({
      type: 'modelControl.state',
      state: await this.modelControl.getState()
    });
  }

  private async publishContextState(): Promise<void> {
    const sessionId = this.sessions.getActiveSession().id;
    await this.view?.webview.postMessage({
      type: 'contextState',
      contexts: (this.pendingContexts.get(sessionId) ?? []).map(outcome => outcome.view)
    });
  }

  private disposeViewListeners(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}

/** Stable identity for a pending attachment used for de-duplication. */
function attachmentKey(outcome: AttachmentOutcome): string {
  return `${outcome.view.workspaceFolderUri}|${outcome.view.relativePath}`;
}

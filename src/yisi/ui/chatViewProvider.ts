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
import type { ContextUsageState } from '../application/context/contextUsage';
import type { ChatRunOutcome } from './chatRunCoordinator';
import { ApprovalBroker } from '../application/agent/approvalBroker';
import { createSecretRedactor } from '../application/security/secretRedactor';

const redactor = createSecretRedactor();
import {
  EditorSelectionTaskKind,
  buildSelectionTaskMessage
} from '../application/chat/editorSelectionTask';
import {
  ProjectDocTaskKind,
  buildProjectDocTaskMessage
} from '../application/chat/projectDocTask';
import { collectActiveEditorSelection } from '../vscode/selection/editorSelectionTaskAdapter';

export type { EditorSelectionTaskKind } from '../application/chat/editorSelectionTask';

/** Optional source of detected project build/test context for selection tasks. */
export interface ProjectProfileSource {
  inspect(): Promise<string>;
}

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
    private readonly modelControl: ModelControlService,
    private readonly approvals: ApprovalBroker,
    private readonly projectProfile?: ProjectProfileSource,
    private readonly contextUsage?: () => Promise<ContextUsageState | null>,
    private readonly ruyiInspect?: () => Promise<string | null>
  ) {
    this.runs = new ChatRunCoordinator(chat, event => {
      void this.view?.webview.postMessage(event);
    });
  }

  /** v0.5 Ruyi operation surface: reveal the chat and show the Ruyi env summary. */
  async runRuyiCheck(): Promise<void> {
    void vscode.commands.executeCommand('yisiAI.chat.focus');
    try {
      const summary = await this.ruyiInspect?.();
      if (!summary) {
        await vscode.window.showInformationMessage('Yisi AI: Ruyi CLI 不可用，或未安装。');
        return;
      }
      await vscode.window.showInformationMessage(`Yisi AI · Ruyi 环境\n${summary}`);
    } catch (error) {
      await vscode.window.showWarningMessage(
        'Yisi AI: Ruyi 环境检查失败。' + (error instanceof Error ? ` ${error.message}` : '')
      );
    }
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

    // Route privileged tool approvals into this webview (the sidebar prompt).
    this.approvals.attachPost(message => {
      void this.view?.webview.postMessage(message);
    });

    this.disposables.push(
      view.webview.onDidReceiveMessage((message: unknown) => this.receiveMessage(message)),
      view.onDidDispose(() => {
        this.disposeViewListeners();
        this.approvals.detachPost();
        // Fail any approval still waiting on a now-gone view so the agent run
        // does not hang on an unanswerable prompt.
        this.approvals.cancelAll();
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

  /**
   * Soft resume: after a VS Code reload/interrupt that left a session running or
   * interrupted, offer to re-run its last user message. Never restores a
   * long-lived process automatically (per AGENTS.md) — this only re-sends the
   * last prompt through the normal, permission-gated pipeline.
   */
  async resumeUnfinished(): Promise<void> {
    const unfinished = this.sessions.listSessions().find(
      summary => summary.status === 'running' || summary.status === 'interrupted'
    );
    if (!unfinished) return;
    if (this.runs.isRunning()) {
      await vscode.window.showInformationMessage('Yisi AI: 请先停止当前运行，再继续上次的任务。');
      return;
    }
    if (this.sessions.getActiveSession().id !== unfinished.id) {
      await this.sessions.switchSession(unfinished.id);
    }
    await this.publishState();
    await this.resendLastMessage();
  }

  /** Re-run the last user message in the active session through runChat. */
  async resendLastMessage(): Promise<void> {
    if (this.runs.isRunning()) {
      await vscode.window.showInformationMessage('Yisi AI: 请先停止当前运行。');
      return;
    }
    const active = this.sessions.getActiveSession();
    if (!active.model.providerId || !active.model.modelId) {
      const action = await vscode.window.showInformationMessage(
        'Yisi AI: 当前会话尚未选择模型，无法继续。',
        '打开模型设置',
        '取消'
      );
      if (action === '打开模型设置') await this.openModelSettings();
      return;
    }
    const lastUser = [...active.items].reverse().find(item => item.type === 'userMessage');
    if (!lastUser || typeof lastUser.text !== 'string' || !lastUser.text.trim()) {
      await vscode.window.showInformationMessage('Yisi AI: 当前会话没有可重发的消息。');
      return;
    }
    await this.runChat(lastUser.text);
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

  /**
   * Entry point for the editor selection commands (context menu / palette).
   * Collects the active editor selection, verifies an idle session with a
   * configured model, then starts the same chat/agent run the composer uses so
   * the assistant answer and any tool activity persist into the active session.
   * If the Chat view is not open yet the reply is still persisted and appears
   * when the panel is revealed (streaming deltas are best-effort).
   */
  async runEditorSelectionTask(kind: EditorSelectionTaskKind): Promise<void> {
    const context = collectActiveEditorSelection();
    if (!context) {
      await vscode.window.showWarningMessage(
        'Yisi AI: 请先在编辑器中选中一段代码，再执行该选区任务。'
      );
      return;
    }
    if (this.runs.isRunning()) {
      await vscode.window.showInformationMessage(
        'Yisi AI: 请先停止当前运行，再发起新的选区任务。'
      );
      return;
    }
    const active = this.sessions.getActiveSession();
    if (!active.model.providerId || !active.model.modelId) {
      const action = await vscode.window.showInformationMessage(
        'Yisi AI: 当前会话尚未选择模型，无法运行选区任务。',
        '打开模型设置',
        '取消'
      );
      if (action === '打开模型设置') {
        await this.openModelSettings();
      }
      return;
    }
    // Best-effort reveal so the user sees the turn stream when the view can
    // resolve in time; a late resolve still converges through publishState.
    void vscode.commands.executeCommand('yisiAI.chat.focus');
    // Unit-test tasks benefit from detected project build/test context. The
    // profile source is best-effort: any failure degrades to no project block.
    let projectSummary: string | undefined;
    if (kind === 'unitTests' && this.projectProfile) {
      try {
        projectSummary = await this.projectProfile.inspect();
      } catch {
        projectSummary = undefined;
      }
    }
    const outcome = await this.runs.start(buildSelectionTaskMessage(kind, context, projectSummary));
    await this.publishState();
    this.surfaceRunOutcome(outcome);
  }

  /**
   * Entry point for the project-scope documentation commands (README / API
   * docs). Requires an idle session with a configured model; runs the same
   * chat/agent pipeline as the composer with project detection context so the
   * model can target the real build/test setup. Persists into the active
   * session like any other turn.
   */
  async runProjectDocTask(kind: ProjectDocTaskKind): Promise<void> {
    if (this.runs.isRunning()) {
      await vscode.window.showInformationMessage(
        'Yisi AI: 请先停止当前运行，再发起新的项目任务。'
      );
      return;
    }
    const active = this.sessions.getActiveSession();
    if (!active.model.providerId || !active.model.modelId) {
      const action = await vscode.window.showInformationMessage(
        'Yisi AI: 当前会话尚未选择模型，无法运行项目任务。',
        '打开模型设置',
        '取消'
      );
      if (action === '打开模型设置') {
        await this.openModelSettings();
      }
      return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    const projectName = vscode.workspace.name
      ?? (folders.length > 0 ? folders[0].name : undefined)
      ?? 'workspace';
    const fileName = folders.length > 0 ? folders[0].uri.fsPath : 'no-workspace-folder';
    let projectSummary: string | undefined;
    if (this.projectProfile) {
      try {
        projectSummary = await this.projectProfile.inspect();
      } catch {
        projectSummary = undefined;
      }
    }
    void vscode.commands.executeCommand('yisiAI.chat.focus');
    const outcome = await this.runs.start(buildProjectDocTaskMessage(kind, { projectName, fileName }, projectSummary));
    await this.publishState();
    this.surfaceRunOutcome(outcome);
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

      case 'toolApprovalResponse':
        // Answers the Agent-loop approval prompt rendered in this webview.
        this.approvals.resolve(message.requestId, message.approved);
        return;

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
    const runOutcome = await this.runs.start(text, contexts);
    await this.publishState();
    this.surfaceRunOutcome(runOutcome);
  }

  /**
   * Run errors are surfaced only AFTER publishState: the webview rebuilds its
   * conversation from the persisted session state on every state push, so an
   * error posted before that push would be wiped before the user sees it.
   */
  private surfaceRunOutcome(outcome: ChatRunOutcome): void {
    if (outcome.status !== 'error') return;
    void this.view?.webview.postMessage({ type: 'sessionError', message: outcome.message });
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
    console.error(`[Yisi AI] ${redactor.censor(diagnostic)}`);
    void this.view?.webview.postMessage({ type: 'sessionError', message });
  }

  private async receiveMessage(value: unknown): Promise<void> {
    try {
      await this.handleMessage(parseWebviewMessage(value));
    } catch (error: unknown) {
      const diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown session error';
      console.error(`[Yisi AI] ${redactor.censor(diagnostic)}`);
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
    let usage: ContextUsageState | null = null;
    try {
      usage = (await this.contextUsage?.()) ?? null;
    } catch {
      usage = null;
    }
    await this.view?.webview.postMessage({ type: 'contextUsage', usage });
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

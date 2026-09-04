import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { ProviderConfigurationService } from './application/provider/providerConfigurationService';
import { ChatService } from './application/chat/chatService';
import { LegacySessionMetadata, SessionService } from './application/session/sessionService';
import { ProviderCatalog, ProviderFactory } from './application/provider/providerCatalog';
import { OpenAICompatibleProvider } from './infrastructure/llm/openAICompatibleProvider';
import { AnthropicProvider } from './infrastructure/llm/anthropicProvider';
import { JsonSessionRepository } from './infrastructure/persistence/jsonSessionRepository';
import { YisiChatViewProvider } from './ui/chatViewProvider';
import { ModelControlService } from './application/modelControl/modelControlService';
import { ProviderSetupWizard } from './vscode/provider/providerSetupWizard';
import { VsCodeProviderConfigurationRepository } from './vscode/provider/vsCodeProviderConfigurationRepository';
import { VsCodeSecretStore } from './vscode/provider/vsCodeSecretStore';
import { VsCodeWorkspaceContextPicker } from './vscode/context/workspaceContextPicker';
import { VsCodeAttachmentRehydrator } from './vscode/context/attachmentRehydrator';
import { AttachmentService } from './application/attachment/attachmentService';
import { createDefaultAttachmentRegistry } from './infrastructure/attachment/defaultAttachmentRegistry';
import { selectLocalAgentWorkspace } from './vscode/context/localAgentWorkspace';
import { NodeWorkspaceFileSystem } from './infrastructure/context/nodeWorkspaceFileSystem';
import { WorkspaceContextService, createWorkspaceContextTools } from './application/context/workspaceContextService';
import { ToolRegistry } from './application/agent/toolRegistry';
import { PermissionEngine } from './permissions/permissionEngine';
import { AgentChatRunner } from './application/agent/agentChatRunner';
import {
  WorkspaceEditService,
  createWorkspaceEditTool,
  createWorkspaceFileTool,
  createWorkspaceRewriteTool,
  createWorkspaceDeleteTool,
  createWorkspaceRenameTool,
  createWorkspaceDirectoryTool,
  createUndoLastEditTool
} from './application/edit/workspaceEditService';
import {
  CommandExecutionService,
  createRunCommandTool
} from './application/process/commandExecutionService';
import { ProjectProfileService, createInspectProjectTool } from './application/context/projectProfileService';
import { ValidationPlannerService, createRunValidationsTool } from './application/validation/validationPlannerService';
import { RuyiInspectionService, createRuyiInspectTool } from './application/ruyi/ruyiInspectionService';
import { RuyiCliAdapter } from './ruyi/ruyiCliAdapter';
import { SymbolLookupService, createListSymbolsTool } from './application/context/symbolLookupService';
import { VsCodeDocumentSymbolProvider } from './vscode/symbols/vsCodeSymbolProvider';
import { EditJournalViewer } from './vscode/editJournalViewer';
import { ContextUsageState, computeContextUsage, estimateTokens, CONTEXT_OVERHEAD_TOKENS } from './application/context/contextUsage';
import { ModelWindowOverride, modelContextWindow } from './domain/modelContextWindow';
import { NodeProcessRunner } from './infrastructure/process/nodeProcessRunner';
import { VsCodeToolConfirmation } from './vscode/agent/vsCodeToolConfirmation';
import { VsCodeDiagnosticProvider } from './vscode/diagnostics/vsCodeDiagnosticProvider';
import type { ProjectProfileSource } from './ui/chatViewProvider';

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
    create: (configuration, apiKey) => {
      const caps = configuration.capabilities;
      if (configuration.kind === 'anthropic') {
        return new AnthropicProvider({
          id: configuration.id,
          baseUrl: configuration.baseUrl,
          apiKey,
          models: configuration.models,
          temperature: caps.temperature,
          maxTokens: caps.maxTokens,
          thinking: caps.reasoning?.mode === 'budget',
          vision: caps.vision
        });
      }
      return new OpenAICompatibleProvider({
        id: configuration.id,
        providerKind: configuration.kind,
        baseUrl: configuration.baseUrl,
        apiKey,
        toolCalling: caps.toolCalling,
        temperature: caps.temperature,
        maxTokens: caps.maxTokens,
        reasoningEffort: caps.reasoning?.mode === 'effort' || caps.reasoningEffort === true,
        vision: caps.vision
      });
    }
  };
  const providerSetup = new ProviderSetupWizard(
    providerConfigurations,
    sessions,
    providerFactory,
    process.env
  );
  await providerSetup.applyWorkspaceDefaultToActiveSession();
  const providerCatalog = new ProviderCatalog(providerConfigurations, secrets, process.env, providerFactory);
  const agentWorkspace = await createAgentWorkspace();
  const modelControl = new ModelControlService(providerConfigurations, sessions, process.env);
  const attachmentService = new AttachmentService(createDefaultAttachmentRegistry(), {
    getVisionCapability: async () => {
      try {
        const model = sessions.getActiveSession().model;
        if (!model.providerId || !model.modelId) {
          return { modelSupported: false, transportSupported: false };
        }
        const provider = await providerCatalog.resolve(model.providerId);
        const capabilities = await provider.capabilities(model.modelId);
        // Two independent gates: the selected model must accept images and the
        // resolved provider adapter must know how to serialize them on the wire.
        return {
          modelSupported: capabilities.vision === true,
          transportSupported: provider.imageInputTransport === true
        };
      } catch {
        return { modelSupported: false, transportSupported: false };
      }
    }
  }, {
    getPdfVisionPagesLimit: () => readPdfVisionPagesLimit()
  });
  const chat = new ChatService(
    sessions,
    providerCatalog,
    agentWorkspace.runner,
    () => {
      const section = vscode.workspace.getConfiguration('yisiAI');
      return {
        enabled: section.get<boolean>('identityBypassEnabled', true),
        extraKeywords: section.get<string[]>('identityBypassKeywords', [])
      };
    },
    new VsCodeAttachmentRehydrator(attachmentService)
  );
  const chatView = new YisiChatViewProvider(
    context.extensionUri,
    sessions,
    providerSetup,
    chat,
    new VsCodeWorkspaceContextPicker(attachmentService),
    modelControl,
    agentWorkspace.profile,
    () => readContextUsage(sessions, providerCatalog, providerConfigurations)
  );
  const yisiStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  yisiStatus.text = '✦ Yisi';
  yisiStatus.tooltip = 'Open Yisi AI';
  yisiStatus.command = 'yisiAI.focus';
  yisiStatus.show();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('yisiAI.chat', chatView),
    vscode.commands.registerCommand('yisiAI.newChat', () => chatView.newSession()),
    vscode.commands.registerCommand('yisiAI.openSettings', () => chatView.openModelSettings()),
    vscode.commands.registerCommand('yisiAI.stop', () => chatView.stopCurrentRun()),
    vscode.commands.registerCommand('yisiAI.continue', () => chatView.continueCurrentSession()),
    vscode.commands.registerCommand('yisiAI.selection.explain', () => chatView.runEditorSelectionTask('explain')),
    vscode.commands.registerCommand('yisiAI.selection.comment', () => chatView.runEditorSelectionTask('comment')),
    vscode.commands.registerCommand('yisiAI.selection.unitTests', () => chatView.runEditorSelectionTask('unitTests')),
    vscode.commands.registerCommand('yisiAI.generateReadme', () => chatView.runProjectDocTask('readme')),
    vscode.commands.registerCommand('yisiAI.generateApiDocs', () => chatView.runProjectDocTask('apiDocs')),
    vscode.commands.registerCommand('yisiAI.showEditJournal', () => showEditJournal(agentWorkspace.edits)),
    vscode.commands.registerCommand('yisiAI.focus', () => revealYisiChat()),
    yisiStatus
  );
}

/** Reveal the Yisi AI chat (status bar / editor-title entry points). */
function revealYisiChat(): void {
  const focusCommand = vscode.commands.executeCommand('yisiAI.chat.focus');
  void focusCommand.then(() => undefined, () => {
    void vscode.commands.executeCommand('workbench.view.extension.yisiAI');
  });
}

interface AgentWorkspaceServices {
  runner?: AgentChatRunner;
  profile?: ProjectProfileSource;
  edits?: WorkspaceEditService;
}

async function createAgentWorkspace(): Promise<AgentWorkspaceServices> {
  const workspace = selectLocalAgentWorkspace(vscode.workspace.workspaceFolders);
  if (!workspace) return {};
  try {
    const fileSystem = await NodeWorkspaceFileSystem.create(workspace.fsPath);
    const diagnostics = new VsCodeDiagnosticProvider({
      getDiagnostics: () => vscode.languages.getDiagnostics(),
      getWorkspaceFolder: uri => vscode.workspace.getWorkspaceFolder(uri as vscode.Uri)
    }, [workspace.uri], 50);
    const edits = new WorkspaceEditService(fileSystem, diagnostics, fileSystem);
    const commands = new CommandExecutionService(new NodeProcessRunner(), workspace.fsPath);
    const profileService = new ProjectProfileService(fileSystem);
    const validationPlanner = new ValidationPlannerService(commands, profileService);
    const ruyiInspection = new RuyiInspectionService(commands, new RuyiCliAdapter());
    const symbols = new SymbolLookupService(workspace.fsPath, new VsCodeDocumentSymbolProvider());
    const tools = [
      ...createWorkspaceContextTools(new WorkspaceContextService(fileSystem)),
      createWorkspaceEditTool(edits),
      createWorkspaceFileTool(edits),
      createWorkspaceRewriteTool(edits),
      createWorkspaceDeleteTool(edits),
      createWorkspaceRenameTool(edits),
      createWorkspaceDirectoryTool(edits),
      createUndoLastEditTool(edits),
      createRunCommandTool(commands),
      createInspectProjectTool(profileService),
      createRunValidationsTool(validationPlanner),
      createRuyiInspectTool(ruyiInspection),
      createListSymbolsTool(symbols)
    ];
    const runner = new AgentChatRunner(
      new ToolRegistry(tools),
      new PermissionEngine(),
      workspace.uri,
      new VsCodeToolConfirmation()
    );
    const profile: ProjectProfileSource = {
      inspect: async () => {
        const inspection = await profileService.inspect();
        return inspection.summary;
      }
    };
    return { runner, profile, edits };
  } catch {
    console.warn('[Yisi AI] Local Agent workspace initialization is unavailable.');
    return {};
  }
}

function showEditJournal(edits?: WorkspaceEditService): void {
  if (!edits) {
    void vscode.window.showInformationMessage(
      'Yisi AI: 编辑 Journal 需要单一本地工作区（Agent 工具当前未启用）。'
    );
    return;
  }
  void new EditJournalViewer(edits).show();
}

/** yisiAI.pdfVisionMaxPages: 0 = whole document (hard ceiling lives in the
 * extractor). A setting change takes effect on the next attach. */
function readPdfVisionPagesLimit(): number {
  const value = vscode.workspace.getConfiguration('yisiAI').get<number>('pdfVisionMaxPages', 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** User overrides for per-model context windows (any model, substring match). */
function readModelWindowOverrides(): ModelWindowOverride[] {
  const configured = vscode.workspace.getConfiguration('yisiAI').get<unknown>('modelContextWindows', []);
  if (!Array.isArray(configured)) return [];
  const overrides: ModelWindowOverride[] = [];
  for (const entry of configured) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const model = typeof record.model === 'string' ? record.model : undefined;
    const windowTokens = typeof record.windowTokens === 'number' ? record.windowTokens : undefined;
    if (model && windowTokens && windowTokens > 0) {
      overrides.push({ model, windowTokens });
    }
  }
  return overrides;
}

/** Estimated context usage for the active session (as a % of the model window). */
async function readContextUsage(
  sessions: SessionService,
  providers: Pick<ProviderCatalog, 'resolve'>,
  configs: ProviderConfigurationService
): Promise<ContextUsageState | null> {
  try {
    const session = sessions.getActiveSession();
    if (!session.model.providerId || !session.model.modelId) return null;
    const provider = await providers.resolve(session.model.providerId);
    const capabilities = await provider.capabilities(session.model.modelId);
    const config = configs.get(session.model.providerId);
    // A configured contextLength always wins; otherwise fall back to the known
    // family table so the ring shows a real percentage instead of "–".
    const windowTokens = capabilities.maxContextTokens
      ?? modelContextWindow(config?.kind ?? 'openaiCompatible', session.model.modelId, config?.capabilities.contextLength, readModelWindowOverrides());
    const tokens = session.items.reduce((total, item) => total + estimateTokens(item.text ?? ''), 0)
      + CONTEXT_OVERHEAD_TOKENS;
    return computeContextUsage(tokens, windowTokens);
  } catch {
    return null;
  }
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

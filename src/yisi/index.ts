import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderConfigurationService } from './application/provider/providerConfigurationService';
import { ChatService } from './application/chat/chatService';
import { LegacySessionMetadata, SessionService } from './application/session/sessionService';
import { ProviderCatalog, ProviderFactory } from './application/provider/providerCatalog';
import { OpenAICompatibleProvider } from './infrastructure/llm/openAICompatibleProvider';
import { AnthropicProvider } from './infrastructure/llm/anthropicProvider';
import { JsonSessionRepository } from './infrastructure/persistence/jsonSessionRepository';
import { YisiChatViewProvider } from './ui/chatViewProvider';
import { ApprovalBroker } from './application/agent/approvalBroker';
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
import { ProjectInstructionsService } from './application/context/projectInstructionsService';
import { buildProjectInstructionsMessage } from './application/agent/projectInstructions';
import { McpServerService } from './application/mcp/mcpServerService';
import { parseMcpServerConfigurations } from './application/mcp/mcpConfiguration';
import { WEB_SEARCH_SERVER_SCRIPT, renderWebSearchConfig, webSearchSetupNotes } from './application/mcp/webSearchSetup';
import { StdioMcpTransport } from './infrastructure/mcp/stdioMcpTransport';
import { ConfiguredHook, parseHookConfigurations } from './application/hooks/hookConfiguration';
import { HookService } from './application/hooks/hookService';
import { NodeHookExecutor } from './infrastructure/hooks/nodeHookExecutor';
import { SkillService } from './application/skills/skillService';
import { buildSkillCatalogueMessage, createSkillTool } from './application/skills/skillDefinition';
import { RepoIndexService, createRepoIndexTool } from './application/context/repoIndexService';
import { CapabilitiesResolver, buildCapabilitiesReport, createModelCapabilitiesTool } from './application/context/modelCapabilitiesService';
import { HistoryResolver, createSessionHistoryTool, summarizeSessionHistory } from './application/context/sessionHistoryService';
import { ToolRegistry } from './application/agent/toolRegistry';
import { PermissionEngine } from './permissions/permissionEngine';
import { AgentChatRunner } from './application/agent/agentChatRunner';
import { AgentPlanService, createPlanTodoTool } from './application/agent/agentPlanService';
import { createRequestPermissionTool } from './application/agent/requestPermissionTool';
import { createSubagentTool } from './application/agent/subagentTool';
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
import { RuyiManageService, createRuyiManageTool } from './application/ruyi/ruyiManageService';
import { RuyiWorkflowService, createRuyiWorkflowTool } from './application/ruyi/ruyiWorkflowService';
import { RuyiCliAdapter } from './ruyi/ruyiCliAdapter';
import { SymbolLookupService, createListSymbolsTool } from './application/context/symbolLookupService';
import { VsCodeDocumentSymbolProvider } from './vscode/symbols/vsCodeSymbolProvider';
import { EditJournalViewer } from './vscode/editJournalViewer';
import { CheckpointStore } from './application/edit/checkpointStore';
import { CheckpointService } from './application/edit/checkpointService';
import { ContextUsageState, computeContextUsage, estimateTokens, CONTEXT_OVERHEAD_TOKENS } from './application/context/contextUsage';
import { ModelWindowOverride, modelContextWindow } from './domain/modelContextWindow';
import { NodeProcessRunner } from './infrastructure/process/nodeProcessRunner';
import { NodeGitService } from './infrastructure/git/nodeGitService';
import { NodeWorktreeManager } from './infrastructure/git/nodeWorktreeManager';
import { GitStatusService, createGitStatusTool } from './application/git/gitStatusService';
import { WorktreeManagerService, createGitWorktreeTool } from './application/git/worktreeManagerService';
import { SessionIsolationService, SessionRunnerResolver } from './application/workspace/sessionIsolation';
import { VsCodeToolConfirmation } from './vscode/agent/vsCodeToolConfirmation';
import { ProposalDiffPresenter } from './vscode/agent/proposalDiff';
import { PlanDocumentPresenter } from './vscode/agent/planDocument';
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
  const approvals = new ApprovalBroker();
  const resolveCapabilities: CapabilitiesResolver = async () => {
    try {
      const model = sessions.getActiveSession().model;
      if (!model.providerId || !model.modelId) return null;
      const provider = await providerCatalog.resolve(model.providerId);
      const caps = await provider.capabilities(model.modelId);
      return buildCapabilitiesReport(model.modelId, caps);
    } catch {
      return null;
    }
  };
  const resolveHistory: HistoryResolver = async () => {
    try {
      const active = sessions.getActiveSession();
      return summarizeSessionHistory(active.items);
    } catch {
      return null;
    }
  };
  const mcpServers = createMcpServerService(context);
  const agentHooks = createAgentHooks();
  const checkpoints = new CheckpointStore();
  // One provider registration for the whole extension; the file each diff reads is
  // resolved per execution root when a proposal is opened.
  const proposalDiff = new ProposalDiffPresenter();
  // Plan review documents are plain untitled markdown; no registration needed.
  const planDocuments = new PlanDocumentPresenter();
  const agentWorkspace = await createAgentWorkspace(approvals, resolveCapabilities, resolveHistory, mcpServers, agentHooks, checkpoints, proposalDiff, planDocuments);
  // The rewind path needs the workspace edit service; without a local workspace
  // there are no agent edits, hence no checkpoints to rewind.
  const checkpointService = agentWorkspace.edits
    ? new CheckpointService(checkpoints, agentWorkspace.edits, sessions)
    : undefined;
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
    new VsCodeAttachmentRehydrator(attachmentService),
    agentWorkspace.sessionResolver ? session => agentWorkspace.sessionResolver!.resolve(session) : undefined,
    undefined, // historyBudgetRatio: keep the application-layer default
    {
      autoTitle: () => ({
        enabled: vscode.workspace.getConfiguration('yisiAI').get<boolean>('sessionAutoTitle', true)
      }),
      // Same source as the context ring (readContextUsage): the provider's
      // declaration first, then the known-family estimate. Keeping one source is
      // what stops "the ring says 80%" and "compaction never ran" from both being
      // true at once.
      contextWindow: (providerId, modelId) => {
        try {
          const config = providerConfigurations.get(providerId);
          return modelContextWindow(
            config?.kind ?? 'openaiCompatible',
            modelId,
            config?.capabilities.contextLength,
            readModelWindowOverrides()
          );
        } catch {
          return undefined;
        }
      }
    },
    // `/name` in the composer loads a workspace skill for that turn only.
    agentWorkspace.skills,
    // Turn boundaries for checkpoints (per workspace, shared with the edit path).
    checkpoints
  );
  const chatView = new YisiChatViewProvider(
    context.extensionUri,
    sessions,
    providerSetup,
    chat,
    new VsCodeWorkspaceContextPicker(attachmentService),
    modelControl,
    approvals,
    agentWorkspace.profile,
    () => readContextUsage(sessions, providerCatalog, providerConfigurations),
    async () => {
      try {
        const workspace = selectLocalAgentWorkspace(vscode.workspace.workspaceFolders);
        const root = workspace?.fsPath ?? process.cwd();
        const commands = new CommandExecutionService(new NodeProcessRunner(), root);
        const inspection = await new RuyiInspectionService(commands, new RuyiCliAdapter()).inspect(new AbortController().signal);
        return inspection.summary;
      } catch {
        return null;
      }
    }
  );
  const yisiStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  yisiStatus.text = '$(yisi-ai)';
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
    vscode.commands.registerCommand('yisiAI.checkpoints', () =>
      showCheckpoints(checkpointService, sessions, () => chatView.reloadFromSessions())
    ),
    vscode.commands.registerCommand('yisiAI.ruyi.check', () => chatView.runRuyiCheck()),
    vscode.commands.registerCommand('yisiAI.webSearch.setup', () =>
      copyWebSearchConfig(context.extensionUri)
    ),
    vscode.commands.registerCommand('yisiAI.focus', () => revealYisiChat()),
    vscode.commands.registerCommand('yisiAI.resume', () => chatView.resumeUnfinished()),
    yisiStatus,
    // MCP servers are child processes we started; they must not outlive the
    // extension (docs/16: no orphaned processes).
    { dispose: () => void mcpServers?.dispose() },
    // The proposal diff keeps a text-document provider registered.
    { dispose: () => proposalDiff.dispose() }
  );

  // Soft resume prompt: if a session was left running/interrupted (e.g. VS Code
  // reloaded mid-run), offer to re-run its last message instead of silently
  // dropping it. Deferred so it never blocks activation.
  setTimeout(() => {
    const unfinished = sessions.listSessions().find(
      summary => summary.status === 'running' || summary.status === 'interrupted'
    );
    if (!unfinished) return;
    void vscode.window.showInformationMessage(
      'Yisi AI: 检测到尚未完成的 Agent 运行，是否继续？',
      '继续',
      '忽略'
    ).then(action => {
      if (action === '继续') void chatView.resumeUnfinished();
    });
  }, 1_200);
}

/**
 * Hand the user the one line they cannot guess: the installed path of the bundled
 * web-search server. Copying a ready-to-paste `yisiAI.mcpServers` entry is the whole
 * feature — there is no second configuration mechanism for web search
 * (docs/decisions/ADR-0013).
 */
async function copyWebSearchConfig(extensionUri: vscode.Uri): Promise<void> {
  const scriptPath = vscode.Uri.joinPath(extensionUri, ...WEB_SEARCH_SERVER_SCRIPT).fsPath;
  const config = renderWebSearchConfig(scriptPath);
  await vscode.env.clipboard.writeText(config);
  const action = await vscode.window.showInformationMessage(
    'Yisi AI: 联网搜索配置已复制到剪贴板，粘贴进 settings.json 的 yisiAI.mcpServers 数组即可。' +
      webSearchSetupNotes().join(' '),
    '打开 settings.json'
  );
  if (action === '打开 settings.json') {
    void vscode.commands.executeCommand('workbench.action.openSettingsJson');
  }
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

interface AgentWorkspaceServices {
  runner?: AgentChatRunner;
  profile?: ProjectProfileSource;
  edits?: WorkspaceEditService;
  sessionResolver?: SessionRunnerResolver;
  /** `/name` skill loading for the composer (workspace-rooted). */
  skills?: { load(name: string, signal: AbortSignal): Promise<{ name: string; body: string } | undefined> };
  /** Rewind / fork over the recorded checkpoints. */
  checkpoints?: CheckpointService;
}

/**
 * Reads `yisiAI.mcpServers` and builds the shared MCP service.
 *
 * Returns undefined when nothing is configured — the common case, and it must
 * cost nothing: no process is spawned and startup is not delayed. Invalid entries
 * are logged and skipped rather than guessed at, because a silently ignored
 * server is indistinguishable from a broken one.
 */
function createMcpServerService(context: vscode.ExtensionContext): McpServerService | undefined {
  let raw: unknown;
  try {
    raw = vscode.workspace.getConfiguration('yisiAI').get<unknown>('mcpServers');
  } catch {
    return undefined;
  }
  const { servers, rejected } = parseMcpServerConfigurations(raw);
  for (const entry of rejected) {
    console.warn(`[Yisi AI] Ignoring mcpServers[${entry.index}]: ${entry.reason}`);
  }
  if (!servers.length) return undefined;
  const workspace = selectLocalAgentWorkspace(vscode.workspace.workspaceFolders);
  const version = context.extension?.packageJSON?.version;
  return new McpServerService(
    servers,
    configuration =>
      new StdioMcpTransport({
        command: configuration.command,
        ...(configuration.args ? { args: configuration.args } : {}),
        ...(workspace ? { cwd: workspace.fsPath } : {})
      }),
    {
      clientVersion: typeof version === 'string' ? version : undefined
    }
  );
}

/**
 * Reads `yisiAI.hooks` into the configured hook list, or undefined when nothing
 * is configured. Invalid entries are logged and skipped — a hook that is silently
 * dropped would change whether an action is allowed, which is exactly the kind of
 * surprise this feature must not produce.
 */
function createAgentHooks(): ConfiguredHook[] | undefined {
  let raw: unknown;
  try {
    raw = vscode.workspace.getConfiguration('yisiAI').get<unknown>('hooks');
  } catch {
    return undefined;
  }
  const { hooks, rejected } = parseHookConfigurations(raw);
  for (const entry of rejected) {
    console.warn(`[Yisi AI] Ignoring hooks[${entry.index}]: ${entry.reason}`);
  }
  return hooks.length ? hooks : undefined;
}

/** The directory where isolated session worktrees are created. */
const SESSION_WORKTREES_DIR = path.join(os.tmpdir(), 'yisi-agent-worktrees');

/**
 * Build an AgentChatRunner whose tools are bound to a single execution root.
 * `includeDiagnostics` turns on idle VS Code diagnostics for the root (used for
 * the shared workspace, off for isolated session worktrees which have no open
 * editor buffers).
 */
async function buildAgentRunner(
  root: string,
  uri: string,
  approvals: ApprovalBroker,
  git: NodeGitService,
  worktrees: WorktreeManagerService,
  includeDiagnostics: boolean,
  plan: AgentPlanService,
  resolveCapabilities: CapabilitiesResolver,
  resolveHistory: HistoryResolver,
  mcpServers?: McpServerService,
  hooks?: readonly ConfiguredHook[],
  checkpoints?: CheckpointStore,
  proposals?: ProposalDiffPresenter,
  planDocuments?: PlanDocumentPresenter
): Promise<AgentChatRunner> {
  const fileSystem = await NodeWorkspaceFileSystem.create(root);
  const diagnostics = includeDiagnostics
    ? new VsCodeDiagnosticProvider({
        getDiagnostics: () => vscode.languages.getDiagnostics(),
        getWorkspaceFolder: folder => vscode.workspace.getWorkspaceFolder(folder as vscode.Uri)
      }, [uri], 50)
    : undefined;
  const edits = new WorkspaceEditService(fileSystem, diagnostics, fileSystem, git, root, checkpoints);
  const commands = new CommandExecutionService(new NodeProcessRunner(), root);
  const profileService = new ProjectProfileService(fileSystem);
  const validationPlanner = new ValidationPlannerService(commands, profileService);
  const ruyiInspection = new RuyiInspectionService(commands, new RuyiCliAdapter());
  const symbols = new SymbolLookupService(root, new VsCodeDocumentSymbolProvider());
  // MCP tools are not bound to an execution root, so the shared service is asked
  // for the same list on every runner; the lookup is memoised.
  const mcpTools = mcpServers ? await mcpServers.tools() : [];
  // Skills are resolved once per execution root: the catalogue is part of the
  // request head, so it must not change shape mid-session — the same reasoning as
  // the tool list. Adding a skill is picked up by reloading the window.
  const skills = await new SkillService(fileSystem).discover();
  const skillCatalogue = buildSkillCatalogueMessage(skills);
  const tools = [
    ...createWorkspaceContextTools(new WorkspaceContextService(fileSystem)),
    createRepoIndexTool(new RepoIndexService(fileSystem)),
    createModelCapabilitiesTool(resolveCapabilities),
    createSessionHistoryTool(resolveHistory),
    createWorkspaceEditTool(edits),
    createWorkspaceFileTool(edits),
    createWorkspaceRewriteTool(edits),
    createWorkspaceDeleteTool(edits),
    createWorkspaceRenameTool(edits),
    createWorkspaceDirectoryTool(edits),
    createUndoLastEditTool(edits),
    createRunCommandTool(commands),
    createGitStatusTool(new GitStatusService(git), root),
    createGitWorktreeTool(worktrees, root),
    createInspectProjectTool(profileService),
    createRunValidationsTool(validationPlanner),
    createRuyiInspectTool(ruyiInspection),
    createRuyiManageTool(new RuyiManageService(new RuyiCliAdapter())),
    createRuyiWorkflowTool(new RuyiWorkflowService(new RuyiCliAdapter())),
    createPlanTodoTool(plan),
    createListSymbolsTool(symbols),
    // The reviewed exit from Plan mode: the loop intercepts this and asks the
    // user through the same approval card a privileged action would use.
    createRequestPermissionTool(),
    // A subagent runs its own loop with a read-only tool subset; the loop
    // intercepts this call (see application/agent/subagentTool).
    createSubagentTool(),
    // Bridged MCP tools, namespaced `mcp__<server>__<tool>`. Every call still goes
    // through the permission engine like any other tool.
    ...mcpTools,
    // Loading a skill is reading a workspace file, so it is readOnly and callable
    // in every mode; the body is bounded and only read when actually used.
    ...(skills.length ? [createSkillTool({ fileSystem, skills })] : [])
  ];
  return new AgentChatRunner(
    new ToolRegistry(tools),
    new PermissionEngine(),
    uri,
    new VsCodeToolConfirmation(
      approvals,
      undefined,
      // Bound to this execution root, so a worktree session's proposal diffs read
      // the checkout the agent is actually editing.
      proposals ? { open: request => proposals.open(request, root) } : undefined,
      planDocuments
    ),
    // The workspace's own conventions (AGENTS.md / CLAUDE.md). Read per run so a
    // session that edits its instruction file sees the change, and rooted at this
    // runner's execution root so a worktree session reads its own checkout.
    async signal => {
      const file = await new ProjectInstructionsService(fileSystem).load(signal);
      return file ? buildProjectInstructionsMessage(file) : undefined;
    },
    // Hooks are re-created per execution root so a hook process runs with that
    // checkout as its working directory. No process starts until a hook fires.
    hooks?.length ? new HookService(hooks, new NodeHookExecutor({ cwd: root })) : undefined,
    // The skill catalogue is fixed for the life of this runner, so it is resolved
    // here rather than re-read on every run.
    async () => skillCatalogue
  );
}

async function createAgentWorkspace(approvals: ApprovalBroker, resolveCapabilities: CapabilitiesResolver, resolveHistory: HistoryResolver, mcpServers?: McpServerService, hooks?: readonly ConfiguredHook[], checkpoints?: CheckpointStore, proposals?: ProposalDiffPresenter, planDocuments?: PlanDocumentPresenter): Promise<AgentWorkspaceServices> {
  const workspace = selectLocalAgentWorkspace(vscode.workspace.workspaceFolders);
  if (!workspace) return {};
  try {
    const git = new NodeGitService(new NodeProcessRunner());
    const worktrees = new WorktreeManagerService(new NodeWorktreeManager(new NodeProcessRunner()), git);
    const plan = new AgentPlanService();
    const mainRunner = await buildAgentRunner(workspace.fsPath, workspace.uri, approvals, git, worktrees, true, plan, resolveCapabilities, resolveHistory, mcpServers, hooks, checkpoints, proposals, planDocuments);
    const isolation = new SessionIsolationService(
      workspace.fsPath,
      SESSION_WORKTREES_DIR,
      worktrees,
      (root, uri) => buildAgentRunner(root, uri, approvals, git, worktrees, false, plan, resolveCapabilities, resolveHistory, mcpServers, hooks, checkpoints, proposals, planDocuments),
      repo => git.isRepo(repo)
    );
    const mainFileSystem = await NodeWorkspaceFileSystem.create(workspace.fsPath);
    const profileService = new ProjectProfileService(mainFileSystem);
    // The composer's `/name` path reads through the same workspace-bounded file
    // system the agent uses.
    const skillService = new SkillService(mainFileSystem);
    const edits = new WorkspaceEditService(mainFileSystem, undefined, mainFileSystem, git, workspace.fsPath, checkpoints);
    const profile: ProjectProfileSource = {
      inspect: async () => {
        const inspection = await profileService.inspect();
        return inspection.summary;
      }
    };
    return {
      runner: mainRunner,
      profile,
      edits,
      skills: { load: (name, signal) => skillService.load(name, signal) },
      sessionResolver: isolation
    };
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

/**
 * Checkpoint picker: choose a turn, then rewind the code to it, fork the
 * conversation from it, or both.
 *
 * The two halves are offered separately because they answer different questions —
 * "undo what the agent did" and "start over from this point" — and a rewind is
 * reported honestly (per-file reasons) rather than as a silent success.
 */
async function showCheckpoints(
  checkpoints: CheckpointService | undefined,
  sessions: SessionService,
  refresh: () => Promise<void>
): Promise<void> {
  if (!checkpoints) {
    await vscode.window.showInformationMessage('Yisi AI: 检查点需要单一本地工作区（Agent 工具当前未启用）。');
    return;
  }
  const sessionId = sessions.getActiveSession().id;
  const turns = checkpoints.list(sessionId);
  if (!turns.length) {
    await vscode.window.showInformationMessage('Yisi AI: 当前会话还没有检查点（Agent 尚未改动文件）。');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [...turns].reverse().map(turn => ({
      label: `$(history) #${turn.index} ${turn.label}`,
      description: `${turn.changes} 处改动${turn.notReversible ? `，其中 ${turn.notReversible} 处无法自动回滚` : ''}`,
      turn
    })),
    { title: 'Yisi AI: 回到某个检查点', placeHolder: '选择要回到的那个回合' }
  );
  if (!picked) return;

  const action = await vscode.window.showQuickPick(
    [
      { label: '$(history) 回滚代码到此处', description: '撤销此回合及之后的所有文件改动，保留对话', value: 'code' as const },
      { label: '$(git-branch) 从此处分叉会话', description: '保留当前代码，在这一回合之前新开一个会话', value: 'fork' as const },
      { label: '$(sync) 两者都做', description: '回滚代码并分叉会话', value: 'both' as const }
    ],
    { title: `检查点 #${picked.turn.index}` }
  );
  if (!action) return;

  const summary: string[] = [];
  if (action.value === 'code' || action.value === 'both') {
    const result = await checkpoints.rewind(sessionId, picked.turn.id, new AbortController().signal);
    if (!result.restored.length && !result.failed.length) summary.push('没有需要回滚的改动。');
    else {
      summary.push(
        `已回滚 ${result.restored.length} 处改动${result.failed.length ? `，${result.failed.length} 处未能回滚` : ''}。`
      );
    }
    for (const failure of result.failed.slice(0, 5)) summary.push(`· ${failure.path}: ${failure.reason}`);
  }
  if (action.value === 'fork' || action.value === 'both') {
    const forked = await checkpoints.fork(sessionId, picked.turn.id);
    if (forked) {
      summary.push(`已分叉会话「${forked.title}」（保留 ${forked.itemCount} 条历史）。`);
      await refresh();
    } else {
      summary.push('分叉失败：该检查点已不可用。');
    }
  }
  await vscode.window.showInformationMessage(`Yisi AI: ${summary.join(' ')}`);
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

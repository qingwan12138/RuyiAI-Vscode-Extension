import { NodeWorkspaceFileSystem } from '../infrastructure/context/nodeWorkspaceFileSystem';
import { NodeProcessRunner } from '../infrastructure/process/nodeProcessRunner';
import {
  WorkspaceEditService,
  createWorkspaceEditTool,
  createWorkspaceFileTool,
  createWorkspaceRewriteTool,
  createWorkspaceDeleteTool,
  createWorkspaceRenameTool,
  createWorkspaceDirectoryTool,
  createUndoLastEditTool
} from '../application/edit/workspaceEditService';
import { WorkspaceContextService, createWorkspaceContextTools } from '../application/context/workspaceContextService';
import { CommandExecutionService, createRunCommandTool } from '../application/process/commandExecutionService';
import { ProjectProfileService, createInspectProjectTool } from '../application/context/projectProfileService';
import { RepoIndexService, createRepoIndexTool } from '../application/context/repoIndexService';
import { ValidationPlannerService, createRunValidationsTool } from '../application/validation/validationPlannerService';
import { AgentPlanService, createPlanTodoTool } from '../application/agent/agentPlanService';
import { SkillService } from '../application/skills/skillService';
import { buildSkillCatalogueMessage, createSkillTool } from '../application/skills/skillDefinition';
import { ProjectInstructionsService } from '../application/context/projectInstructionsService';
import { buildProjectInstructionsMessage } from '../application/agent/projectInstructions';
import { CheckpointStore } from '../application/edit/checkpointStore';
import { createSubagentTool } from '../application/agent/subagentTool';
import { AgentToolEvent } from '../application/agent/readOnlyAgentLoop';
import { ToolRegistry } from '../application/agent/toolRegistry';
import { PermissionEngine } from '../permissions/permissionEngine';
import { AgentChatRunner } from '../application/agent/agentChatRunner';
import { HeadlessPolicy } from '../application/agent/headlessPolicy';
import { YisiTool } from '../domain/tool';
import { AgentRequest, AgentStreamEvent } from '../llm/types';

/**
 * The headless runner: one agent task, no editor.
 *
 * The same application services the extension uses are wired here without VS Code,
 * which is what makes a CI run and an editor run the *same* agent rather than a
 * second implementation of one. Deliberately absent are the few tools that only
 * exist inside the editor — language-server symbols and the idle diagnostics
 * snapshot — because a CI container has no language server to ask. Everything else
 * is present: read/search/index, the edit tools, commands, validations, skills,
 * project instructions, subagents and the plan list.
 *
 * Nothing here changes the permission model. The same PermissionEngine gates every
 * call; the only difference is who answers its questions, and that is the caller's
 * explicit policy (see application/agent/headlessPolicy).
 */

/** What the runner needs from a provider: structured tool streaming. */
export interface HeadlessProvider {
  streamAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentStreamEvent>;
}

export interface HeadlessTaskOptions {
  root: string;
  prompt: string;
  model: string;
  policy: HeadlessPolicy;
  provider: HeadlessProvider;
  onDelta?: (text: string) => void;
  onToolEvent?: (event: AgentToolEvent) => void;
  signal: AbortSignal;
}

export interface HeadlessTaskResult {
  status: 'completed' | 'blocked';
  text: string;
  reason?: string;
}

/** Builds the headless tool set against one execution root. */
export async function createHeadlessTools(root: string): Promise<YisiTool[]> {
  const fileSystem = await NodeWorkspaceFileSystem.create(root);
  const commands = new CommandExecutionService(new NodeProcessRunner(), root);
  const profileService = new ProjectProfileService(fileSystem);
  const validationPlanner = new ValidationPlannerService(commands, profileService);
  const checkpoints = new CheckpointStore();
  const edits = new WorkspaceEditService(fileSystem, undefined, fileSystem, undefined, root, checkpoints);
  const skills = await new SkillService(fileSystem).discover();

  return [
    ...createWorkspaceContextTools(new WorkspaceContextService(fileSystem)),
    createRepoIndexTool(new RepoIndexService(fileSystem)),
    createInspectProjectTool(profileService),
    createRunCommandTool(commands),
    createRunValidationsTool(validationPlanner),
    createWorkspaceEditTool(edits),
    createWorkspaceFileTool(edits),
    createWorkspaceRewriteTool(edits),
    createWorkspaceDeleteTool(edits),
    createWorkspaceRenameTool(edits),
    createWorkspaceDirectoryTool(edits),
    createUndoLastEditTool(edits),
    createPlanTodoTool(new AgentPlanService()),
    createSubagentTool(),
    ...(skills.length ? [createSkillTool({ fileSystem, skills })] : [])
  ];
}

/** The stable head context a headless run sends: project instructions + skills. */
export async function headlessContext(
  root: string
): Promise<{ projectInstructions?: string; skillCatalogue?: string }> {
  const fileSystem = await NodeWorkspaceFileSystem.create(root);
  const instructions = await new ProjectInstructionsService(fileSystem).load();
  const catalogue = buildSkillCatalogueMessage(await new SkillService(fileSystem).discover());
  return {
    ...(instructions ? { projectInstructions: buildProjectInstructionsMessage(instructions) } : {}),
    ...(catalogue ? { skillCatalogue: catalogue } : {})
  };
}

/** Runs one prompt to completion and returns the answer, or why it stopped. */
export async function runHeadlessTask(options: HeadlessTaskOptions): Promise<HeadlessTaskResult> {
  const tools = await createHeadlessTools(options.root);
  const context = await headlessContext(options.root);
  const runner = new AgentChatRunner(
    new ToolRegistry(tools),
    new PermissionEngine(),
    options.root,
    options.policy.confirmations
  );
  try {
    const text = await runner.run(
      options.provider,
      {
        model: options.model,
        messages: [{ role: 'user', content: options.prompt }],
        ...context
      },
      { sessionId: `headless-${Date.now()}`, mode: options.policy.mode },
      text => options.onDelta?.(text),
      options.signal,
      options.onToolEvent
    );
    return { status: 'completed', text };
  } catch (error) {
    return {
      status: 'blocked',
      text: '',
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

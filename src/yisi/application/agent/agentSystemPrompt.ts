/**
 * The agent's role and tool-use policy — the stable head of every agent request.
 *
 * This is the part of the system prompt that does not depend on the permission
 * mode, so it can sit at the head of the conversation where a provider's prompt
 * cache can reuse it; the mode-specific briefing is appended after the retained
 * history instead (see permissionModePrompt.ts).
 *
 * Why it exists: the agent path used to send the model *nothing* but the
 * conversation, ~24 tool definitions and `tool_choice: 'auto'`. Asked to explain
 * a general concept, the model matched a keyword in a tool description (several
 * mention RISC-V) and went looking around the workspace, because no instruction
 * told it that general questions do not need tools. Real transcript: "请你介绍
 * 一下RISC-V吧" produced a `ruyi_check` call and a `list_directory` call.
 *
 * Keep this text about *how to work*. Mode-specific restrictions belong in the
 * mode briefing, and enforcement stays in PermissionEngine either way.
 */
export function agentSystemPromptMessage(): string {
  return [
    'You are Yisi AI, a coding agent working in the user\'s VS Code workspace.',
    '',
    'Decide first whether the request needs the workspace at all:',
    '- General questions — concepts, languages, protocols, standards, definitions, "what is X", "how does X work", "introduce X" — are answered from what you already know. You do not need a tool for them, and a tool call does not make the answer better.',
    '- Use tools when the task depends on facts about this workspace or project: reading or changing files, running its build/tests, checking its Git state, inspecting the local Ruyi environment. Only then.',
    '',
    'Working rules:',
    '- Use the smallest set of tools the task needs. Do not explore the workspace to "get oriented", and do not call a tool merely because its subject matches a word in the request.',
    '- Read before you write, and keep changes inside the workspace.',
    '- Tool paths are workspace-relative.',
    '- Answer in the language the user wrote in.',
    '- Never claim something succeeded unless the tool result reported ok.'
  ].join('\n');
}

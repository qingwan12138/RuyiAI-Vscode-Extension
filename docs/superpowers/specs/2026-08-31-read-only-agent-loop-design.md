# Read-Only Agent Tool Loop Design

## Goal and scope

Deliver the first real Yisi Agent loop: an OpenAI-compatible provider may request one of the existing bounded workspace tools, the Extension Host validates and authorizes it, returns normalized evidence to the model, and streams the final answer. This slice exposes only `read_file`, `list_directory`, and `search_text`. It does not add file writes, command execution, automatic repair, or permission UI.

## Selected architecture

The LLM port gains a tool-capable method that is separate from the existing text-only `streamChat` method. This avoids changing behavior for providers or configurations that do not opt into tool calling. The OpenAI-compatible adapter owns wire-format details: it sends JSON-schema tool definitions, accumulates fragmented `delta.tool_calls`, validates completed names and JSON-object arguments, and emits normalized text or completed-tool-call events.

An application-owned `ReadOnlyAgentLoop` consumes only normalized provider events, a registry of `YisiTool` values, `PermissionEngine`, and a run context. It has no `vscode`, filesystem, fetch, or OpenAI dependency. The composition root supplies the current workspace tools and later connects the loop to ChatService after an explicit provider capability is available.

## Data flow

1. Build an agent request from the selected model, prior conversation, and the registered tool definitions.
2. Stream one provider round. Forward text deltas only when that round is a final text response.
3. If the round contains tool calls, reject any mixed final text/tool ambiguity, unknown tool, duplicate call id, malformed input, or excessive call count.
4. Evaluate each tool's declared risk and mutation metadata with `PermissionEngine` using the active Session mode.
5. Execute allowed read-only tools sequentially with the same AbortSignal and Extension Host execution context.
6. Serialize each bounded result into a tool message and start the next provider round.
7. Stop on final non-empty text, cancellation, a blocked permission, repeated identical call, provider error, or loop budget exhaustion.

## Normalized contracts

- `AgentToolDefinition`: name, description, JSON-schema parameters.
- `AgentToolCall`: provider call id, tool name, parsed JSON-object input.
- `AgentStreamEvent`: text delta or one completed tool call.
- `AgentConversationMessage`: system/user/assistant/tool message with tool-call linkage represented structurally.
- `AgentLoopResult`: completed or blocked status, final text, tool execution evidence, and a bounded reason when blocked.

The provider adapter accepts at most 16 calls per response and 64 KiB of accumulated argument text per call. The application loop allows at most 8 provider rounds and rejects the same tool plus canonical input twice consecutively. Tool result JSON is capped at 64 KiB with explicit truncation metadata.

## Permission and security

Tool metadata is never trusted implicitly. The loop calls `PermissionEngine` for every request and fails closed for unknown tools or inconsistent risk metadata. This slice treats `confirm` as blocked because no permission UI is included. No Webview code receives filesystem access. Provider-supplied ids, names, arguments, and errors are bounded before entering evidence or Session data. Tool results are untrusted workspace data when returned to the model.

## Error and cancellation behavior

Malformed streamed tool fragments cause a normalized provider protocol error. Tool input validation remains inside each tool's existing `execute` boundary; failures become bounded tool error evidence rather than arbitrary object serialization. Cancellation aborts the current provider or tool and terminates the loop as interrupted. Empty final output is a failure, never a successful completion.

## Testing and integration sequence

Provider tests cover request shape, fragmented arguments, multiple calls, malformed JSON, missing ids/names, and size limits. Loop tests cover successful read→tool-result→final-answer flow, unknown tools, permission denial/confirmation, input failure, cancellation, duplicate/no-progress guard, round budget, and result truncation. Existing text-only ChatService tests remain unchanged. The first merge establishes the tested port and loop; a following vertical slice adds provider capability configuration and Session/UI wiring without forcing tool schemas onto incompatible local endpoints.

## Clean-room and dependencies

The design uses documented OpenAI-compatible Chat Completions concepts and the repository's existing architecture contracts. No external agent implementation or code is copied, and no dependency is added.

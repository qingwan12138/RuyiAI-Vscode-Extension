# Agent Chat Wiring Design

## Goal

Make the tested read-only Agent loop reachable from the existing Composer for explicitly enabled providers, while preserving text-only behavior for all existing configurations.

## Capability model and migration

`ProviderConfiguration` gains `capabilities: { toolCalling: boolean }`. The persisted provider document advances from schema version 1 to 2. Parsing schema v1 performs an in-memory migration that assigns `toolCalling: false`; the next repository save writes schema v2. Schema v2 requires the exact capability object and rejects secret-looking or unknown fields as before.

The setup wizard asks whether tool calling is supported after model selection. It explains that enabling the option allows the model to request bounded workspace reads. No network probe is used. Existing providers remain text-only until recreated or a later edit flow explicitly changes them.

## Runtime selection

The provider factory passes the configured flag into `OpenAICompatibleProvider`, whose `capabilities(model)` reports it. `ChatService` resolves the provider and checks model capabilities for every user turn. When `toolCalling` is false it uses the unchanged `streamChat` path. When true it requires an injected `AgentConversationRunner`; absence is an explicit blocked error rather than silent fallback.

`AgentChatRunner` is an application adapter around `ReadOnlyAgentLoop`. It consumes a provider with `streamAgent`, the three workspace tools, PermissionEngine, and one `ToolExecutionContext` identity. It maps Session mode and messages into the loop and returns final text. ChatService remains responsible for user/final-assistant persistence and Session status transitions; intermediate tool results are transient and sent only to the provider.

## Extension Host composition

For exactly one local `file:` workspace folder, `registerYisiAI` creates `NodeWorkspaceFileSystem`, `WorkspaceContextService`, Read/List/Search tools, ToolRegistry, and AgentChatRunner. For zero, multi-root, or non-file workspaces it leaves the runner unavailable. A tool-capable provider then receives a clear error explaining the single local workspace requirement; text-only chat continues to work.

The Webview receives no new privileged API. Existing `ChatRunCoordinator` owns the AbortController, so Stop cancels provider streaming and active tools through the same signal.

## Failure behavior

- Capability enabled but `streamAgent` absent: blocked provider capability mismatch.
- Capability enabled but runner unavailable: blocked workspace message.
- Agent loop blocked: bounded reason becomes the run error; no assistant completion is persisted.
- Cancellation: Session becomes interrupted through the existing ChatService path.
- Provider capability lookup failure: normal provider failure handling.
- Empty final Agent answer: blocked by the loop.

## Testing

Tests cover v1 migration, strict v2 parsing, capability persistence without secrets, adapter capability reporting, ChatService branch selection, final persistence, blocked/cancel behavior, runner provider checks, and composition eligibility through a pure workspace predicate. Existing pure-chat and UI coordinator tests must remain green.

## Scope and clean-room statement

This slice adds no write/process tools, permission confirmation UI, model auto-probing, or multi-root routing. It uses repository-owned ports and VS Code public workspace information only; no external agent implementation or dependency is copied.

# 08 — VS Code Remote / Terminal Future Compatibility

## 当前版本结论

Remote-SSH 不是当前 v1.0 必须交付能力。

当前唯一主交付场景：

```text
Linux 本机
  ↓
VS Code
  ↓
Yisi AI
  ↓
本机 workspace / RuyiSDK / Git / Build / Test
```

Remote-SSH、Dev Container、WSL、Headless Server 都属于后续扩展。

## 为什么仍然保留本文件

虽然当前不实现 Remote-SSH，但底层架构必须避免未来无法扩展。

必须保留：

- `ExecutionWorkspace`
- `ProcessRunner`
- `EnvironmentSnapshot`
- `PlatformAdapter`
- `FileSystemPort`
- `GitPort`
- `RuyiPort`

这些抽象当前只实现 Linux Local adapter。

## 当前禁止事项

不要为了“未来可能支持 Remote”而提前增加：

- SSH connection manager
- remote localhost forwarding
- remote process lifecycle
- remote filesystem protocol
- remote secret synchronization
- remote reconnect state machine

避免过度设计。

## Terminal 仍是当前重要能力

即使只做 Linux 本地，也必须区分：

### Agent Process
机器可判定、可捕获结果：
- build
- test
- lint
- git
- ruyi
- compiler commands

### Interactive Terminal
用户交互：
- 密码输入
- REPL
- TTY 程序
- 手工命令

Agent 不应依赖读取终端 UI 文本完成自动验证。

## 未来启用 Remote-SSH 时

单独新增：

```text
REMOTE_PLATFORM_CONTRACT.md
```

并重新评估：

- extensionKind
- extension host location
- local/remote localhost
- proxy
- SecretStorage
- process cleanup
- reconnect
- remote worktree
- filesystem paths
- environment sourcing

在那之前，Remote-SSH 不进入当前 DoD。

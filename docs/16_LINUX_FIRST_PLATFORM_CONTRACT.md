# 16 — Linux Local-First Platform Contract

## 1. 产品平台结论

Yisi AI 的**当前正式应用与交付场景是 Linux 本机 VS Code**。

当前版本的核心目标不是“做一个跨平台 Coding Agent”，也不是“优先支持 Remote-SSH”，而是：

```text
Linux PC / Workstation
        ↓
      VS Code
        ↓
      Yisi AI
        ↓
项目代码 / RuyiSDK / Git / Toolchain / Build / Test
```

因此：

- Linux 本机工作区是当前 P0。
- Yisi AI 的文件、进程、Ruyi、Git、构建、测试能力都优先围绕 Linux 本机开发环境设计。
- Windows 原生工作区不是当前正式目标。
- macOS 原生工作区不是当前正式目标。
- VS Code Remote-SSH 暂不作为 v1.0 必须交付能力。
- Container / WSL / Remote-SSH 属于后续扩展能力。
- 架构上保留 `ExecutionWorkspace`、`ProcessRunner`、`PlatformAdapter` 等抽象，避免未来支持 Remote-SSH 时重写 Agent Core。

核心原则：

> 当前只做 Linux 本地，但不能把底层实现写死到未来无法支持远程工作区。

---

## 2. 当前支持矩阵

### P0：当前版本必须支持

1. Linux Desktop / Workstation。
2. Linux 本机安装并运行 VS Code。
3. Linux 本机 workspace。
4. Linux 本机 RuyiSDK / Ruyi CLI。
5. Linux 本机 Git。
6. Linux 本机 C/C++ / Python / Node 等开发工具。
7. 普通 Linux 用户权限，不假定 root。
8. 有 GUI 的 Linux 开发环境。
9. Bash 可用时可以利用 Bash，但不能假设用户登录 shell 一定是 Bash。
10. 典型 RISC-V / RuyiSDK 开发流程。

### P1：后续版本考虑

- VS Code Remote-SSH → Linux。
- Dev Container。
- Linux Container。
- WSL2。
- Headless Linux Server。

### 当前非目标

- Windows 原生 workspace 的完整 Agent 能力。
- PowerShell / CMD 专属执行适配。
- macOS 作为正式交付平台。
- Remote-SSH 断线恢复。
- 本地/远端 localhost 映射。
- 远端 Extension Host 生命周期管理。

---

## 3. Linux 发行版兼容策略

当前不能把实现写成“Ubuntu 专用”。

至少把发行版差异收口到：

```text
PlatformAdapter
        ↓
LinuxPlatformAdapter
```

建议测试优先级：

1. Ubuntu LTS：主开发 / 主 CI / 主验收。
2. Debian stable：第二基线。
3. openEuler / Fedora：用于发现发行版差异。
4. RuyiSDK / 甲方最终明确要求的发行版：最终优先级最高。

允许读取：

```text
/etc/os-release
```

用于诊断和显示发行版信息。

禁止：

- 根据发行版自动执行 sudo 安装依赖。
- 把 apt 写死进 Agent Core。
- 把 yum/dnf/apt 逻辑散落在业务层。

---

## 4. 文件系统语义

Linux 文件系统应按大小写敏感语义处理。

必须：

- `Foo.cpp` 与 `foo.cpp` 视为不同文件。
- 内部优先使用 `vscode.Uri`。
- 进入 Node/Linux adapter 后再使用 `fsPath`。
- 禁止手写 Windows 风格 `\` 路径。
- 正确处理空格、中文、`#`、`$`、单引号等路径。
- 正确处理 symlink。
- 安全检查使用必要的 `realpath` / canonical path。
- 防止 symlink 绕过 workspace/sandbox 边界。
- 目录遍历必须有 symlink cycle protection。
- 文件编辑尽量保留 Unix mode。
- 修改可执行脚本时不能丢失 executable bit。
- 支持只读文件错误。
- 支持 permission denied。
- 支持磁盘满等真实失败。
- 不得把文件写失败却返回成功。

推荐：

```text
read
 ↓
version check
 ↓
create temp file
 ↓
write
 ↓
fsync / safe flush where applicable
 ↓
rename
```

以降低半写入风险。

---

## 5. Shell 与命令执行

### 5.1 默认原则

机器可判定的 Agent Tool 命令优先：

```ts
spawn(executable, args, {
  cwd,
  env,
  shell: false
})
```

不要默认：

```ts
exec("cd xxx && command ...")
```

理由：

- 参数边界明确。
- 降低 shell injection 风险。
- stdout / stderr / exit code 更可靠。
- 不依赖用户 shell。
- 路径带空格时更稳定。

### 5.2 必须使用 Shell 时

需要管道、重定向、复杂 shell 语法时，必须通过单独的：

```text
ShellCommandTool
```

而不是普通 ProcessRunner。

ShellCommandTool 风险等级高于结构化 process tool。

不能假定：

```text
/bin/sh == bash
```

需要 Bash 特性时显式使用：

```bash
/usr/bin/env bash
```

并先确认 Bash 可用。

---

## 6. Linux 环境变量与 Shell 初始化

不能把：

```bash
source ~/.bashrc
```

作为默认修复方案。

原因：

- VS Code Extension Host 环境不等于用户交互式 shell。
- `.bashrc` 可能包含交互逻辑。
- 用户登录 shell 可能不是 Bash。
- 横向项目中不同机器的 shell 初始化不可控。

环境模型统一抽象：

```text
process.env
    ↓
Workspace Environment
    ↓
Ruyi / Toolchain Environment
    ↓
Session Environment
    ↓
Tool Call Overrides
```

建议定义：

```ts
interface EnvironmentSnapshot {
  cwd: string;
  env: Record<string, string>;
  source: string[];
  createdAt: number;
}
```

Secret 必须在日志前 redact。

---

## 7. ProcessRunner

Agent 不能只“调用 Terminal”。

必须有可编程 ProcessRunner。

建议能力：

```text
ProcessRunner
├── spawn()
├── cwd
├── env
├── stdin policy
├── stdout capture
├── stderr capture
├── exitCode
├── signal
├── timeout
├── AbortSignal
├── output limit
├── process metadata
└── termination policy
```

Agent 使用 build/test/lint/ruyi/git 时，默认走 ProcessRunner。

当前实现基线（2026-08-31）：`NodeProcessRunner` 已通过 domain port 提供精确 executable/args、cwd/env、双流字节限量、超时、AbortSignal、spawn failure 归一化和环境覆盖值脱敏。当前 Windows 开发机自动化覆盖通用生命周期；正式 Linux Desktop/CI 的真实进程树 smoke test 仍是交付验收项。

---

## 8. Linux Process / Signal Contract

停止任务不能只考虑主 PID。

Linux 构建过程可能：

```text
cmake
  ↓
make/ninja
  ↓
gcc/clang
  ↓
assembler/linker
```

所以 Stop 设计必须考虑：

- 子进程。
- process group。
- SIGTERM。
- grace period。
- 必要时 SIGKILL。
- PID reuse 风险。

禁止核心实现使用：

```bash
pkill -f "模糊关键字"
```

这种方式可能误杀用户自己的进程。

建议：

```text
Yisi starts process group
        ↓
Stop requested
        ↓
SIGTERM controlled group
        ↓
grace period
        ↓
still alive
        ↓
SIGKILL controlled group
```

当前 Linux adapter 以 detached child 建立 Yisi 自有进程组，只向 `-child.pid` 定向发送信号；不使用 `pkill`、进程名匹配或 shell。`ESRCH` 归一为进程组已结束。该实现仍需在 Ubuntu LTS 与 Debian stable 验证真实构建子树。

---

## 9. Terminal / PTY

必须区分：

```text
AgentProcessRunner
```

和：

```text
InteractiveTerminalBridge
```

### AgentProcessRunner

用于：

- build
- test
- lint
- typecheck
- ruyi
- git
- cmake
- ninja
- make
- clang
- gcc
- python script

要求：

- 可捕获 stdout/stderr。
- 可读取 exit code。
- 可中止。
- 可超时。
- 可限制输出。
- 能返回结构化 ToolResult。

### InteractiveTerminalBridge

用于：

- REPL。
- 用户输入密码。
- 真正 TTY 程序。
- 长时间交互命令。

不要让 Agent 通过读取 Terminal UI 文本判断：

> “测试是不是通过了”。

验证必须优先依赖 ProcessRunner 的结构化结果。

---

## 10. sudo / root / 系统级操作

Yisi 默认运行身份：

> 当前 Linux 用户。

不假定 root。

以下属于高风险：

- sudo。
- su。
- 写 `/etc`。
- 写 `/usr`。
- 写 `/opt`。
- systemctl。
- system service。
- 系统包安装/卸载。
- 大范围 chmod。
- chown。
- shell startup file 修改。
- 用户级系统配置修改。

规则：

- 不收集 sudo 密码。
- 不把 sudo 密码发给 LLM。
- 不把密码写进 ToolCall。
- 不把密码放命令行 argv。
- 需要认证时优先让用户在真实 Terminal 完成。
- Full Access 不等于 root access。

---

## 11. Linux 安全边界

Permission Engine 至少需要识别：

- `rm -rf`
- destructive glob
- shell injection
- command substitution
- redirection
- symlink traversal
- workspace 外写入
- chmod/chown
- curl | sh
- wget | sh
- systemctl
- package manager
- Git destructive commands
- shell startup files
- credential exposure

不能只做：

```ts
command.includes("rm")
```

这种脆弱字符串判断。

应尽量把执行请求结构化为：

```text
ToolAction
├── executable
├── args
├── cwd
├── target paths
├── mutation type
├── network access
├── privilege requirement
└── risk metadata
```

然后由 PermissionEngine 判断。

---

## 12. RuyiSDK Linux 运行规则

当前 Ruyi 只需要在 Linux 本机探测。

推荐：

```bash
command -v ruyi
```

然后通过：

```text
RuyiPort
   ↓
RuyiCliAdapter
   ↓
ruyi --porcelain ...
```

核心约束不变：

- 不解析面向人类的 CLI 输出。
- 不直接依赖 ruyisdk-vscode-extension 内部 service/provider。
- 不把 ruyi 路径写死。
- 不在业务代码里到处 spawn `ruyi`。
- 所有 Ruyi 操作集中经过 adapter。
- stdout/stderr/exit code/schema validation 统一处理。

---

## 13. Toolchain / Build Environment

必须识别：

- PATH。
- CC。
- CXX。
- LD。
- AR。
- SYSROOT。
- CMAKE_TOOLCHAIN_FILE。
- Ruyi venv/toolchain 环境。

Yisi 不应假定：

```text
gcc == target compiler
```

更不能因为项目目标是 RISC-V，就假设运行 Yisi 的 Linux 本机 CPU 是 RISC-V。

需要区分：

```text
Host Architecture
Target Architecture
```

例如：

```text
Host: x86_64 Linux
Target: riscv64
```

这是正常场景。

---

## 14. Git / Worktree

当前 worktree 只针对 Linux 本机。

要求：

- Git 在本机探测。
- 支持路径空格/Unicode。
- 不假定默认分支名。
- 支持 dirty repo 检测。
- worktree 创建前检查 repo 状态。
- 删除 Session 时按用户选择决定是否删 worktree。
- 有未提交改动时再次警告。
- 不直接修改 `.git/worktrees` 内部 metadata。
- cleanup 失败时提供恢复信息。

并发策略：

```text
Session A：只读
Session B：只读
→ 可并行

Session A：写当前 workspace
Session B：也要写
→ 建议创建隔离 worktree
```

---

## 15. Repo Search / Index

Linux 大仓库不要为每个文件创建 watcher。

必须有：

- `.gitignore` 支持。
- binary detection。
- file size limit。
- max files。
- time budget。
- cancellation。
- symlink cycle protection。
- debounce。
- disposable cleanup。

Folder context 默认：

> 搜索范围，而不是把整个文件夹塞进 prompt。

---

## 16. Encoding / EOL / Binary

默认以 UTF-8 文本优先处理。

但必须：

- binary detection。
- decode failure handling。
- 保留原 EOL。
- 不强制 CRLF → LF。
- 不因一次小修改导致全文件格式变化。
- 检测异常大 diff。

---

## 17. Linux Packaging

第一阶段优先：

> Pure TypeScript / JavaScript。

尽量避免 native dependency。

原因：

- VSIX 打包简单。
- Linux 发行版兼容性更好。
- 不受 ABI 影响。
- 后续 Remote/不同 CPU 架构也更容易。

如未来引入：

- node-pty
- native sqlite
- native tokenizer
- native watcher

必须单独评估：

```text
License
ABI
Node/Electron version
x86_64
arm64
riscv64
VSIX packaging
CI
```

不能因为“npm install 能装”就直接加入闭源项目。

---

## 18. 当前 Linux 验收矩阵

### 必须通过

LNX-001 Linux 本机 VS Code 正常激活 Yisi。

LNX-002 Linux workspace 可 read/search/edit。

LNX-003 `ruyi` 本机存在时可正确检测。

LNX-004 `ruyi` 不存在时给出明确诊断，不崩溃。

LNX-005 路径带中文/空格时 read/edit/build 正常。

LNX-006 大小写不同文件不会混淆。

LNX-007 symlink 不允许绕权限边界。

LNX-008 修改 executable script 后 executable bit 不丢。

LNX-009 `.bashrc` 未显式加载时 Yisi 仍能工作。

LNX-010 普通用户权限运行正常。

LNX-011 sudo/system mutation 会进入高风险权限流程。

LNX-012 ProcessRunner 可获得 stdout/stderr/exit code。

LNX-013 Stop 后不留下 Yisi 管理的构建孤儿进程。

LNX-014 build 输出超限时进行截断/摘要而不是塞爆上下文。

LNX-015 Git repo 中 worktree 隔离正常。

LNX-016 非 Git workspace 仍可进行基础 Agent 操作。

LNX-017 Ubuntu LTS 完成完整 smoke test。

LNX-018 Debian stable 至少完成核心 smoke test。

LNX-019 Host Architecture 与 Target Architecture 不混淆。

LNX-020 没有可用验证时不得宣称“已验证完成”。

---

## 19. Remote-SSH 后续扩展占位

Remote-SSH **现在不实现、不验收、不作为 v1.0 交付门槛**。

但是以下抽象必须保留：

```text
ExecutionWorkspace
PlatformAdapter
ProcessRunner
EnvironmentSnapshot
FileSystemPort
GitPort
RuyiPort
```

未来加入 Remote-SSH 时，应通过新增/扩展 adapter 来完成，而不是修改：

```text
Agent Core
Permission Engine
Session model
Tool protocol
Validation engine
```

当前代码禁止出现：

```text
if remote...
if ssh...
```

散落在 Agent Core 中。

未来 Remote-SSH 需求正式启动时，再单独制定：

```text
REMOTE_PLATFORM_CONTRACT.md
```

并增加独立验收矩阵。

---

## 20. 开发红线

任何 Coding Agent 修改底层代码前必须检查：

- 是否以 Linux 本机为当前正式运行场景？
- 是否错误加入 Remote-SSH 当前版本逻辑？
- 是否假定 `.bashrc` 一定加载？
- 是否假定 `/bin/sh` 是 bash？
- 是否假定 root？
- 是否用 shell string 代替结构化 executable + args？
- 是否只 kill 父 PID？
- 是否破坏 Unix permission / executable bit？
- 是否忽略 symlink？
- 是否忽略 case-sensitive 路径？
- 是否引入 native dependency？
- 是否把发行版特有逻辑写进 Agent Core？
- 是否把 future remote concerns 污染当前业务层？

如果出现上述问题，必须优先修正 adapter / contract。

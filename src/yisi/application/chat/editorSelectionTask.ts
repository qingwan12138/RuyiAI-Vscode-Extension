// Editor selection-task message composer (pure, dependency-free so it is fully
// unit-testable without vscode).
//
// The command layer (vscode adapter) only collects the selection; everything the
// model sees is assembled here: a labelled task header, the source location, a
// fenced code block of the selection, and per-kind instructions oriented at the
// contract languages (C/C++/Java) while staying generic for every other editor
// language.

export type EditorSelectionTaskKind = 'explain' | 'comment' | 'unitTests';

export interface EditorSelectionTaskContext {
  fileName: string;
  languageId: string;
  lineStart: number;
  lineEnd: number;
  code: string;
}

/** Hard cap on the selection chars sent as model context from the editor. */
export const MAX_SELECTION_TASK_CHARS = 12_000;

const TASK_LABEL: Readonly<Record<EditorSelectionTaskKind, string>> = {
  explain: '解释这段代码',
  comment: '为这段代码生成注释',
  unitTests: '为这段代码生成单元测试'
};

const TASK_INSTRUCTION: Readonly<Record<EditorSelectionTaskKind, string>> = {
  explain:
    '请用中文解释选中代码：它的功能、关键实现思路、输入输出，以及潜在的问题或改进点。'
    + '若涉及 RISC-V/嵌入式相关内容，请结合目标平台说明。回答使用中文，必要时保留代码术语原文。',
  comment:
    '请为选中代码生成注释，注释语言与项目内既有代码风格保持一致（中文或英文均可，不要混用两种语言注释）。'
    + '要求：函数/类/重要数据结构给出文档级注释；关键分支与复杂表达式给出简短行内注释；'
    + '不要逐行翻译代码，注释应说明“为什么”而不是复述“是什么”。'
    + '输出可直接替换选区的完整代码（保留原有代码，只在其上添加注释）。',
  unitTests:
    '请为选中代码生成单元测试。若你启用了工作区工具，可先调用 inspect_project 识别项目构建/测试框架，'
    + '再读取项目构建文件确认约定：C/C++ 优先 CMake/ctest、GoogleTest、Catch2；'
    + 'Java 优先 JUnit（按项目实际构建工具 Maven/Gradle 判断）；Node/Python/Rust/Go 同理。'
    + '当权限允许时可在正确位置创建测试文件并运行验证；否则在回复中给出完整、可直接编译运行的测试源码，'
    + '并说明应放置的文件路径与如何接入构建。'
    + '测试应覆盖正常路径与关键边界/错误路径，避免只做“无意义冒烟”。'
};

/** Human-readable language label used in the location header. */
export function languageDisplayName(languageId: string): string {
  const id = (languageId || '').trim().toLowerCase();
  switch (id) {
    case 'c': return 'C';
    case 'cpp': return 'C++';
    case 'csharp': return 'C#';
    case 'java': return 'Java';
    case 'javascript':
    case 'js': return 'JavaScript';
    case 'typescript':
    case 'ts': return 'TypeScript';
    case 'python':
    case 'py': return 'Python';
    case 'rust':
    case 'rs': return 'Rust';
    case 'go': return 'Go';
    case 'shellscript':
    case 'bash':
    case 'sh': return 'Shell';
    case 'plaintext':
    case 'text': return 'text';
    default: return id || 'text';
  }
}

/** Fence token safe for markdown code fences; falls back to '' (no highlight). */
export function selectionFenceToken(languageId: string): string {
  const id = (languageId || '').trim().toLowerCase();
  if (!id || id === 'plaintext' || id === 'text') return '';
  if (KNOWN_FENCE_TOKENS.has(id)) return id;
  if (/^[a-z0-9_]+$/.test(id)) return id;
  return '';
}

const KNOWN_FENCE_TOKENS: ReadonlySet<string> = new Set([
  'c', 'cpp', 'csharp', 'java', 'javascript', 'js', 'typescript', 'ts', 'jsx',
  'tsx', 'python', 'py', 'rust', 'rs', 'go', 'bash', 'sh', 'shell', 'json',
  'jsonc', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'scss', 'sql', 'diff',
  'makefile', 'cmake', 'dockerfile', 'ini', 'properties', 'kotlin', 'kt',
  'swift', 'objective-c', 'php', 'ruby', 'rb', 'perl', 'lua', 'vim', 'zig',
  'cobol', 'fortran', 'ada', 'haskell', 'hs', 'elixir', 'ex', 'erlang', 'erl'
]);

/**
 * Compose the full user message for an editor selection task.
 * A too-long selection is truncated to {@link MAX_SELECTION_TASK_CHARS} with an
 * explicit note so the model is never silently missing the tail.
 *
 * `projectProfileSummary` (optional) carries detected build/test framework
 * context; it is appended for unit-test tasks so the model targets the real
 * framework. Other task kinds ignore it.
 */
export function buildSelectionTaskMessage(
  kind: EditorSelectionTaskKind,
  context: EditorSelectionTaskContext,
  projectProfileSummary?: string
): string {
  const code = requireSelectionText(context.code);
  const fileName = requireNonBlank(context.fileName, 'Selection file name');
  const language = context.languageId && context.languageId.trim()
    ? context.languageId.trim().toLowerCase()
    : 'plaintext';
  const lineStart = requirePositiveLine(context.lineStart);
  const lineEnd = Math.max(lineStart, requirePositiveLine(context.lineEnd));
  const languageLabel = languageDisplayName(language);
  const fence = selectionFenceToken(language);
  const truncated = code.length > MAX_SELECTION_TASK_CHARS;
  const body = truncated ? `${code.slice(0, MAX_SELECTION_TASK_CHARS)}\n` : code;
  const truncatedNote = truncated
    ? `\n\n> 注：选区超过 ${MAX_SELECTION_TASK_CHARS} 字符，已截断为前 ${MAX_SELECTION_TASK_CHARS} 字符。如需要请分多次选取。`
    : '';
  const blocks = [
    `[选区任务] ${TASK_LABEL[kind]}`,
    `位置：${fileName} · ${languageLabel} · 第 ${lineStart}–${lineEnd} 行`,
    '',
    '```' + fence,
    body,
    '```' + truncatedNote,
    ''
  ];
  if (kind === 'unitTests' && projectProfileSummary && projectProfileSummary.trim()) {
    blocks.push('[项目探测结果]', projectProfileSummary.trim(), '');
  }
  blocks.push(TASK_INSTRUCTION[kind]);
  return blocks.join('\n');
}

function requireSelectionText(code: string): string {
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new Error('Selection task requires selected code text.');
  }
  return code;
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requirePositiveLine(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Selection line numbers must be positive integers.');
  }
  return value;
}

// Project-scope documentation task composer (pure, dependency-free).
//
// Unlike the editor selection tasks, README/API-doc generation targets the
// whole workspace. The vscode command layer only knows how to trigger it; the
// model sees a structured task header, optional project detection output, and
// per-kind instructions that steer it toward the existing agent tools
// (inspect_project / read / write) without inventing shell magic.

export type ProjectDocTaskKind = 'readme' | 'apiDocs';

export interface ProjectDocTaskContext {
  /** Workspace display name, e.g. the root folder name. */
  projectName: string;
  fileName: string;
}

const TASK_LABEL: Readonly<Record<ProjectDocTaskKind, string>> = {
  readme: '生成项目 README',
  apiDocs: '生成 API 文档'
};

const TASK_INSTRUCTION: Readonly<Record<ProjectDocTaskKind, string>> = {
  readme:
    '请分析当前工作区并为整个项目生成一份 README 文档。先用可用工具（read_file/list_directory/'
    + 'inspect_project/search_text）了解项目结构、构建方式、入口与约定，再输出 markdown。'
    + 'README 建议包含：项目简介与定位、目录结构、环境要求与安装、构建/运行/测试命令、主要功能/用法示例、'
    + '常见问题与维护者信息占位。若工作区根已存在 README.md：请先读取它，在尊重既有内容的前提下给出改进后的完整版本；'
    + '你只能新建不会覆盖现有路径的文件，因此若需替换请用 replace_text 分块修改，或用新的文件名并说明迁移方式。'
    + '若你启用了工作区工具且当前权限允许，可在根目录创建或更新 README；否则在回复中给出完整 markdown。'
    + '完成后若有测试命令建议，可运行 run_validations 验证你对构建/测试说明的准确性。',
  apiDocs:
    '请分析当前工作区并生成面向使用者的 API 文档。先用可用工具了解公共接口：C/C++ 关注头文件中的导出函数/类/宏与'
    + 'Doxygen 风格注释；Java 关注 public 类/方法（Javadoc）；其他语言同理取公共符号。'
    + '输出为结构化 markdown，按模块/类分组，每个条目给出签名、参数、返回值、示例与注意事项；'
    + '对未注释的导出符号，给出建议注释文本。可新建 docs/API.md 或对应语言命名（如 README 中链接到的文档路径），'
    + '不得覆盖任何现有文件；如需更新既有文档请用 replace_text 分块修改。'
    + '若你启用了工作区工具且当前权限允许，可将文档落盘；否则在回复中给出完整 markdown。'
};

/**
 * Compose the user message for a project-scope documentation task.
 * `projectProfileSummary` is the best-effort detector output; when present it is
 * embedded so the model targets the real build/test setup.
 */
export function buildProjectDocTaskMessage(
  kind: ProjectDocTaskKind,
  context: ProjectDocTaskContext,
  projectProfileSummary?: string
): string {
  const projectName = requireNonBlank(context.projectName, 'Project name');
  const fileName = requireNonBlank(context.fileName, 'Workspace display path');
  const blocks = [
    `[项目任务] ${TASK_LABEL[kind]}`,
    `范围：${projectName}（${fileName}，整个工作区，无选区）`,
    ''
  ];
  if (projectProfileSummary && projectProfileSummary.trim()) {
    blocks.push('[项目探测结果]', projectProfileSummary.trim(), '');
  }
  blocks.push(TASK_INSTRUCTION[kind]);
  return blocks.join('\n');
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

// Extension-Host journal viewer (C4): navigate recent agent workspace writes,
// inspect a line-level diff in an OutputChannel, and undo the most recent one.
// Kept intentionally thin: all diff/undo semantics live in WorkspaceEditService.

import * as vscode from 'vscode';
import { WorkspaceEditService, EditJournalViewEntry } from '../application/edit/workspaceEditService';

const KIND_GLYPH: Readonly<Record<string, string>> = {
  create_text_file: '＋',
  replace_text: '✎',
  rewrite_text_file: '⟳',
  delete_file: '－',
  rename_file: '⇄',
  create_directory: '📁'
};

export class EditJournalViewer {
  private readonly output = vscode.window.createOutputChannel('Yisi AI · Edit Journal');

  constructor(private readonly edits: WorkspaceEditService) {}

  async show(): Promise<void> {
    const entries = [...this.edits.journalSnapshot()].reverse(); // newest first
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('Yisi AI: 本轮会话还没有 agent 工作区写操作。');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map(entry => ({
        label: `${KIND_GLYPH[entry.kind] ?? '·'} ${entry.kind} ${entry.path}`,
        description: describe(entry),
        entry
      })),
      { title: 'Yisi AI · Edit Journal (this run)', placeHolder: '选择一次写操作' }
    );
    if (!picked) return;

    const action = await vscode.window.showQuickPick([
      { label: '查看差异 / 说明', action: 'diff' as const },
      { label: '撤销最近一次写操作', detail: picked.entry.isMostRecent ? '' : '仅能撤销最近一次；更早的条目其上有更新的操作', action: 'undo' as const },
      { label: '← 返回', action: 'back' as const }
    ], { title: `Yisi AI · ${picked.entry.kind} ${picked.entry.path}` });
    if (!action || action.action === 'back') return;

    if (action.action === 'diff') {
      const diff = this.edits.journalDiffText(picked.entry.id);
      this.output.clear();
      this.output.appendLine(diff ? diff.text : '该条目不包含可展示的差异文本。');
      this.output.show(true);
      return;
    }
    if (!picked.entry.isMostRecent) {
      const latest = entries[0];
      void vscode.window.showWarningMessage(
        `只能撤销最近一次写操作。当前最近的是 ${latest.kind} ${latest.path}，是否撤销它？`,
        '撤销',
        '取消'
      ).then(choice => {
        if (choice === '撤销') void this.undoLatest();
      });
      return;
    }
    await this.undoLatest();
  }

  private async undoLatest(): Promise<void> {
    const result = await this.edits.undoLastEdit({}, new AbortController().signal);
    if (result.undone) {
      void vscode.window.showInformationMessage(`Yisi AI: 已撤销 ${result.kind} ${result.path}。`);
    } else {
      void vscode.window.showWarningMessage(`Yisi AI: 无法撤销 — ${result.reason ?? '未知原因'}`);
    }
  }
}

function describe(entry: EditJournalViewEntry): string {
  const counts = entry.addedLines !== undefined || entry.removedLines !== undefined
    ? ` +${entry.addedLines ?? 0}/-${entry.removedLines ?? 0}`
    : '';
  const state = entry.reversibility === 'reversible' ? '可撤销' : '不可自动撤销';
  return `${state}${counts}${entry.reason ? ` · ${entry.reason}` : ''}`;
}

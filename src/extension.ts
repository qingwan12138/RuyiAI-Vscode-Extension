import * as vscode from 'vscode';
import { registerYisiAI } from './yisi';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await registerYisiAI(context);
}

export function deactivate(): void {
  // Runtime-owned processes will eventually be terminated by the ProcessManager.
}

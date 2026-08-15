import * as vscode from 'vscode';

/** Execute all code cells from the top through the active cell (inclusive). */
export async function runToHere(): Promise<void> {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active notebook. Open a .pgsql notebook first.');
    return;
  }

  const { notebook, selection } = editor;
  if (notebook.notebookType !== 'postgres-notebook' && notebook.notebookType !== 'postgres-query') {
    vscode.window.showWarningMessage('Run to here is only available in NexQL notebooks.');
    return;
  }

  const endIndex = Math.max(0, selection.start);
  const ranges: vscode.NotebookRange[] = [];

  for (let i = 0; i <= endIndex && i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    if (cell.kind === vscode.NotebookCellKind.Code) {
      ranges.push(new vscode.NotebookRange(i, i + 1));
    }
  }

  if (ranges.length === 0) {
    vscode.window.showInformationMessage('No code cells to run.');
    return;
  }

  await vscode.commands.executeCommand('notebook.execute', {
    ranges,
    document: notebook.uri,
  });
}

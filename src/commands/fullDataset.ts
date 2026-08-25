import * as vscode from 'vscode';
import { SqlSafetyAnalyzer } from '../services/sqlSafety';
import { FullDatasetPreferenceService } from '../services/FullDatasetPreferenceService';
import { QueryCodeLensProvider } from '../providers/QueryCodeLensProvider';
import { SqlParser } from '../providers/kernel/SqlParser';
import { isQueryStudioSqlDocument } from '../lib/nexqlSqlDocument';
import { resolveRunnableSqlFromDocument } from '../lib/resolveRunnableSql';

function resolveNotebookCell(cell?: vscode.NotebookCell): vscode.NotebookCell | undefined {
  if (cell) {
    return cell;
  }
  const editor = vscode.window.activeNotebookEditor;
  if (editor?.selection && editor.selection.start < editor.notebook.cellCount) {
    return editor.notebook.cellAt(editor.selection.start);
  }
  return undefined;
}

export async function toggleFullDatasetFromCell(cell?: vscode.NotebookCell): Promise<void> {
  const target = resolveNotebookCell(cell);
  if (!target) {
    const studioEditor = resolveQueryStudioEditor();
    if (studioEditor) {
      await toggleFullDatasetForDocument(studioEditor.document);
      return;
    }
    vscode.window.showWarningMessage('Open a SQL notebook cell or Query Studio editor to toggle full dataset mode.');
    return;
  }

  const text = target.document.getText().trim();
  if (/^\s*EXPLAIN/i.test(text)) {
    vscode.window.showWarningMessage('Full dataset mode is not available for EXPLAIN queries.');
    return;
  }
  if (!SqlSafetyAnalyzer.getInstance().isReadOnlyQuery(text)) {
    vscode.window.showWarningMessage('Full dataset mode is only available for read-only SELECT queries.');
    return;
  }

  const params = SqlParser.detectParameters(text);
  if (params.positional.length > 0 || params.named.length > 0 || params.quoted.length > 0) {
    vscode.window.showWarningMessage('Full dataset mode is not available for parameterized queries.');
    return;
  }

  await toggleFullDatasetForCell(target.document.uri);
}

export async function toggleFullDatasetForCell(cellUri?: vscode.Uri): Promise<void> {
  const uri = cellUri ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    vscode.window.showWarningMessage('Open a SQL notebook cell or Query Studio editor to toggle full dataset mode.');
    return;
  }
  if (uri.scheme === 'vscode-notebook-cell') {
    await toggleFullDatasetForDocumentUri(uri);
    return;
  }
  if (isQueryStudioSqlDocument(await vscode.workspace.openTextDocument(uri))) {
    await toggleFullDatasetForDocumentUri(uri);
    return;
  }
  vscode.window.showWarningMessage('Open a SQL notebook cell or Query Studio editor to toggle full dataset mode.');
}

async function toggleFullDatasetForDocument(document: vscode.TextDocument): Promise<void> {
  const text = resolveRunnableSqlFromDocument(document).trim();
  if (/^\s*EXPLAIN/i.test(text)) {
    vscode.window.showWarningMessage('Full dataset mode is not available for EXPLAIN queries.');
    return;
  }
  if (!SqlSafetyAnalyzer.getInstance().isReadOnlyQuery(text)) {
    vscode.window.showWarningMessage('Full dataset mode is only available for read-only SELECT queries.');
    return;
  }
  const params = SqlParser.detectParameters(text);
  if (params.positional.length > 0 || params.named.length > 0 || params.quoted.length > 0) {
    vscode.window.showWarningMessage('Full dataset mode is not available for parameterized queries.');
    return;
  }
  await toggleFullDatasetForDocumentUri(document.uri);
}

async function toggleFullDatasetForDocumentUri(uri: vscode.Uri): Promise<void> {
  const enabled = await FullDatasetPreferenceService.toggle(uri.toString());
  QueryCodeLensProvider.getInstance()?.refresh();
  vscode.window.setStatusBarMessage(
    enabled ? 'Full dataset enabled for this query.' : 'Full dataset disabled for this query.',
    3000,
  );
}

function resolveQueryStudioEditor(): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((ed) => isQueryStudioSqlDocument(ed.document));
}

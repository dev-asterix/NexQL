import * as vscode from 'vscode';
import { SqlParser } from '../providers/kernel/SqlParser';
import { findTextEditorForDocument } from './nexqlSqlDocument';

/** SQL to run or analyze: selection if any, else statement at cursor. */
export function resolveRunnableSqlFromDocument(document: vscode.TextDocument): string {
  const editor = findTextEditorForDocument(document);
  const selection = editor?.selection;
  const anchor = selection?.active ?? new vscode.Position(0, 0);
  const start = selection && !selection.isEmpty ? selection.start : anchor;
  const end = selection && !selection.isEmpty ? selection.end : anchor;
  return SqlParser.resolveExecutableSqlText(
    document.getText(),
    document.offsetAt(start),
    document.offsetAt(end),
  );
}

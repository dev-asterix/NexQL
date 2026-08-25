import * as vscode from 'vscode';
import { registerStudioSession } from '../services/execution/ExecutionSurface';
import { outputChannel } from '../extension';
import { SqlCompletionProvider } from '../providers/SqlCompletionProvider';
import {
  ensureQueryStudioSidecarCached,
  isQueryStudioSqlDocument,
} from './queryStudioSidecarCache';
import { NEXQL_STUDIO_SQL_LANGUAGE } from './nexqlStudioSqlLanguage';

/** Ensure Query Studio scratch SQL is wired for schema completions (language, session, cache). */
export async function bootstrapQueryStudioDocument(document: vscode.TextDocument): Promise<void> {
  if (!isQueryStudioSqlDocument(document)) {
    return;
  }

  if (document.languageId !== NEXQL_STUDIO_SQL_LANGUAGE) {
    try {
      await vscode.languages.setTextDocumentLanguage(document, NEXQL_STUDIO_SQL_LANGUAGE);
    } catch (err) {
      outputChannel?.appendLine(`[QueryStudio] failed to set studio SQL language: ${err}`);
    }
  }

  const conn = await ensureQueryStudioSidecarCached(document.uri);
  if (!conn) {
    outputChannel?.appendLine(
      `[QueryStudio] sidecar missing for ${document.uri.fsPath} — schema completions unavailable`,
    );
    return;
  }

  registerStudioSession({
    uri: document.uri,
    sql: document.getText(),
    connectionId: conn.connectionId,
    database: conn.database,
  });

  const completion = SqlCompletionProvider.getInstance();
  if (completion) {
    await completion.warmCache(conn.connectionId, conn.database);
  }
}

export async function bootstrapQueryStudioUri(sqlUri: vscode.Uri): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(sqlUri);
    await bootstrapQueryStudioDocument(doc);
  } catch (err) {
    outputChannel?.appendLine(`[QueryStudio] bootstrap failed for ${sqlUri.toString()}: ${err}`);
  }
}

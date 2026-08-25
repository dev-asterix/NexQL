import * as vscode from 'vscode';
import { getQueryStudioSidecarUri, isQueryStudioSqlDocument } from './nexqlSqlDocument';

export interface QueryStudioSidecarConnection {
  connectionId: string;
  database: string;
}

const sidecarCache = new Map<string, QueryStudioSidecarConnection>();

export function getCachedQueryStudioConnection(
  sqlUri: vscode.Uri,
): QueryStudioSidecarConnection | undefined {
  return sidecarCache.get(sqlUri.toString());
}

export function setCachedQueryStudioConnection(
  sqlUri: vscode.Uri,
  conn: QueryStudioSidecarConnection,
): void {
  sidecarCache.set(sqlUri.toString(), conn);
}

export function clearQueryStudioSidecarCache(sqlUri?: vscode.Uri): void {
  if (sqlUri) {
    sidecarCache.delete(sqlUri.toString());
    return;
  }
  sidecarCache.clear();
}

async function readSidecarConnection(sqlUri: vscode.Uri): Promise<QueryStudioSidecarConnection | undefined> {
  const candidates = [
    getQueryStudioSidecarUri(sqlUri),
    vscode.Uri.file(`${sqlUri.fsPath.replace(/[/\\][^/\\]+$/, '')}/session.meta.json`),
  ];

  for (const sidecarUri of candidates) {
    try {
      const raw = await vscode.workspace.fs.readFile(sidecarUri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as {
        connectionId?: string;
        database?: string;
      };
      if (parsed.connectionId && parsed.database) {
        return { connectionId: parsed.connectionId, database: parsed.database };
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export async function ensureQueryStudioSidecarCached(
  sqlUri: vscode.Uri,
): Promise<QueryStudioSidecarConnection | undefined> {
  const key = sqlUri.toString();
  const existing = sidecarCache.get(key);
  if (existing) {
    return existing;
  }
  const conn = await readSidecarConnection(sqlUri);
  if (conn) {
    sidecarCache.set(key, conn);
  }
  return conn;
}

export { isQueryStudioSqlDocument };

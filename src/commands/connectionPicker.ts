import * as vscode from 'vscode';
import type { ConnectionConfig } from '../common/types';
import { ConnectionManager } from '../services/ConnectionManager';

export interface ConnectionPickItem extends vscode.QuickPickItem {
  connection: ConnectionConfig & { id: string };
}

export interface PickedConnectionDatabase {
  connection: ConnectionConfig & { id: string };
  databaseName: string;
}

/**
 * Palette flow: pick a saved connection, then a database on that server.
 * Returns undefined when the user cancels or no connections exist.
 */
export async function pickSavedConnectionAndDatabase(
  titlePrefix = 'Query Tool',
): Promise<PickedConnectionDatabase | undefined> {
  const connections =
    vscode.workspace.getConfiguration().get<(ConnectionConfig & { id: string })[]>('postgresExplorer.connections') ??
    [];
  if (connections.length === 0) {
    await vscode.window.showErrorMessage('No saved connections. Add one in NexQL Settings.');
    return undefined;
  }

  const connPick = await vscode.window.showQuickPick<ConnectionPickItem>(
    connections.map((connection) => ({
      label: connection.name || `${connection.host}:${connection.port}`,
      description: connection.database || 'postgres',
      connection,
    })),
    { title: `${titlePrefix}: Connection`, placeHolder: 'Select connection' },
  );
  if (!connPick) {
    return undefined;
  }

  const connection = connPick.connection;
  const bootstrapDb = connection.database || 'postgres';

  let tempClient;
  try {
    tempClient = await ConnectionManager.getInstance().getPooledClient({
      ...connection,
      database: bootstrapDb,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(`Could not connect: ${message}`);
    return undefined;
  }

  try {
    const dbsResult = await tempClient.query(`
      SELECT datname FROM pg_database
      WHERE datallowconn AND NOT datistemplate
      ORDER BY datname
    `);
    const databases = dbsResult.rows.map((row: { datname: string }) => row.datname);
    const dbPick = await vscode.window.showQuickPick(
      databases.map((d) => ({ label: d })),
      { title: `${titlePrefix}: Database`, placeHolder: 'Select database' },
    );
    if (!dbPick) {
      return undefined;
    }
    return { connection, databaseName: dbPick.label };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(`Failed to list databases: ${message}`);
    return undefined;
  } finally {
    tempClient?.release?.();
  }
}

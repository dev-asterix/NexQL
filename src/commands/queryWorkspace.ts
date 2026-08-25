import * as vscode from 'vscode';
import type { PostgresMetadata } from '../common/types';
import { createMetadata } from './connection';
import { pickSavedConnectionAndDatabase } from './connectionPicker';
import { openOrCreateNotebookWithPicker } from './notebook';

export type QueryDefaultExperience = 'notebook' | 'queryStudio';

export const QUERY_DEFAULT_EXPERIENCE_KEY = 'postgresExplorer.query.defaultExperience';

export function getQueryDefaultExperience(): QueryDefaultExperience {
  const value = vscode.workspace
    .getConfiguration('postgresExplorer.query')
    .get<string>('defaultExperience', 'notebook');
  return value === 'queryStudio' ? 'queryStudio' : 'notebook';
}

export async function setQueryDefaultExperience(value: QueryDefaultExperience): Promise<void> {
  await vscode.workspace
    .getConfiguration('postgresExplorer.query')
    .update('defaultExperience', value, vscode.ConfigurationTarget.Global);
}

/**
 * Opens the user's preferred SQL workspace (notebook or Query Studio).
 */
export async function openDefaultQueryWorkspace(
  metadata: PostgresMetadata,
  context: vscode.ExtensionContext,
  notebookCells?: Array<{ kind: 'markdown' | 'sql'; value: string }>,
  pickerTitle?: string,
): Promise<void> {
  if (getQueryDefaultExperience() === 'queryStudio') {
    try {
      const { isProBuild } = await import('../common/buildTier');
      if (isProBuild()) {
        const { openQueryStudioForMetadata } = await import('@nexql/pro');
        const sql = notebookCells?.find((c) => c.kind === 'sql')?.value;
        await openQueryStudioForMetadata(metadata, context, sql);
        return;
      }
    } catch {
      /* fall through */
    }
  }

  await openOrCreateNotebookWithPicker(metadata, notebookCells ?? [], context, pickerTitle ?? 'Open Query Workspace');
}

/** Command palette / keybinding when no explorer node is selected. */
export async function cmdQueryToolFromPalette(context: vscode.ExtensionContext): Promise<void> {
  const picked = await pickSavedConnectionAndDatabase('Query Tool');
  if (!picked) {
    return;
  }

  const metadata = createMetadata(picked.connection, picked.databaseName);
  await openDefaultQueryWorkspace(
    metadata,
    context,
    [
      {
        kind: 'markdown',
        value: `# Query Tool: \`${picked.databaseName}\`\n\nWrite and execute SQL queries against this database.`,
      },
      {
        kind: 'sql',
        value: `-- Write your SQL query here\nSELECT 1;`,
      },
    ],
    `Open or Create Notebook (${picked.databaseName})`,
  );
}

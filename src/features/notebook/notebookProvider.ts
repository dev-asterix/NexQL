import * as vscode from 'vscode';
import { pickNexqlCellMetadata, type NexqlCellMetadata } from './cellMetadata';

interface PostgresCell {
  kind: 'markdown' | 'sql';
  value: string;
  language?: 'markdown' | 'sql' | 'postgres';
  metadata?: NexqlCellMetadata;
}

interface NotebookMetadata {
  connectionId: string;
  databaseName: string;
  host: string;
  port: number;
  syncId?: string;
  username?: string;
  password?: string;
}

export class PostgresNotebookProvider implements vscode.NotebookSerializer {
  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    let metadata: NotebookMetadata | undefined;
    let cells: vscode.NotebookCellData[] = [];

    if (content.byteLength > 0) {
      try {
        const data = JSON.parse(Buffer.from(content).toString());
        if (data.metadata) {
          metadata = data.metadata as NotebookMetadata;
          const metaRecord = metadata as unknown as Record<string, unknown>;
          delete metaRecord.password;
          delete metaRecord.username;
          const custom = metaRecord.custom as { metadata?: Record<string, unknown> } | undefined;
          if (custom?.metadata) {
            delete custom.metadata.password;
            delete custom.metadata.username;
          }
        }
        if (Array.isArray(data.cells)) {
          cells = data.cells.map((cell: PostgresCell) => {
            const isMarkdown = cell.kind === 'markdown';
            const cellData = new vscode.NotebookCellData(
              isMarkdown ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
              cell.value,
              isMarkdown ? 'markdown' : 'sql'
            );
            const picked = pickNexqlCellMetadata(cell.metadata as Record<string, unknown> | undefined);
            if (picked) {
              cellData.metadata = picked;
            }
            return cellData;
          });
        }
      } catch {
        cells = [
          new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            '-- Write your SQL query here\nSELECT NOW();',
            'sql'
          )
        ];
      }
    } else {
      cells = [
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          '-- Write your SQL query here\nSELECT NOW();',
          'sql'
        )
      ];
    }

    const notebookData = new vscode.NotebookData(cells);
    if (metadata) {
      const cleanMetadata = { ...metadata };
      delete (cleanMetadata as Record<string, unknown>).password;
      delete (cleanMetadata as Record<string, unknown>).username;
      delete (cleanMetadata as any).custom;
      notebookData.metadata = {
        ...cleanMetadata,
        custom: {
          cells: [],
          metadata: {
            ...cleanMetadata,
            enableScripts: true
          }
        }
      };
    }
    return notebookData;
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const cells: PostgresCell[] = data.cells.map((cell): PostgresCell => {
      const picked = pickNexqlCellMetadata(cell.metadata as Record<string, unknown> | undefined);
      return {
        value: cell.value,
        kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'sql',
        language: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'sql',
        ...(picked ? { metadata: picked } : {}),
      };
    });

    const cleanMetadata = data.metadata ? { ...data.metadata } : {};
    delete (cleanMetadata as any).custom;
    delete (cleanMetadata as Record<string, unknown>).password;
    delete (cleanMetadata as Record<string, unknown>).username;

    const serializedMeta = { ...cleanMetadata };
    delete (serializedMeta as Record<string, unknown>).password;
    delete (serializedMeta as Record<string, unknown>).username;

    const metadata = {
      ...serializedMeta,
      custom: {
        cells: cells,
        metadata: {
          ...serializedMeta,
          enableScripts: true
        }
      }
    };

    return Buffer.from(JSON.stringify({
      cells,
      metadata
    }));
  }
}

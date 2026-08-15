import * as vscode from 'vscode';
import { QueryHistoryService, QueryHistoryItem } from '../services/QueryHistoryService';
import { NotebookBuilder } from './helper';
import { ConnectionUtils } from '../utils/connectionUtils';

type HistoryFilter = 'all' | 'failed' | 'slow';

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function flattenQueryLabel(query: string): string {
  const clean = query.replace(/^(\s*(--.*)|(\/\*[\s\S]*?\*\/)\s*)*/gm, '').trim();
  const flat = clean.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat || '<empty query>';
}

async function openHistoryItemInNotebook(item: QueryHistoryItem): Promise<void> {
  if (!item.connectionId) {
    const builder = new NotebookBuilder({});
    builder.addSql(item.query);
    await builder.show();
    return;
  }

  const connection = ConnectionUtils.findConnection(item.connectionId);
  if (!connection) {
    vscode.window.showErrorMessage('Connection for this history entry no longer exists.');
    return;
  }

  const { SecretStorageService } = await import('../services/SecretStorageService');
  const password = await SecretStorageService.getInstance().getPassword(item.connectionId);

  const metadata = {
    connectionId: item.connectionId,
    databaseName: item.databaseName || connection.database,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: password || connection.password,
    name: connection.name,
    custom: {
      cells: [],
      metadata: {
        connectionId: item.connectionId,
        databaseName: item.databaseName || connection.database,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        enableScripts: true,
      },
    },
  };

  const builder = new NotebookBuilder(metadata);
  builder.addSql(item.query);
  await builder.showNew();
}

export async function showQueryHistory(): Promise<void> {
  const service = QueryHistoryService.getInstance();
  let filter: HistoryFilter = 'all';
  let connectionFilter: string | undefined;
  let databaseFilter: string | undefined;

  const connections = ConnectionUtils.getConnections();
  const databases = new Set<string>();

  for (const item of service.getHistory()) {
    if (item.databaseName) {
      databases.add(item.databaseName);
    }
  }

  const buildItems = (): vscode.QuickPickItem[] => {
    const chips: vscode.QuickPickItem[] = [
      {
        label: '$(filter) Filters',
        kind: vscode.QuickPickItemKind.Separator,
      },
      {
        label: filter === 'all' ? '$(check) Show: all' : 'Show: all',
        description: 'All queries',
        detail: '__filter__:all',
      },
      {
        label: filter === 'failed' ? '$(check) Show: failed only' : 'Show: failed only',
        detail: '__filter__:failed',
      },
      {
        label: filter === 'slow' ? '$(check) Show: slow only' : 'Show: slow only',
        detail: '__filter__:slow',
      },
    ];

    if (connections.length > 0) {
      chips.push({
        label: connectionFilter
          ? `$(check) Connection: ${connections.find((c) => c.id === connectionFilter)?.name || connectionFilter}`
          : 'Connection: any',
        detail: '__connection__',
      });
    }

    if (databases.size > 0) {
      chips.push({
        label: databaseFilter ? `$(check) Database: ${databaseFilter}` : 'Database: any',
        detail: '__database__',
      });
    }

    const results = service.search('', {
      failedOnly: filter === 'failed',
      slowOnly: filter === 'slow',
      connectionId: connectionFilter,
      databaseName: databaseFilter,
    });

    const pinned = service.getPinned();
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const unpinned = results.filter((r) => !pinnedIds.has(r.id));

    const historyItems: vscode.QuickPickItem[] = [];

    if (pinned.length > 0) {
      historyItems.push({ label: 'Pinned', kind: vscode.QuickPickItemKind.Separator });
      for (const item of pinned) {
        historyItems.push(historyItemToQuickPick(item));
      }
    }

    if (unpinned.length > 0) {
      historyItems.push({ label: 'Recent', kind: vscode.QuickPickItemKind.Separator });
      for (const item of unpinned.slice(0, 100)) {
        historyItems.push(historyItemToQuickPick(item));
      }
    }

    return [...chips, ...historyItems];
  };

  const historyItemToQuickPick = (item: QueryHistoryItem): vscode.QuickPickItem & { historyItem: QueryHistoryItem } => {
    const duration = item.durationMs ?? (item.duration ? item.duration * 1000 : 0);
    const rows = item.rowCount ?? '-';
    const status = item.success ? '$(check)' : '$(error)';
    const slow = item.slow ? ' $(warning)' : '';
    return {
      label: `${status}${slow} ${item.label || flattenQueryLabel(item.query)}`,
      description: [
        duration ? `${duration.toFixed(0)}ms` : undefined,
        `${rows} rows`,
        formatRelativeTime(item.timestamp),
      ]
        .filter(Boolean)
        .join(' · '),
      detail: item.connectionName
        ? `${item.connectionName}${item.databaseName ? ` / ${item.databaseName}` : ''}`
        : undefined,
      historyItem: item,
    };
  };

  const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { historyItem?: QueryHistoryItem }>();
  quickPick.title = 'Query History';
  quickPick.placeholder = 'Search SQL text…';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.items = buildItems();

  quickPick.onDidChangeValue((term) => {
    const chips = buildItems().filter((i) => i.detail?.startsWith('__'));
    const searchResults = service.search(term, {
      failedOnly: filter === 'failed',
      slowOnly: filter === 'slow',
      connectionId: connectionFilter,
      databaseName: databaseFilter,
    });
    const pinned = service.getPinned().filter(
      (p) => !term || p.query.toLowerCase().includes(term.toLowerCase()) || p.label?.toLowerCase().includes(term.toLowerCase()),
    );
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const unpinned = searchResults.filter((r) => !pinnedIds.has(r.id));

    const items: (vscode.QuickPickItem & { historyItem?: QueryHistoryItem })[] = [...chips];
    if (pinned.length > 0) {
      items.push({ label: 'Pinned', kind: vscode.QuickPickItemKind.Separator });
      items.push(...pinned.map((item) => historyItemToQuickPick(item)));
    }
    if (unpinned.length > 0) {
      items.push({ label: 'Recent', kind: vscode.QuickPickItemKind.Separator });
      items.push(...unpinned.slice(0, 100).map((item) => historyItemToQuickPick(item)));
    }
    quickPick.items = items;
  });

  const selected = await new Promise<(vscode.QuickPickItem & { historyItem?: QueryHistoryItem }) | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      resolve(quickPick.selectedItems[0]);
      quickPick.hide();
    });
    quickPick.onDidHide(() => resolve(undefined));
    quickPick.show();
  });

  quickPick.dispose();
  if (!selected) {
    return;
  }

  if (selected.detail === '__filter__:all') {
    filter = 'all';
    return showQueryHistory();
  }
  if (selected.detail === '__filter__:failed') {
    filter = 'failed';
    return showQueryHistory();
  }
  if (selected.detail === '__filter__:slow') {
    filter = 'slow';
    return showQueryHistory();
  }
  if (selected.detail === '__connection__') {
    const pick = await vscode.window.showQuickPick(
      [{ label: 'Any connection', id: '' }, ...connections.map((c) => ({ label: c.name, id: c.id }))],
      { placeHolder: 'Filter by connection' },
    );
    connectionFilter = pick?.id || undefined;
    return showQueryHistory();
  }
  if (selected.detail === '__database__') {
    const pick = await vscode.window.showQuickPick(
      [{ label: 'Any database', db: '' }, ...Array.from(databases).map((db) => ({ label: db, db }))],
      { placeHolder: 'Filter by database' },
    );
    databaseFilter = pick?.db || undefined;
    return showQueryHistory();
  }

  const item = selected.historyItem;
  if (!item) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: '$(notebook) Open in notebook', action: 'notebook' },
      { label: '$(copy) Copy SQL', action: 'copy' },
      { label: item.pinned ? '$(pinned) Unpin' : '$(pin) Pin', action: 'pin' },
      { label: '$(bookmark) Save to library', action: 'save' },
    ],
    { placeHolder: 'Action' },
  );

  if (!action) {
    return;
  }

  switch (action.action) {
    case 'notebook':
      await openHistoryItemInNotebook(item);
      break;
    case 'copy':
      await vscode.env.clipboard.writeText(item.query);
      vscode.window.showInformationMessage('Query copied to clipboard.');
      break;
    case 'pin':
      await service.togglePin(item.id);
      break;
    case 'save':
      await vscode.commands.executeCommand('postgres-explorer.saveQueryToLibraryUI', item.query);
      break;
  }
}

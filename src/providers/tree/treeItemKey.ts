import { DatabaseTreeItem } from '../DatabaseTreeProvider';

export function buildTreeItemKey(item: DatabaseTreeItem): string {
  return [item.type, item.connectionId || '', item.databaseName || '', item.schema || '', item.label].join(':');
}

export function buildTreeItemKeyFromParts(
  type: string,
  connectionId?: string,
  databaseName?: string,
  schema?: string,
  name?: string,
): string {
  return [type, connectionId || '', databaseName || '', schema || '', name || ''].join(':');
}

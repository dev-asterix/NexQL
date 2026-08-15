/** Allowlisted per-cell metadata persisted in notebook files and sync payloads. */
export interface NexqlCellMetadata {
  name?: string;
  tags?: string[];
  skip?: boolean;
  fullDataset?: boolean;
  connectionOverride?: string;
  lastRun?: {
    ms: number;
    rows: number;
    at: number;
    sqlHash: string;
  };
}

const ALLOWED_KEYS: (keyof NexqlCellMetadata)[] = [
  'name',
  'tags',
  'skip',
  'fullDataset',
  'connectionOverride',
  'lastRun',
];

export function pickNexqlCellMetadata(metadata: Record<string, unknown> | undefined): NexqlCellMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  const picked: NexqlCellMetadata = {};
  let hasValue = false;
  for (const key of ALLOWED_KEYS) {
    if (metadata[key] !== undefined) {
      (picked as Record<string, unknown>)[key] = metadata[key];
      hasValue = true;
    }
  }
  return hasValue ? picked : undefined;
}

export function mergeNexqlCellMetadata(
  cellData: import('vscode').NotebookCellData,
  patch: NexqlCellMetadata,
): void {
  const existing = (cellData.metadata ?? {}) as Record<string, unknown>;
  cellData.metadata = { ...existing, ...patch };
}

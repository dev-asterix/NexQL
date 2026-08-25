import type { NoticeLogEntry, PostgresMetadata, QueryResults } from '../../common/types';

export const MIME_QUERY_RESULT = 'application/vnd.postgres-notebook.result';
export const MIME_QUERY_ERROR = 'application/vnd.postgres-notebook.error';
export const MIME_NOTICES_LIVE = 'application/vnd.postgres-notebook.notices-live';

export interface ExecuteQueryRequest {
  /** Notebook URI or studio document URI — session-scoped connection key. */
  sessionKey: string;
  /** Cell URI or studio execution key — cancel / cursor scope. */
  executionKey: string;
  sql: string;
  metadata: PostgresMetadata;
  /** Notebook metadata document for connection fallback correction. */
  metadataDocument?: { connectionId?: string };
  options?: {
    fullDataset?: boolean;
    explain?: boolean;
    sourceCellIndex?: number;
    cellRefMap?: Record<string, string>;
    source?: 'notebook' | 'queryStudio';
  };
}

export interface QueryExecutionErrorPayload {
  success: false;
  error: string;
  query: string;
  executionTime: number;
  slowQuery: boolean;
  canExplain: boolean;
  errorCode?: string;
  errorExplanation?: string;
  sourceCellIndex?: number;
  breadcrumb?: {
    connectionId: string;
    connectionName: string;
    database?: string;
  };
}

export type QueryExecutionOutput =
  | { kind: 'result'; mime: typeof MIME_QUERY_RESULT; data: QueryResults }
  | { kind: 'error'; mime: typeof MIME_QUERY_ERROR; data: QueryExecutionErrorPayload }
  | { kind: 'notices-live'; mime: typeof MIME_NOTICES_LIVE; data: { streaming: true; notices: NoticeLogEntry[] } }
  | { kind: 'summary'; mime: 'text/markdown'; data: string }
  | { kind: 'cancelled'; mime: 'text/markdown'; data: string };

export interface ExecuteQueryHooks {
  onExecutionState?(state: {
    isExecuting: boolean;
    backendPid: number | null;
    connectionId: string;
    databaseName: string;
    executionKey: string;
  }): void;
  onOutput?(output: QueryExecutionOutput, replace?: boolean): void | Promise<void>;
  onParameterPromptCancelled?(): void;
  postLargeResult?(resultId: string, rows: unknown[]): void;
}

export interface ExecuteQueryResult {
  success: boolean;
  cancelled?: boolean;
  outputs: QueryExecutionOutput[];
}

export interface InFlightExecution {
  backendPid: number | null;
  connectionId: string;
  databaseName: string;
  cancelled: boolean;
  client?: import('pg').Client;
}

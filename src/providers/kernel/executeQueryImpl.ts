/**
 * Shared SQL execution implementation for notebooks (via SqlExecutor) and Query Studio.
 */
import * as vscode from 'vscode';
import { ConnectionManager } from '../../services/ConnectionManager';
import { TelemetryService } from '../../services/TelemetryService';
import {
  NoticeLogEntry,
  PostgresMetadata,
  QueryResults,
  BYTEA_DISPLAY_DEFAULT,
  ByteaDisplayFormat,
} from '../../common/types';
import { getPgDataTypeName, deduplicateColumns } from '../../common/pgDataTypeNames';
import { SqlParser } from './SqlParser';
import { ErrorService, getErrorExplanation } from '../../services/ErrorService';
import { QueryHistoryService } from '../../services/QueryHistoryService';
import { getTransactionManager } from '../../services/TransactionManager';
import { SqlSafetyAnalyzer } from '../../services/sqlSafety';
import { extensionContext } from '../../extension';
import {
  clearNotebookParameterValues,
  getNotebookParameterValues,
  rememberNotebookParameterValue,
} from '../../services/NotebookParameterBank';
import { ResultCursorService } from '../../services/ResultCursorService';
import { FullDatasetPreferenceService } from '../../services/FullDatasetPreferenceService';
import { ConnectionUtils } from '../../utils/connectionUtils';
import { AuditLogService } from '../../features/audit/AuditLogService';
import { debugLog, debugWarn } from '../../common/logger';
import { QueryExecutionService } from '../../services/QueryExecutionService';
import type {
  ExecuteQueryHooks,
  ExecuteQueryRequest,
  ExecuteQueryResult,
  InFlightExecution,
  QueryExecutionOutput,
} from '../../services/execution/queryExecutionTypes';
import {
  MIME_NOTICES_LIVE,
  MIME_QUERY_ERROR,
  MIME_QUERY_RESULT,
} from '../../services/execution/queryExecutionTypes';

type FailureStrategy = 'continue-on-error' | 'fail-on-error' | 'prompt-on-error';

interface StatementResult {
  stmtIndex: number;
  query: string;
  success: boolean;
  rowCount?: number | null;
  error?: string;
  errorCode?: string;
  executionTime: number;
  command?: string;
}

interface NotebookParameterQuickPickItem extends vscode.QuickPickItem {
  value: string;
}

function getFailureStrategy(): FailureStrategy {
  return vscode.workspace
    .getConfiguration('postgresExplorer.query')
    .get<FailureStrategy>('executionFailureStrategy', 'continue-on-error');
}

function applyAutoLimit(query: string, connection: any, notebookMetadata?: any, profileContext?: any): string {
  let limit: number | null = null;
  if (profileContext?.autoLimitSelectResults !== undefined && profileContext.autoLimitSelectResults > 0) {
    limit = profileContext.autoLimitSelectResults;
  } else if (notebookMetadata?.autoLimitSelectResults !== undefined && notebookMetadata.autoLimitSelectResults > 0) {
    limit = notebookMetadata.autoLimitSelectResults;
  } else {
    const autoLimitEnabled = vscode.workspace.getConfiguration().get<boolean>('postgresExplorer.query.autoLimitEnabled', true);
    if (autoLimitEnabled || connection.readOnlyMode) {
      limit = vscode.workspace.getConfiguration().get<number>('postgresExplorer.performance.defaultLimit', 1000);
    }
  }
  if (!limit) return query;
  const trimmed = query.trim();
  const cleanQuery = query.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^\s*SELECT/i.test(cleanQuery)) return query;
  if (/\bLIMIT\s+\d+/i.test(query)) return query;
  const hasSemicolon = trimmed.endsWith(';');
  const baseQuery = hasSemicolon ? trimmed.slice(0, -1) : trimmed;
  return `${baseQuery} LIMIT ${limit}${hasSemicolon ? ';' : ''}`;
}

function consumeExecutionDirectives(query: string): { query: string; disableStreaming: boolean } {
  const hasFullDataset = /\bnexql:(?:full-dataset|no-stream)\b/i.test(query);
  const stripped = query
    .replace(/^\s*--\s*nexql:(?:full-dataset|no-stream)\s*$/gim, '')
    .replace(/\/\*\s*nexql:(?:full-dataset|no-stream)\s*\*\//gim, '')
    .trim();
  return { query: stripped, disableStreaming: hasFullDataset };
}

function isQueryCancelledError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '57014' || (err instanceof Error && /cancel/i.test(err.message));
}

function formatParamLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized || '(empty string)';
}

async function promptParam(sessionKey: string, parameterKey: string, title: string, prompt: string): Promise<string | null | undefined> {
  const paramsConfig = vscode.workspace.getConfiguration('postgresExplorer.parameters');
  const cacheLastValues = paramsConfig.get<boolean>('cacheLastValues', true);
  const nullSentinel = paramsConfig.get<string>('nullSentinel', 'NULL');
  const workspaceState = extensionContext?.workspaceState;
  const remembered = cacheLastValues && workspaceState ? getNotebookParameterValues(workspaceState, sessionKey, parameterKey) : [];

  if (remembered.length > 0) {
    const items: NotebookParameterQuickPickItem[] = remembered.map((value) => ({
      label: formatParamLabel(value),
      description: 'Previous value',
      value,
    }));
    items.push({ label: '$(edit) Enter new value...', value: '__new__' });
    if (nullSentinel) items.push({ label: `$(dash) Use ${nullSentinel}`, value: '__null__' });
    const sel = await vscode.window.showQuickPick<NotebookParameterQuickPickItem>(items, {
      title,
      placeHolder: prompt,
      ignoreFocusOut: true,
    });
    if (!sel) return undefined;
    if (sel.value === '__null__') return null;
    if (sel.value !== '__new__') {
      if (cacheLastValues && workspaceState) await rememberNotebookParameterValue(workspaceState, sessionKey, parameterKey, sel.value);
      return sel.value;
    }
  }

  const input = await vscode.window.showInputBox({ title, prompt, ignoreFocusOut: true });
  if (input === undefined) return undefined;
  const isNull = Boolean(nullSentinel && input.toLowerCase() === nullSentinel.toLowerCase());
  if (cacheLastValues && workspaceState && !isNull) await rememberNotebookParameterValue(workspaceState, sessionKey, parameterKey, input);
  return isNull ? null : input;
}

async function getTableInfo(client: any, result: any, query: string): Promise<any> {
  const fromMatch = query.match(/FROM\s+["']?([a-zA-Z0-9_.]+)["']?/i);
  if (!fromMatch) return undefined;
  const parts = fromMatch[1].split('.');
  const table = parts.length > 1 ? parts[1] : parts[0];
  const schema = parts.length > 1 ? parts[0] : 'public';
  try {
    const pkResult = await client.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = '${schema}.${table}'::regclass AND i.indisprimary`);
    return { schema, table, primaryKeys: pkResult.rows.map((r: any) => r.attname) };
  } catch {
    return undefined;
  }
}

function buildSummary(results: StatementResult[]): string {
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  let md = '## Execution Summary\n\n';
  if (succeeded.length) {
    md += `**${succeeded.length} statement(s) succeeded**\n\n`;
    for (const r of succeeded) md += `- Statement ${r.stmtIndex + 1}: ${r.command}${r.rowCount != null ? ` (${r.rowCount} rows)` : ''}\n`;
    md += '\n';
  }
  if (failed.length) {
    md += `**${failed.length} statement(s) failed**\n\n`;
    for (const r of failed) md += `- Statement ${r.stmtIndex + 1}: ${r.error}\n`;
  }
  return md;
}

function buildConsolidatedWarning(dangerousOps: Array<{ analysis: any }>, connection: any): string {
  const counts: Record<string, number> = {};
  for (const { analysis } of dangerousOps) {
    for (const op of analysis.operations) counts[op.type] = (counts[op.type] || 0) + 1;
  }
  const summary = Object.entries(counts).map(([t, c]) => `• ${c} ${t}${c === 1 ? '' : 's'}`).join('\n');
  const env = connection?.environment === 'production' ? 'PRODUCTION DATABASE\n\n' : '';
  return `${env}This query contains dangerous SQL commands:\n\n${summary}\n\nProceed?`;
}

export async function executeQueryImpl(
  request: ExecuteQueryRequest,
  hooks?: ExecuteQueryHooks,
): Promise<ExecuteQueryResult> {
  const outputs: QueryExecutionOutput[] = [];
  const sessionKey = request.sessionKey;
  const executionKey = request.executionKey;
  QueryExecutionService.getExecutingBySession().set(sessionKey, executionKey);

  let inFlightEntry: InFlightExecution | undefined;
  let noticeListener: ((msg: unknown) => void) | undefined;
  let client: import('pg').Client | undefined;

  try {
    let metadata = { ...request.metadata } as PostgresMetadata;
    const notebookKey = `activeProfile-${sessionKey}`;
    const activeProfileContext = extensionContext?.globalState.get<any>(notebookKey);
    const metadataDoc = request.metadataDocument ?? metadata;
    const connection = ConnectionUtils.findConnectionWithFallback(metadata.connectionId, metadataDoc);
    if (!connection) throw new Error('Connection not found');

    if (metadata.connectionId !== connection.id && metadata.connectionId) {
      metadata = { ...metadata, connectionId: connection.id };
    }

    let readOnlyMode = connection.readOnlyMode === true;
    if (metadata.readOnlyMode) readOnlyMode = true;
    if (activeProfileContext?.readOnlyMode) readOnlyMode = true;
    connection.readOnlyMode = readOnlyMode;

    client = await ConnectionManager.getInstance().getSessionClient(
      {
        id: connection.id,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        database: metadata.databaseName || connection.database,
        name: connection.name,
      },
      sessionKey,
    );

    const databaseName = metadata.databaseName || connection.database;
    inFlightEntry = { backendPid: null, connectionId: connection.id, databaseName, cancelled: false, client };
    QueryExecutionService.getInFlightMap().set(executionKey, inFlightEntry);

    let backendPid: number | null = null;
    try {
      const pidResult = await client.query('SELECT pg_backend_pid()');
      backendPid = pidResult.rows[0]?.pg_backend_pid ?? null;
      inFlightEntry.backendPid = backendPid;
    } catch (e) {
      debugWarn('Failed to get backend PID:', e);
    }

    hooks?.onExecutionState?.({ isExecuting: true, backendPid, connectionId: connection.id, databaseName, executionKey });

    const cellRefMap = request.options?.cellRefMap ?? {};
    const statements = SqlParser.splitSqlStatements(request.sql).map((s) => SqlParser.rewriteCellReferences(s, cellRefMap));
    const allowLiveNotices = statements.length === 1;
    const notices: NoticeLogEntry[] = [];
    let liveNoticesActive = false;

    const emitLive = () => {
      if (!allowLiveNotices || !notices.length) return;
      liveNoticesActive = true;
      const out: QueryExecutionOutput = { kind: 'notices-live', mime: MIME_NOTICES_LIVE, data: { streaming: true, notices: [...notices] } };
      outputs.push(out);
      void hooks?.onOutput?.(out, true);
    };

    noticeListener = (msg: any) => {
      notices.push({ message: msg.message || String(msg), receivedAt: new Date().toISOString() });
      emitLive();
    };
    client.on('notice', noticeListener);

    const analyzer = SqlSafetyAnalyzer.getInstance();
    let autoSafety = activeProfileContext?.autoApplySafetyCheck ?? metadata.autoApplySafetyCheck ?? true;
    const dangerous: Array<{ stmt: string; analysis: any }> = [];
    for (const stmt of statements) {
      if (connection.readOnlyMode && !analyzer.isReadOnlyQuery(stmt)) throw new Error('Write operations are not allowed in read-only mode');
      const analysis = analyzer.analyzeQuery(stmt, connection);
      if (analysis.requiresConfirmation && autoSafety) dangerous.push({ stmt, analysis });
    }

    if (dangerous.length) {
      const action = await vscode.window.showWarningMessage(buildConsolidatedWarning(dangerous, connection), { modal: true }, 'Execute', 'Execute in Transaction');
      if (!action) throw new Error('Query execution cancelled by user');
      if (action === 'Execute in Transaction') {
        const tx = getTransactionManager();
        if (!tx.getTransactionInfo(sessionKey)?.isActive) {
          await client.query('BEGIN');
          tx.initializeSession(sessionKey, true);
          notices.push({ message: 'Transaction started.', receivedAt: new Date().toISOString() });
          emitLive();
        }
      }
    }

    void AuditLogService.getInstance().record(
      { connectionName: connection.name || connection.id, host: connection.host, database: databaseName, environment: connection.environment || '' },
      statements,
    );

    const stmtResults: StatementResult[] = [];
    let overallSuccess = true;
    const failureStrategy = getFailureStrategy();

    for (let stmtIndex = 0; stmtIndex < statements.length; stmtIndex++) {
      if (inFlightEntry?.cancelled) throw new Error('Query execution cancelled');
      ResultCursorService.closeSessionsForCellUri(executionKey);
      liveNoticesActive = false;
      let query = statements[stmtIndex];
      const stmtStart = Date.now();
      const params = SqlParser.detectParameters(query);

      if (params.positional.length && params.named.length) {
        throw new Error('Mixing $N and :name parameters is not supported.');
      }

      const commentParams = SqlParser.parseCommentParameters(query);
      let pgValues: unknown[] | undefined;

      if (params.quoted.length) {
        const vals: Record<string, string> = {};
        for (const token of params.quoted) {
          if (vals[token.name]) continue;
          const v = await promptParam(sessionKey, `quoted:${token.kind}:${token.name}`, `Variable :'${token.name}'`, `Value`);
          if (v === undefined) return { success: false, cancelled: true, outputs };
          vals[token.name] = v ?? '';
        }
        query = SqlParser.substituteQuotedPsqlVariables(query, vals).text;
      }

      if (params.named.length) {
        const named = SqlParser.substituteNamedParametersWithPgPlaceholders(query);
        const vals: unknown[] = [];
        for (const name of named.paramNames) {
          if (commentParams.named?.has(name)) { vals.push(commentParams.named.get(name) ?? null); continue; }
          const v = await promptParam(sessionKey, `named:${name}`, `Parameter :${name}`, `Value for :${name}`);
          if (v === undefined) return { success: false, cancelled: true, outputs };
          vals.push(v);
        }
        query = named.text;
        pgValues = vals;
      } else if (params.positional.length) {
        const max = Math.max(...params.positional);
        const vals: unknown[] = [];
        for (let i = 1; i <= max; i++) {
          if (commentParams.positional?.has(i)) { vals.push(commentParams.positional.get(i) ?? null); continue; }
          const v = await promptParam(sessionKey, `positional:${i}`, `Parameter $${i}`, `Value for $${i}`);
          if (v === undefined) return { success: false, cancelled: true, outputs };
          vals.push(v);
        }
        pgValues = vals;
      }

      const directives = consumeExecutionDirectives(query);
      query = directives.query;
      if (!query.trim()) continue;

      const useFull = request.options?.fullDataset || directives.disableStreaming || FullDatasetPreferenceService.isEnabled(executionKey);
      const originalQuery = query;
      let queryForExec = query;
      let autoLimitApplied = false;
      let slidingPayload: QueryResults['slidingWindow'];
      let openedSession: Awaited<ReturnType<typeof ResultCursorService.tryOpenSession>> = null;

      if (!useFull && ResultCursorService.isGloballyEnabled() && !pgValues && ResultCursorService.isEligibleQuery(query)) {
        openedSession = await ResultCursorService.tryOpenSession({
          client,
          notebookUri: sessionKey,
          cellUri: executionKey,
          sql: query,
          inTransaction: !!getTransactionManager().getTransactionInfo(sessionKey)?.isActive,
          windowSize: ResultCursorService.getWindowSizeCap(),
        });
        if (openedSession) slidingPayload = openedSession.payload;
      }

      if (!openedSession && !useFull) {
        queryForExec = applyAutoLimit(query, connection, metadata, activeProfileContext);
        autoLimitApplied = queryForExec !== originalQuery;
      }

      try {
        const result = openedSession
          ? { rows: openedSession.rows, fields: openedSession.fields as any, rowCount: null, command: 'SELECT' }
          : pgValues !== undefined
            ? await client.query({ text: queryForExec, values: pgValues, rowMode: 'array' })
            : await client.query({ text: queryForExec, rowMode: 'array' });

        const executionTime = (Date.now() - stmtStart) / 1000;
        const durationMs = executionTime * 1000;
        const uniqueColumns = deduplicateColumns(result.fields?.map((f: any) => f.name) || []);
        const rows = (result.rows || []).map((row: any) => {
          if (!Array.isArray(row)) return row;
          const obj: Record<string, unknown> = {};
          uniqueColumns.forEach((c, i) => { obj[c] = row[i]; });
          return obj;
        });

        const columnTypes: Record<string, string> = {};
        result.fields?.forEach((f: any) => { columnTypes[f.name] = getPgDataTypeName(f.dataTypeID); });
        uniqueColumns.forEach((c) => { if (!columnTypes[c]) columnTypes[c] = 'text'; });

        const rawBytea = vscode.workspace.getConfiguration('postgresExplorer').get<string>('query.byteaDisplayFormat');
        const byteaDisplayFormat: ByteaDisplayFormat =
          rawBytea === 'hex0x' || rawBytea === 'postgresql' || rawBytea === 'json' ? rawBytea : BYTEA_DISPLAY_DEFAULT;

        const tableInfo = await getTableInfo(client, result, queryForExec);
        const outputData: QueryResults = {
          success: true,
          rowCount: result.rowCount,
          rows,
          columns: uniqueColumns,
          columnTypes,
          command: result.command,
          query: queryForExec,
          exportQuery: originalQuery,
          byteaDisplayFormat,
          notices: [...notices],
          executionTime,
          backendPid,
          tableInfo,
          slowQuery: durationMs >= vscode.workspace.getConfiguration().get<number>('postgresExplorer.performance.slowQueryThresholdMs', 2000),
          autoLimitApplied,
          ...(slidingPayload ? { slidingWindow: slidingPayload } : {}),
          breadcrumb: {
            connectionId: connection.id,
            connectionName: connection.name || connection.host,
            database: databaseName,
            schema: tableInfo?.schema,
            object: tableInfo?.table ? { name: tableInfo.table, type: 'table' } : undefined,
          },
          sourceCellIndex: request.options?.sourceCellIndex,
        };

        if (rows.length > 50000 && hooks?.postLargeResult) {
          const resultId = `result-${Date.now()}`;
          hooks.postLargeResult(resultId, rows);
          (outputData as any).resultId = resultId;
          outputData.rows = [];
        }

        notices.length = 0;
        const out: QueryExecutionOutput = { kind: 'result', mime: MIME_QUERY_RESULT, data: outputData };
        outputs.push(out);
        await hooks?.onOutput?.(out, allowLiveNotices && liveNoticesActive);

        QueryHistoryService.getInstance().add({
          query: queryForExec,
          success: true,
          duration: executionTime,
          durationMs,
          slow: outputData.slowQuery ?? false,
          rowCount: result.rowCount ?? rows.length,
          connectionName: connection.name,
          connectionId: connection.id,
          databaseName,
        });

        stmtResults.push({ stmtIndex, query: queryForExec, success: true, rowCount: result.rowCount, executionTime, command: result.command });
        TelemetryService.getInstance().trackEvent('query_executed', { success: true, durationBucket: 'ok', resultSizeBucket: 'ok' });
      } catch (err: any) {
        if (inFlightEntry?.cancelled || isQueryCancelledError(err)) break;
        overallSuccess = false;
        const executionTime = (Date.now() - stmtStart) / 1000;
        await getTransactionManager().handleCellError(client, sessionKey, err).catch(() => undefined);
        const errorOutput: QueryExecutionOutput = {
          kind: 'error',
          mime: MIME_QUERY_ERROR,
          data: {
            success: false,
            error: err.message,
            query,
            executionTime,
            slowQuery: false,
            canExplain: true,
            errorCode: err.code,
            errorExplanation: err.code ? getErrorExplanation(err.code) : undefined,
            breadcrumb: { connectionId: connection.id, connectionName: connection.name || connection.host, database: databaseName },
          },
        };
        outputs.push(errorOutput);
        await hooks?.onOutput?.(errorOutput, allowLiveNotices && liveNoticesActive);
        stmtResults.push({ stmtIndex, query, success: false, error: err.message, errorCode: err.code, executionTime });
        if (failureStrategy === 'fail-on-error') break;
      }
    }

    if (statements.length > 1 && stmtResults.some((r) => !r.success) && stmtResults.some((r) => r.success)) {
      const summary: QueryExecutionOutput = { kind: 'summary', mime: 'text/markdown', data: buildSummary(stmtResults) };
      outputs.push(summary);
      await hooks?.onOutput?.(summary, false);
    }

    if (inFlightEntry?.cancelled) {
      const c: QueryExecutionOutput = { kind: 'cancelled', mime: 'text/markdown', data: 'Query execution cancelled.' };
      outputs.push(c);
      await hooks?.onOutput?.(c, true);
      return { success: false, cancelled: true, outputs };
    }

    return { success: overallSuccess, outputs };
  } catch (err: any) {
    if (inFlightEntry?.cancelled || isQueryCancelledError(err) || /cancel/i.test(err?.message ?? '')) {
      const c: QueryExecutionOutput = { kind: 'cancelled', mime: 'text/markdown', data: 'Query execution cancelled.' };
      outputs.push(c);
      await hooks?.onOutput?.(c, true);
      return { success: false, cancelled: true, outputs };
    }
    const errorOutput: QueryExecutionOutput = {
      kind: 'error',
      mime: MIME_QUERY_ERROR,
      data: { success: false, error: err.message || String(err), query: request.sql, executionTime: 0, slowQuery: false, canExplain: false },
    };
    outputs.push(errorOutput);
    await hooks?.onOutput?.(errorOutput, true);
    return { success: false, outputs };
  } finally {
    if (inFlightEntry?.cancelled) ResultCursorService.dropSessionsForCellUri(executionKey);
    QueryExecutionService.getInFlightMap().delete(executionKey);
    QueryExecutionService.getExecutingBySession().delete(sessionKey);
    hooks?.onExecutionState?.({
      isExecuting: false,
      backendPid: inFlightEntry?.backendPid ?? null,
      connectionId: inFlightEntry?.connectionId ?? '',
      databaseName: inFlightEntry?.databaseName ?? '',
      executionKey,
    });
    if (client && noticeListener) client.removeListener('notice', noticeListener);
  }
}

export async function cancelInFlightQuery(executionKey: string): Promise<void> {
  const entry = QueryExecutionService.getInFlightMap().get(executionKey);
  if (!entry) return;
  entry.cancelled = true;
  ResultCursorService.dropSessionsForCellUri(executionKey);
  if (entry.backendPid && entry.client) {
    try {
      await entry.client.query('SELECT pg_cancel_backend($1)', [entry.backendPid]);
    } catch (e) {
      debugWarn('cancel backend failed', e);
    }
  }
}

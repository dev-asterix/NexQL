import * as vscode from 'vscode';
import type { Client } from 'pg';
import { randomUUID } from 'crypto';
import { getPgDataTypeName, deduplicateColumns } from '../common/pgDataTypeNames';
import { debugLog, debugWarn } from '../common/logger';

/** Idle cursor sessions are closed to free server resources */
const SESSION_IDLE_CLOSE_MS = 30 * 60 * 1000;

export interface SlidingWindowPayload {
  sessionId: string;
  windowStartRow: number;
  windowSize: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  totalRows?: number;
  countAttempted?: boolean;
  countError?: string;
}

interface SessionRecord {
  cursorQuoted: string;
  client: Client;
  windowSize: number;
  notebookUri: string;
  cellUri: string;
  totalRows?: number;
  countAttempted?: boolean;
  countError?: string;
  idleTimer?: NodeJS.Timeout;
  uniqueColumns?: string[];
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

function stripTrailingSemicolon(sql: string): string {
  const t = sql.trimEnd();
  return t.endsWith(';') ? t.slice(0, -1).trimEnd() : t;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Volatile/scalar functions that must never run under DECLARE CURSOR or COUNT wrappers. */
const SLIDING_WINDOW_BLOCKED = /\b(pg_sleep|pg_advisory_lock|pg_advisory_xact_lock|set_config)\s*\(/i;

export class ResultCursorService {
  private static sessions = new Map<string, SessionRecord>();

  public static isGloballyEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('postgresExplorer')
      .get<boolean>('performance.slidingWindowSelects', true);
  }

  public static getWindowSizeCap(): number {
    const raw = vscode.workspace
      .getConfiguration('postgresExplorer')
      .get<number>('performance.slidingWindowRowCap', 100);
    return Math.min(Math.max(Number(raw) || 100, 10), 500);
  }

  /** SELECT / WITH … SELECT suitable for cursor (no bound params in v1). */
  public static isEligibleQuery(sql: string): boolean {
    const clean = stripSqlComments(sql).trim();
    if (/^\s*EXPLAIN\b/i.test(clean)) {
      return false;
    }
    if (SLIDING_WINDOW_BLOCKED.test(clean)) {
      return false;
    }
    // Sliding window needs a rowset from a relation scan. Scalar/volatile SELECTs
    // (pg_sleep, set_config, etc.) have no FROM and must not use DECLARE CURSOR.
    if (!/\bFROM\b/i.test(clean)) {
      return false;
    }
    if (/^\s*SELECT\b/i.test(clean)) {
      return true;
    }
    if (/^\s*WITH\b/i.test(clean)) {
      const upper = clean.toUpperCase();
      const lastInsert = upper.lastIndexOf(' INSERT ');
      const lastSelect = upper.lastIndexOf(' SELECT ');
      if (lastInsert !== -1 && (lastSelect === -1 || lastInsert > lastSelect)) {
        return false;
      }
      return lastSelect !== -1;
    }
    return false;
  }

  private static isQueryCancelledError(err: unknown): boolean {
    const code = (err as { code?: string })?.code;
    return code === '57014';
  }

  /**
   * Closes sliding sessions previously opened for the same cell output (before re-run).
   */
  public static closeSessionsForCellUri(cellUri: string): void {
    const toClose: string[] = [];
    for (const [id, s] of ResultCursorService.sessions) {
      if (s.cellUri === cellUri) {
        toClose.push(id);
      }
    }
    for (const id of toClose) {
      void ResultCursorService.closeSession(id);
    }
  }

  /**
   * Drop in-memory cursor sessions without issuing CLOSE on the session client.
   * Use during cancel while the client is busy executing a query.
   */
  public static dropSessionsForCellUri(cellUri: string): void {
    for (const [id, s] of ResultCursorService.sessions) {
      if (s.cellUri !== cellUri) {
        continue;
      }
      if (s.idleTimer) {
        clearTimeout(s.idleTimer);
      }
      ResultCursorService.sessions.delete(id);
    }
  }

  public static async closeSession(sessionId: string): Promise<void> {
    const s = ResultCursorService.sessions.get(sessionId);
    if (!s) {
      return;
    }
    if (s.idleTimer) {
      clearTimeout(s.idleTimer);
    }
    ResultCursorService.sessions.delete(sessionId);
    try {
      await s.client.query(`CLOSE ${s.cursorQuoted}`);
    } catch (e) {
      debugWarn('[ResultCursorService] CLOSE cursor failed:', e);
    }
  }

  private static refreshIdleTimer(sessionId: string): void {
    const s = ResultCursorService.sessions.get(sessionId);
    if (!s) {
      return;
    }
    if (s.idleTimer) {
      clearTimeout(s.idleTimer);
    }
    s.idleTimer = setTimeout(() => {
      void ResultCursorService.closeSession(sessionId);
    }, SESSION_IDLE_CLOSE_MS);
    s.idleTimer.unref?.();
  }

  /**
   * Opens a SCROLL cursor and reads the first window. Returns null if cursor cannot be used (caller falls back to normal query).
   */
  public static async tryOpenSession(options: {
    client: Client;
    notebookUri: string;
    cellUri: string;
    sql: string;
    inTransaction: boolean;
    windowSize: number;
  }): Promise<{
    sessionId: string;
    payload: SlidingWindowPayload;
    rows: any[];
    fields: Array<{ name: string; dataTypeID: number }>;
  } | null> {
    const innerSql = stripTrailingSemicolon(options.sql.trim());
    if (!ResultCursorService.isEligibleQuery(innerSql)) {
      debugLog('[ResultCursorService] tryOpenSession skipped: query not eligible for sliding window');
      return null;
    }

    const cursorName = `nexql_sw_${randomUUID().replace(/-/g, '')}`;
    const cursorQuoted = quoteIdent(cursorName);
    const { client, inTransaction, windowSize } = options;
    const sessionId = randomUUID();
    let beganOwnReadOnlyTx = false;

    try {
      if (inTransaction) {
        await client.query(
          `DECLARE ${cursorQuoted} SCROLL CURSOR WITHOUT HOLD FOR ${innerSql}`
        );
      } else {
        await client.query('BEGIN READ ONLY ISOLATION LEVEL READ COMMITTED');
        beganOwnReadOnlyTx = true;
        await client.query(
          `DECLARE ${cursorQuoted} SCROLL CURSOR WITH HOLD FOR ${innerSql}`
        );
        await client.query('COMMIT');
        beganOwnReadOnlyTx = false;
      }

      // store session early so refreshIdleTimer can work if count/fetch takes long
      ResultCursorService.sessions.set(sessionId, {
        cursorQuoted,
        client,
        windowSize,
        notebookUri: options.notebookUri,
        cellUri: options.cellUri,
        totalRows: undefined,
        countAttempted: false,
        countError: undefined,
      });
      ResultCursorService.refreshIdleTimer(sessionId);

      const innerSqlClean = stripSqlComments(innerSql);
      const canEstimateRowCount = /\bFROM\b/i.test(innerSqlClean);

      // Attempt to estimate total rows for UI (best-effort; errors ignored).
      // A short statement_timeout prevents this nested COUNT from hanging a pool connection
      // on tables with millions of records or complex joins.
      const COUNT_TIMEOUT_MS = 1000;
      const countStartTime = Date.now();
      let sessionRecord = ResultCursorService.sessions.get(sessionId);
      let countSql: string | undefined;

      if (canEstimateRowCount) {
        if (sessionRecord) {
          sessionRecord.countAttempted = true;
        }
        try {
          debugLog(`[ResultCursorService] Starting row count (timeout ${COUNT_TIMEOUT_MS}ms) for session ${sessionId.substring(0, 8)}`);
          countSql = `SELECT COUNT(*) AS cnt FROM (${innerSqlClean}) AS nexql_count`;
          debugLog(`[ResultCursorService] COUNT query: ${countSql.substring(0, 120)}...`);

          // Apply a tight timeout only for the count query; reset it immediately after.
          await client.query(`SET statement_timeout = ${COUNT_TIMEOUT_MS}`);
          try {
            const cres = await client.query(countSql);
            const countDuration = Date.now() - countStartTime;

            const cntVal = cres?.rows?.[0]?.cnt ?? cres?.rows?.[0]?.count;
            const n = cntVal !== undefined && cntVal !== null ? Number(cntVal) : undefined;

            sessionRecord = ResultCursorService.sessions.get(sessionId);
            if (sessionRecord) {
              sessionRecord.totalRows = Number.isFinite(n) ? n : undefined;
              debugLog(`[ResultCursorService] Row count succeeded: ${sessionRecord.totalRows} rows (${countDuration}ms) for session ${sessionId.substring(0, 8)}`);
            }
          } finally {
            // Always reset the statement_timeout so subsequent queries are unaffected.
            await client.query('RESET statement_timeout').catch(() => {});
          }
        } catch (e) {
          const countDuration = Date.now() - countStartTime;
          const errorMsg = e instanceof Error ? e.message : String(e);
          sessionRecord = ResultCursorService.sessions.get(sessionId);
          if (sessionRecord) {
            sessionRecord.countError = errorMsg;
            const queryPreview = countSql ? countSql.substring(0, 150) : 'unknown';
            debugWarn(
              `[ResultCursorService] Row count failed after ${countDuration}ms for session ${sessionId.substring(0, 8)}:\n` +
              `  Error: ${errorMsg}\n` +
              `  Query: ${queryPreview}...`,
              e instanceof Error ? e.stack : ''
            );
          }
        }
      }

      let page: { rows: any[]; fields: Array<{ name: string; dataTypeID: number }> } | null;
      try {
        page = await ResultCursorService.fetchWindowInternal(sessionId, 1);
      } catch (e) {
        if (ResultCursorService.isQueryCancelledError(e)) {
          await ResultCursorService.closeSession(sessionId);
          throw e;
        }
        debugWarn('[ResultCursorService] first FETCH failed:', e);
        await ResultCursorService.closeSession(sessionId);
        return null;
      }
      if (!page) {
        await ResultCursorService.closeSession(sessionId);
        return null;
      }

      const hasMoreBefore = false;
      const hasMoreAfter = page.rows.length === windowSize;

      const srec = ResultCursorService.sessions.get(sessionId);
      const totalRows = srec?.totalRows;
      const countAttempted = srec?.countAttempted ?? false;
      const countError = srec?.countError;

      return {
        sessionId,
        rows: page.rows,
        fields: page.fields,
        payload: {
          sessionId,
          windowStartRow: 1,
          windowSize,
          hasMoreBefore,
          hasMoreAfter,
          totalRows,
          countAttempted,
          countError,
        },
      };
    } catch (e) {
      if (ResultCursorService.isQueryCancelledError(e)) {
        if (beganOwnReadOnlyTx) {
          await client.query('ROLLBACK').catch(() => {});
        }
        await ResultCursorService.closeSession(sessionId).catch(() => {});
        throw e;
      }
      debugWarn('[ResultCursorService] tryOpenSession failed, falling back to buffered query:', e);
      if (beganOwnReadOnlyTx) {
        await client.query('ROLLBACK').catch(() => {});
      }
      await ResultCursorService.closeSession(sessionId).catch(() => {});
      return null;
    }
  }

  private static async fetchWindowInternal(
    sessionId: string,
    pageStartRow: number
  ): Promise<{ rows: any[]; fields: Array<{ name: string; dataTypeID: number }> } | null> {
    const s = ResultCursorService.sessions.get(sessionId);
    if (!s) {
      return null;
    }

    // MOVE ABSOLUTE uses cursor row positioning. To fetch a page beginning at 1-based row N with
    // FETCH FORWARD k, move to N-1 first (or 0 for the first page).
    const moveTarget = Math.max(0, pageStartRow - 1);
    await s.client.query(`MOVE ABSOLUTE ${moveTarget} FROM ${s.cursorQuoted}`);
    const result = await s.client.query({
      text: `FETCH FORWARD ${s.windowSize} FROM ${s.cursorQuoted}`,
      rowMode: 'array',
    });

    const fields = (result.fields || []).map((f: { name: string; dataTypeID: number }) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
    }));

    if (!s.uniqueColumns) {
      s.uniqueColumns = deduplicateColumns(fields.map(f => f.name));
    }

    // Rewrite fields names to unique names so client matches them
    fields.forEach((f, idx) => {
      if (s.uniqueColumns && s.uniqueColumns[idx]) {
        f.name = s.uniqueColumns[idx];
      }
    });

    const rawRows = result.rows || [];
    const rows = rawRows.map((rowArray: any) => {
      if (Array.isArray(rowArray)) {
        const rowObj: Record<string, any> = {};
        s.uniqueColumns!.forEach((colName, index) => {
          rowObj[colName] = rowArray[index];
        });
        return rowObj;
      }
      return rowArray;
    });

    ResultCursorService.refreshIdleTimer(sessionId);

    return { rows, fields };
  }

  public static async fetchPage(
    sessionId: string,
    pageStartRow: number
  ): Promise<{
    rows: any[];
    fields: Array<{ name: string; dataTypeID: number }>;
    windowStartRow: number;
    windowSize: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    totalRows?: number;
    countAttempted?: boolean;
    countError?: string;
  } | null> {
    const s = ResultCursorService.sessions.get(sessionId);
    if (!s) {
      return null;
    }

    try {
      const internal = await ResultCursorService.fetchWindowInternal(sessionId, pageStartRow);
      if (!internal) {
        return null;
      }
      const hasMoreBefore = pageStartRow > 1;
      const hasMoreAfter = internal.rows.length === s.windowSize;

      return {
        ...internal,
        windowStartRow: pageStartRow,
        windowSize: s.windowSize,
        hasMoreBefore,
        hasMoreAfter,
        totalRows: s.totalRows,
        countAttempted: s.countAttempted,
        countError: s.countError,
      };
    } catch (e) {
      console.error('[ResultCursorService] fetchPage failed:', e);
      await ResultCursorService.closeSession(sessionId);
      throw e;
    }
  }

  public static columnTypesFromFields(
    fields: Array<{ name: string; dataTypeID: number }>,
    columns: string[]
  ): Record<string, string> {
    const columnTypes: Record<string, string> = {};
    columns.forEach((c, i) => {
      const f = fields[i];
      if (f) {
        columnTypes[c] = getPgDataTypeName(f.dataTypeID);
      } else {
        columnTypes[c] = 'text';
      }
    });
    return columnTypes;
  }
}

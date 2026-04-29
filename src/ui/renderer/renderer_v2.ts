import type { ActivationFunction } from 'vscode-notebook-renderer';
import { Chart, registerables } from 'chart.js';
import {
  createExportButton,
  positionExportDropdown,
  setExportToolbarButtonLabel,
  EXPORT_MENU_Z_INDEX,
} from '../../renderer/features/export';
import { TableRenderer, TableEvents } from '../../renderer/components/table/TableRenderer';
import { ChartRenderer } from '../../renderer/components/chart/ChartRenderer';
import { ChartControls } from '../../renderer/components/chart/ChartControls';
import { ExplainVisualizer } from '../../renderer/components/ExplainVisualizer';
import { createErrorPanel } from '../../renderer/components/ErrorPanel';
import {
  createAiMenuButton,
  type AiMenuOptions,
  type RowToolsOptions,
} from '../../renderer/components/ActionBar';
import {
  RESULT_TOOLBAR_ICON_CLASS,
  RESULT_TOOLBAR_LABEL_CLASS,
  applyResultRowToolStyle,
  applyResultViewTabStyle,
  attachResultRowToolInteractions,
  attachResultViewTabHover,
  fillToolbarButtonContent,
  fillOutputHoverToolButton,
  resultToolbarSvg,
  type ResultToolbarGlyph,
} from '../../renderer/components/ResultToolbarUi';
import { createResultIdentityBar } from '../../renderer/components/ResultIdentityBar';
import { createInlineBanner } from '../../renderer/components/InlineBanner';
import { openCommitConfirmDialog } from '../../renderer/components/CommitConfirmDialog';
import {
  createResultFooter,
  formatResultExecutionStats,
} from '../../renderer/components/ResultFooter';
import { showImportModal } from '../../renderer/features/import';
import { createTransactionBanner } from '../../renderer/components/TransactionBanner';
import { buildQueryPreview } from '../../renderer/utils/queryPreview';
import {
  addResultToHistory,
  getResultHistory,
  renderTabStrip,
} from '../../renderer/components/ResultTabStrip';
import { renderTransposeTable } from '../../renderer/components/TransposeView';
import {
  renderAnalystPanel,
  type PivotAiHelpContext,
} from '../../renderer/components/analyst/AnalystPanel';
import {
  BYTEA_DISPLAY_DEFAULT,
  type ByteaDisplayFormat,
  type NoticeLogEntry,
  type QueryResults,
  type FilterState,
  type SortState,
  type TableRenderOptions,
} from '../../common/types';
import {
  normalizeNoticesPayload,
  renderNoticesLiveStream,
  renderNoticesPanel,
} from '../../renderer/components/notices/NoticesPanel';
import { BRAND_ACCENT, BRAND_ACCENT_MUTED, SPINNER_FRAMES } from './rendererConstants';
import { prefersReducedMotion } from '../theme/motion';

// Register Chart.js components
Chart.register(...registerables);

// Track renderer instances and their containers per output element for cleanup
const chartInstances = new WeakMap<HTMLElement, ChartRenderer>();
const tableInstances = new WeakMap<HTMLElement, TableRenderer>();

/**
 * Puts a button into a loading state with an animated braille spinner.
 * When `prefers-reduced-motion` is set, uses a static label instead of animation.
 * Returns a cleanup function that restores the original label and re-enables the button.
 */
function startButtonLoading(btn: HTMLElement, loadingLabel: string): () => void {
  const originalText = btn.innerText;
  const originalDisabled = (btn as HTMLButtonElement).disabled;
  (btn as HTMLButtonElement).disabled = true;
  btn.style.opacity = '0.7';
  btn.style.cursor = 'not-allowed';

  const restore = () => {
    btn.innerText = originalText;
    (btn as HTMLButtonElement).disabled = originalDisabled;
    btn.style.opacity = '';
    btn.style.cursor = '';
  };

  if (prefersReducedMotion()) {
    btn.innerText = `… ${loadingLabel}`;
    return restore;
  }

  let frame = 0;
  btn.innerText = `${SPINNER_FRAMES[frame]} ${loadingLabel}`;
  const interval = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    btn.innerText = `${SPINNER_FRAMES[frame]} ${loadingLabel}`;
  }, 100);

  return () => {
    clearInterval(interval);
    restore();
  };
}

// Inject amber-gutter CSS once
function ensureAmberGutterStyle(): void {
  const STYLE_ID = 'amber-gutter-style';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .amber-gutter {
      border-left: 4px solid #ffb000 !important;
    }
  `;
  document.head.appendChild(style);
}

/** Remove all transaction banners and amber gutters from the document */
function clearTransactionUI(): void {
  document.querySelectorAll('[data-transaction-banner="true"]').forEach((el) => el.remove());
  document.querySelectorAll('.amber-gutter').forEach((el) => el.classList.remove('amber-gutter'));
}

const PIVOT_HELP_SQL_INLINE_MAX_CHARS = 12000;

/** Rows attached as CSV when using Send to Chat from results (full grids are rarely useful). */
const CHAT_SEND_SAMPLE_ROW_CAP = 10;

function buildChatResultsSampleJson(
  columns: string[],
  rows: unknown[],
  maxRows: number,
): string | undefined {
  if (maxRows <= 0 || rows.length === 0) {
    return undefined;
  }
  return JSON.stringify({
    columns,
    rows: rows.slice(0, maxRows),
  });
}

/** User message for SQL Assistant when pivot cardinality exceeds the client cap. */
function buildPivotOptimizeUserMessage(ctx: PivotAiHelpContext, sourceSql: string): string {
  const trimmed = sourceSql.trim();
  let sqlInline = trimmed;
  let truncationNote = '';
  if (trimmed.length > PIVOT_HELP_SQL_INLINE_MAX_CHARS) {
    sqlInline = trimmed.slice(0, PIVOT_HELP_SQL_INLINE_MAX_CHARS);
    truncationNote = `\n-- … truncated for chat prompt (${trimmed.length.toLocaleString()} chars total); full SQL is attached as a file.`;
  }

  const valueLine =
    ctx.aggregation === 'count' && !ctx.valueColumn
      ? 'Count rows (no separate value column)'
      : ctx.valueColumn ?? '—';

  return [
    'PgStudio Analyst tab: the in-browser pivot failed because there are too many distinct row or column labels.',
    '',
    'Help me rewrite my PostgreSQL query using server-side pre-aggregation (GROUP BY, rollups, bucketing, date_trunc, FILTER, CASE expressions, etc.) so pivot dimensions stay within a manageable cardinality.',
    '',
    `Pivot error: ${ctx.errorMessage}`,
    '',
    'Pivot configuration:',
    `- Row dimension: ${ctx.rowDimension}`,
    `- Column dimension: ${ctx.columnDimension}`,
    `- Value column / measure: ${valueLine}`,
    `- Aggregation: ${ctx.aggregation}`,
    '',
    'Context:',
    `- UI cap (distinct values per axis): ${ctx.maxDistinctPerAxis}`,
    `- Rows currently in this result grid: ${ctx.inMemoryRowCount.toLocaleString()}`,
    `- Streaming sliding window: ${ctx.isStreamingWindow ? 'yes (only a subset of server rows may be loaded)' : 'no'}`,
    '',
    'No result grid CSV is attached (usually redundant here; use the attached SQL file and pivot fields above).',
    '',
    'Source SQL (also attached as a .sql file):',
    '```sql',
    sqlInline + truncationNote,
    '```',
    '',
    'Please propose efficient PostgreSQL that returns an aggregation-friendly result set I can pivot in the notebook, plus any index notes if relevant.',
  ].join('\n');
}

export const activate: ActivationFunction = (context) => {
  return {
    renderOutputItem(data, element) {
      // Silently ignore the legacy TopBar header output (removed feature)
      if (data.mime === 'application/x-postgres-notebook-header+json') {
        element.innerHTML = '';
        return;
      }

      if (data.mime === 'application/vnd.postgres-notebook.notices-live') {
        const live = data.json() as { notices?: NoticeLogEntry[] };
        const entries = Array.isArray(live?.notices) ? live.notices : [];
        element.replaceChildren(renderNoticesLiveStream(entries));
        return;
      }

      const json = data.json();

      if (!json) {
        element.innerText = 'No data';
        return;
      }

      const {
        columns = [],
        rows,
        rowCount,
        command,
        query,
        notices,
        executionTime,
        tableInfo,
        columnTypes,
        backendPid,
        breadcrumb,
        autoLimitApplied,
        autoLimitValue,
      } = json;
      const exportQuery: string | undefined =
        typeof json.exportQuery === 'string' && json.exportQuery.trim().length > 0
          ? json.exportQuery
          : query;

      let slideMeta: QueryResults['slidingWindow'] = json.slidingWindow;

      const byteaDisplayFormat: ByteaDisplayFormat =
        json.byteaDisplayFormat === 'postgresql' ||
        json.byteaDisplayFormat === 'json' ||
        json.byteaDisplayFormat === 'hex0x'
          ? json.byteaDisplayFormat
          : BYTEA_DISPLAY_DEFAULT;

      const noticeItems = normalizeNoticesPayload(notices);

      const sourceCellIndex =
        typeof json.sourceCellIndex === 'number' && json.sourceCellIndex >= 0
          ? json.sourceCellIndex
          : -1;

      // Transaction state from payload
      const transactionState: { isActive: boolean; statementCount: number } | undefined =
        json.transactionState;
      const pendingCommit: boolean = !!json.pendingCommit;

      // Data Management
      let originalRows: any[] = rows ? JSON.parse(JSON.stringify(rows)) : [];
      let currentRows: any[] = rows ? JSON.parse(JSON.stringify(rows)) : [];
      let slideBufferedStartRow = slideMeta?.windowStartRow ?? 1;
      let slideHasMoreBefore = slideMeta?.hasMoreBefore ?? false;
      let slideHasMoreAfter = slideMeta?.hasMoreAfter ?? false;
      let localFilterState: FilterState = { globalQuery: '', clauses: [] };
      let localSortState: SortState = { column: null, direction: 'none' };
      const selectedIndices = new Set<number>();
      const modifiedCells = new Map<string, { originalValue: any; newValue: any }>();
      const rowsMarkedForDeletion = new Set<number>();

      // FK lookup pending callbacks — keyed by requestId
      const fkCallbacks = new Map<string, (rows: any[], cols: string[]) => void>();

      const buildTableRenderOptions = (): TableRenderOptions => ({
        columns,
        rows: currentRows,
        originalRows,
        columnTypes,
        tableInfo,
        foreignKeys: tableInfo?.foreignKeys,
        initialSelectedIndices: selectedIndices,
        modifiedCells,
        rowsMarkedForDeletion,
        byteaDisplayFormat,
        ...(slideMeta?.sessionId ? { rowNumberBaseline: slideBufferedStartRow } : {}),
      });

      const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;
      const escapeSqlLiteral = (value: string): string => value.replace(/'/g, "''");
      const hasActiveLocalFilter = (): boolean =>
        localFilterState.globalQuery.trim().length > 0 || localFilterState.clauses.length > 0;
      const hasActiveLocalSort = (): boolean =>
        !!localSortState.column && localSortState.direction !== 'none';
      const buildDerivedQueryFromLocalScope = (): string | undefined => {
        const base = (exportQuery || query || '').trim();
        if (!base) return undefined;
        const baseNoSemicolon = base.replace(/;\s*$/, '');
        const alias = 'pgstudio_src';
        const globalParts: string[] = [];
        const whereParts: string[] = [];

        const appendLikeCondition = (column: string, mode: 'contains' | 'startsWith' | 'endsWith', raw: string) => {
          const v = escapeSqlLiteral(raw);
          const pattern = mode === 'contains' ? `%${v}%` : mode === 'startsWith' ? `${v}%` : `%${v}`;
          whereParts.push(`CAST(${alias}.${quoteIdentifier(column)} AS text) ILIKE '${pattern}'`);
        };

        const globalQuery = localFilterState.globalQuery.trim();
        if (globalQuery) {
          const pat = `%${escapeSqlLiteral(globalQuery)}%`;
          for (const c of columns) {
            globalParts.push(`CAST(${alias}.${quoteIdentifier(c)} AS text) ILIKE '${pat}'`);
          }
          if (globalParts.length > 0) {
            whereParts.push(`(${globalParts.join(' OR ')})`);
          }
        }

        for (const clause of localFilterState.clauses) {
          if (!columns.includes(clause.column)) continue;
          const value = clause.value ?? '';
          if (clause.operator === 'equals') {
            whereParts.push(
              `CAST(${alias}.${quoteIdentifier(clause.column)} AS text) = '${escapeSqlLiteral(value)}'`,
            );
          } else if (clause.operator === 'contains') {
            appendLikeCondition(clause.column, 'contains', value);
          } else if (clause.operator === 'startsWith') {
            appendLikeCondition(clause.column, 'startsWith', value);
          } else if (clause.operator === 'endsWith') {
            appendLikeCondition(clause.column, 'endsWith', value);
          }
        }

        const hasWhere = whereParts.length > 0;
        const sortColumn =
          localSortState.column && columns.includes(localSortState.column)
            ? localSortState.column
            : null;
        const hasSort = !!sortColumn && localSortState.direction !== 'none';

        if (!hasWhere && !hasSort) {
          return undefined;
        }

        const whereSql = hasWhere ? `\nWHERE ${whereParts.join('\n  AND ')}` : '';
        const orderSql = hasSort
          ? `\nORDER BY ${alias}.${quoteIdentifier(sortColumn!)} ${localSortState.direction.toUpperCase()}`
          : '';

        return `SELECT *\nFROM (\n${baseNoSemicolon}\n) AS ${alias}${whereSql}${orderSql};`;
      };

      const buildFullDatasetRerunQuery = (): string | undefined => {
        const scoped = buildDerivedQueryFromLocalScope();
        if (scoped) {
          return scoped;
        }
        const base = (exportQuery || query || '').trim();
        if (!base) {
          return undefined;
        }
        return base.endsWith(';') ? base : `${base};`;
      };

      const createAnalyticsStreamingWarning = (
        modeLabel: 'Chart' | 'Analyst',
      ): HTMLElement | null => {
        if (!slideMeta?.sessionId) {
          return null;
        }
        const banner = createInlineBanner({
          severity: 'warning',
          message: `${modeLabel} in streaming mode uses loaded rows only. Run on full dataset for accurate results; this may have performance impact depending on local machine capacity.`,
          actionLabel: 'Run on full dataset',
          onAction: () => {
            const rerunQuery = buildFullDatasetRerunQuery();
            if (!rerunQuery) {
              context.postMessage?.({
                type: 'showErrorMessage',
                message: 'No query available to rerun for full dataset.',
              });
              return;
            }
            context.postMessage?.({
              type: 'runDerivedQuery',
              query: rerunQuery,
              source: `streaming-${modeLabel.toLowerCase()}-full-dataset`,
              fullDataset: true,
            });
          },
          dismissible: false,
        });
        banner.setAttribute('data-streaming-analytics-hint', modeLabel.toLowerCase());
        return banner;
      };

      const refreshStreamingScopeNotice = (): void => {
        mainContainer.querySelector('[data-streaming-scope-hint="true"]')?.remove();
        if (!slideMeta?.sessionId) return;
        const activeFilter = hasActiveLocalFilter();
        const activeSort = hasActiveLocalSort();
        if (!activeFilter && !activeSort) return;

        const scopeBits: string[] = [];
        if (activeFilter) scopeBits.push('filter');
        if (activeSort) scopeBits.push('sort');
        const msg = `Streaming mode: ${scopeBits.join(' + ')} is applied to loaded rows only.`;

        const hint = createInlineBanner({
          severity: 'warning',
          message: msg,
          actionLabel: 'Apply to full dataset',
          onAction: () => {
            const derived = buildDerivedQueryFromLocalScope();
            if (!derived) {
              context.postMessage?.({
                type: 'showErrorMessage',
                message: 'No active local filter/sort to apply.',
              });
              return;
            }
            context.postMessage?.({
              type: 'runDerivedQuery',
              query: derived,
              source: 'streaming-local-scope',
              fullDataset: true,
            });
          },
          dismissible: false,
        });
        hint.setAttribute('data-streaming-scope-hint', 'true');
        mainContainer.appendChild(hint);
      };

      // Result history for tab strip — persists across re-renders in same output element
      const historyEntry = {
        columns,
        rows: currentRows,
        columnTypes,
        tableInfo,
        command,
        rowCount,
        executionTime,
        query,
        notices: noticeItems.length ? [...noticeItems] : undefined,
        timestamp: Date.now(),
        byteaDisplayFormat,
      };
      const resultHistory = addResultToHistory(element, historyEntry);

      // Main Container
      const mainContainer = document.createElement('div');
      mainContainer.style.cssText = `
        font-family: var(--vscode-font-family), "Segoe UI", "Helvetica Neue", sans-serif;
        font-size: 13px;
        color: var(--vscode-editor-foreground);
        border: 1px solid var(--vscode-widget-border);
        border-top: 2px solid ${BRAND_ACCENT};
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.08);
      `;

      const contentContainer = document.createElement('div');
      contentContainer.style.cssText = 'display: flex; flex-direction: column; height: 100%;';

      let switchTab: (mode: string) => void = () => {};
      let showOverflowMenu: (anchorEl: HTMLElement) => void = () => {};

      let isExpanded = true;

      const updateIdentityStats = (): void => {
        const el = mainContainer.querySelector('[data-result-stats]') as HTMLElement | null;
        if (!el) return;
        let text: string;
        if (slideMeta) {
          const lastRow = slideMeta.windowStartRow + Math.max(currentRows.length, 1) - 1;
          text = `${slideMeta.windowStartRow.toLocaleString()}–${lastRow.toLocaleString()} · window ${slideMeta.windowSize.toLocaleString()} · streaming`;
          if (executionTime !== undefined) {
            const ms = Math.round(executionTime * 1000);
            text += ms >= 1000 ? ` · ${executionTime.toFixed(2)}s` : ` · ${ms}ms`;
          }
        } else {
          text = formatResultExecutionStats(currentRows.length, executionTime);
        }
        el.textContent = text;
        el.style.display = text.trim() ? 'inline-block' : 'none';
      };

      const identityBar = createResultIdentityBar({
        queryPreview: buildQueryPreview(query, (command || 'QUERY').toUpperCase()),
        queryFull: query,
        command,
        statsLine: json.error
          ? undefined
          : slideMeta
            ? (() => {
                const lastRow = slideMeta.windowStartRow + Math.max(rows?.length ?? 0, 1) - 1;
                let t = `${slideMeta.windowStartRow.toLocaleString()}–${lastRow.toLocaleString()} · window ${slideMeta.windowSize.toLocaleString()} · streaming`;
                if (executionTime !== undefined) {
                  const ms = Math.round(executionTime * 1000);
                  t += ms >= 1000 ? ` · ${executionTime.toFixed(2)}s` : ` · ${ms}ms`;
                }
                return t;
              })()
            : formatResultExecutionStats(currentRows.length, executionTime),
        isCollapsed: false,
        onToggleCollapse: () => {
          isExpanded = !isExpanded;
          contentContainer.style.display = isExpanded ? 'flex' : 'none';
          const ch = identityBar.querySelector('[data-chevron]');
          if (ch) {
            ch.textContent = isExpanded ? '▼' : '▶';
          }
        },
        onOverflow: (anchorEl) => showOverflowMenu(anchorEl),
        onExpand: () =>
          context.postMessage?.({
            type: 'notebookOutputToolbar',
            action: 'expand',
            cellIndex: sourceCellIndex,
          }),
      });
      mainContainer.appendChild(identityBar);

      if (autoLimitApplied) {
        const limitMsg =
          autoLimitValue !== undefined
            ? `Auto-LIMIT applied: showing ${rowCount?.toLocaleString() ?? '?'} rows (limit ${autoLimitValue})`
            : 'A row limit was appended to this SELECT.';
        mainContainer.appendChild(createInlineBanner({ severity: 'info', message: limitMsg }));
      }

      if (slideMeta && json.showSlidingCursorBanner === true && !json.error) {
        mainContainer.appendChild(
          createInlineBanner({
            severity: 'info',
            message:
              'Server-side cursor: only one window of rows is loaded at a time. Scroll the grid near the top or bottom edge to fetch the previous or next page.',
            onDismiss: () => context.postMessage?.({ type: 'cursorStreamBannerDismiss' }),
            onMuteForever: () => context.postMessage?.({ type: 'cursorStreamBannerMute' }),
          }),
        );
      }

      if (json.performanceAnalysis?.isDegraded || json.slowQuery) {
        const degraded = Boolean(json.performanceAnalysis?.isDegraded);
        const perfMsg = degraded
          ? json.performanceAnalysis!.analysis
          : 'Slow query detected. Consider reviewing indexes and filters.';
        mainContainer.appendChild(
          createInlineBanner({ severity: degraded ? 'warning' : 'info', message: perfMsg }),
        );
      }

      if (noticeItems.length > 0) {
        mainContainer.appendChild(
          createInlineBanner({
            severity: 'warning',
            message: `${noticeItems.length} notice${noticeItems.length !== 1 ? 's' : ''} from PostgreSQL`,
            actionLabel: 'View',
            onAction: () => switchTab('notices'),
          }),
        );
      }

      if (pendingCommit) {
        mainContainer.appendChild(
          createInlineBanner({
            severity: 'info',
            message:
              'This result was produced inside an open transaction — changes are not durable until COMMIT.',
            dismissible: false,
          }),
        );
      }

      mainContainer.appendChild(contentContainer);

      // Error Section
      if (json.error) {
        const errorPanel = createErrorPanel({
          errorCode: json.errorCode,
          errorMessage: json.error,
          explanation: json.errorExplanation,
          onExplainError: () => {
            context.postMessage?.({ type: 'explainError', error: json.error, query: json.query });
          },
          onFixWithAI: () => {
            context.postMessage?.({ type: 'fixQuery', error: json.error, query: json.query });
          },
          onRetry: () => {
            // Client-side retry: re-execute the cell by posting retryCell to the kernel
            context.postMessage?.({ type: 'retryCell', query: json.query });
          },
        });
        contentContainer.appendChild(errorPanel);
      }

      // Build the hidden export button to reuse its existing dropdown flow
      const exportBtn = createExportButton(columns, currentRows, tableInfo, context, query);
      exportBtn.style.display = 'none';

      const gridPrefRequestId = `gcp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      let skipGridCommitConfirm = false;
      if (!json.error) {
        context.postMessage?.({
          type: 'gridCommitPreference',
          action: 'get',
          requestId: gridPrefRequestId,
        });
      }

      /** Export dropdown for footer row tools + kernel export flows */
      const openResultExportMenu = (anchorBtn: HTMLElement): void => {
        const existing = document.querySelector('.export-dropdown');
        if (existing) {
          existing.remove();
          return;
        }

        const menu = document.createElement('div');
        menu.className = 'export-dropdown';
        menu.style.cssText =
          `position:fixed;background:var(--vscode-menu-background);border:1px solid var(--vscode-menu-border);box-shadow:0 2px 8px rgba(0,0,0,0.15);z-index:${EXPORT_MENU_Z_INDEX};min-width:160px;border-radius:3px;padding:4px 0;visibility:hidden;`;

        const addItem = (label: string, onClick: () => void) => {
          const item = document.createElement('div');
          item.textContent = label;
          item.style.cssText =
            'padding:6px 12px;cursor:pointer;color:var(--vscode-menu-foreground);font-size:12px;';
          item.onmouseenter = () => {
            item.style.background = 'var(--vscode-menu-selectionBackground)';
            item.style.color = 'var(--vscode-menu-selectionForeground)';
          };
          item.onmouseleave = () => {
            item.style.background = 'transparent';
            item.style.color = 'var(--vscode-menu-foreground)';
          };
          item.onclick = (e) => {
            e.stopPropagation();
            onClick();
            menu.remove();
          };
          menu.appendChild(item);
        };

        const postExport = (
          format: 'csv' | 'json' | 'markdown' | 'clipboard' | 'sqlinsert',
        ): void => {
          context.postMessage?.({
            type: 'export_request',
            format,
            query: exportQuery,
            columns,
            rows: currentRows, // fallback only if full query export fails
            tableInfo,
          });
        };

        addItem('Save as CSV', () => postExport('csv'));
        addItem('Save as JSON', () => postExport('json'));
        addItem('Save as Markdown', () => postExport('markdown'));
        addItem('Copy to Clipboard', () => {
          postExport('clipboard');
          setExportToolbarButtonLabel(anchorBtn as HTMLButtonElement, 'Working...');
          setTimeout(() => {
            setExportToolbarButtonLabel(anchorBtn as HTMLButtonElement, 'Export');
          }, 2000);
        });
        if (tableInfo) {
          addItem('Copy SQL INSERT', () => {
            postExport('sqlinsert');
            setExportToolbarButtonLabel(anchorBtn as HTMLButtonElement, 'Working...');
            setTimeout(() => {
              setExportToolbarButtonLabel(anchorBtn as HTMLButtonElement, 'Export');
            }, 2000);
          });
        }

        document.body.appendChild(menu);

        positionExportDropdown(menu, anchorBtn);
        menu.style.visibility = 'visible';
        setTimeout(() => {
          const close = () => {
            menu.remove();
            document.removeEventListener('click', close);
          };
          document.addEventListener('click', close);
        }, 0);
      };

      const aiMenuCallbacks: AiMenuOptions = {
        onSendToChat: () => {
          const resultsJson = buildChatResultsSampleJson(
            columns,
            currentRows,
            CHAT_SEND_SAMPLE_ROW_CAP,
          );
          context.postMessage?.({
            type: 'sendToChat',
            data: {
              query: json.query || '',
              ...(resultsJson ? { results: resultsJson } : {}),
              message:
                currentRows.length === 0
                  ? 'I ran this query. There were no rows; please help me interpret or fix it.'
                  : `I ran this query. The attachment includes at most ${CHAT_SEND_SAMPLE_ROW_CAP} sample rows from the result (not the full grid). Please help me understand the results.`,
            },
          });
        },
        onAnalyzeWithAI: () => {
          const escapeCSV = (val: any): string => {
            if (val === null || val === undefined) return '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };
          const csvHeader = columns.map((c: string) => `"${c.replace(/"/g, '""')}"`).join(',');
          const csvRows = currentRows.map((r: any) =>
            columns.map((c: string) => escapeCSV(r[c])).join(','),
          );
          const dataCsv = [csvHeader, ...csvRows].join('\n');
          context.postMessage?.({
            type: 'analyzeData',
            data: dataCsv,
            query: json.query || '',
            rowCount: currentRows.length,
          });
        },
        onOptimize: () => {
          context.postMessage?.({
            type: 'optimizeQuery',
            query: json.query,
            executionTime: json.executionTime,
          });
        },
      };

      // Save Changes Logic
      const parseCellKey = (key: string): { rowIndex: number; colName: string } | null => {
        const sep = key.indexOf('-');
        if (sep === -1) return null;
        const rowIndex = Number.parseInt(key.slice(0, sep), 10);
        if (Number.isNaN(rowIndex)) return null;
        return { rowIndex, colName: key.slice(sep + 1) };
      };

      const formatDiffValue = (value: any): string => {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'object') {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        }
        return String(value);
      };

      const buildEditDiffRows = (): Array<{
        rowIndex: number;
        rowLabel: string;
        colName: string;
        oldValue: string;
        newValue: string;
      }> => {
        const rowsForDiff: Array<{
          rowIndex: number;
          rowLabel: string;
          colName: string;
          oldValue: string;
          newValue: string;
        }> = [];

        modifiedCells.forEach((diff, key) => {
          const parsed = parseCellKey(key);
          if (!parsed) return;

          const { rowIndex, colName } = parsed;
          const pkLabel = tableInfo?.primaryKeys?.length
            ? tableInfo.primaryKeys
                .map((pk: string) => `${pk}=${formatDiffValue(originalRows[rowIndex]?.[pk])}`)
                .join(', ')
            : `row #${rowIndex + 1}`;

          rowsForDiff.push({
            rowIndex,
            rowLabel: pkLabel,
            colName,
            oldValue: formatDiffValue(diff.originalValue),
            newValue: formatDiffValue(diff.newValue),
          });
        });

        rowsForDiff.sort((a, b) => {
          if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
          return a.colName.localeCompare(b.colName);
        });
        return rowsForDiff;
      };

      const buildDeletionReviewRows = (): Array<{
        rowIndex: number;
        rowLabel: string;
      }> => {
        const sorted = Array.from(rowsMarkedForDeletion).sort((a, b) => a - b);
        return sorted.map((rowIndex) => {
          const pkLabel = tableInfo?.primaryKeys?.length
            ? tableInfo.primaryKeys
                .map((pk: string) => `${pk}=${formatDiffValue(originalRows[rowIndex]?.[pk])}`)
                .join(', ')
            : `row #${rowIndex + 1}`;
          return {
            rowIndex,
            rowLabel: pkLabel,
          };
        });
      };

      const renderReviewChangesView = (): HTMLElement => {
        const diffRows = buildEditDiffRows();
        const deletionRows = buildDeletionReviewRows();
        const pendingCount = modifiedCells.size + rowsMarkedForDeletion.size;

        const wrap = document.createElement('div');
        wrap.style.cssText = 'height:100%;overflow:auto;display:flex;flex-direction:column;';

        const header = document.createElement('div');
        header.style.cssText =
          'padding:10px 12px;border-bottom:1px solid var(--vscode-widget-border);display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:10px;';

        const headerText = document.createElement('div');
        headerText.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;';

        const titleEl = document.createElement('div');
        titleEl.textContent = 'Review Changes';
        titleEl.style.cssText = 'font-size:13px;font-weight:700;';

        const subtitleEl = document.createElement('div');
        const editedRowCount = new Set(diffRows.map((r) => r.rowIndex)).size;
        const subParts: string[] = [];
        if (diffRows.length > 0) {
          subParts.push(
            `${editedRowCount} row${editedRowCount !== 1 ? 's' : ''}, ${diffRows.length} edited cell${diffRows.length !== 1 ? 's' : ''}`,
          );
        }
        if (deletionRows.length > 0) {
          subParts.push(
            `${deletionRows.length} row${deletionRows.length !== 1 ? 's' : ''} marked for deletion`,
          );
        }
        subtitleEl.textContent = subParts.length > 0 ? subParts.join(' · ') : 'No pending changes';
        subtitleEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

        headerText.appendChild(titleEl);
        headerText.appendChild(subtitleEl);
        header.appendChild(headerText);

        if (pendingCount > 0) {
          const revertReviewBtn = document.createElement('button');
          revertReviewBtn.type = 'button';
          revertReviewBtn.textContent = 'Revert all';
          revertReviewBtn.title = 'Discard all unstaged edits and staged deletions';
          revertReviewBtn.style.cssText = `
            flex-shrink:0;padding:4px 12px;font-size:11px;font-family:var(--vscode-font-family);
            cursor:pointer;border-radius:3px;font-weight:600;
            background:color-mix(in srgb,#22c55e 14%,transparent);
            color:#22c55e;
            border:1px solid color-mix(in srgb,#22c55e 38%,transparent);
          `;
          revertReviewBtn.onmouseover = () => {
            revertReviewBtn.style.background = 'color-mix(in srgb,#22c55e 22%,transparent)';
          };
          revertReviewBtn.onmouseout = () => {
            revertReviewBtn.style.background = 'color-mix(in srgb,#22c55e 14%,transparent)';
          };
          revertReviewBtn.onclick = () => {
            tableRenderer.revertAllPendingChanges();
            syncPendingChangesUi();
            switchTab('table');
          };
          header.appendChild(revertReviewBtn);
        }

        wrap.appendChild(header);

        if (diffRows.length === 0 && deletionRows.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText =
            'padding:20px 16px;color:var(--vscode-descriptionForeground);font-size:12px;';
          empty.textContent = 'No pending edits or deletions to review.';
          wrap.appendChild(empty);
          return wrap;
        }

        const appendEditTable = () => {
          if (diffRows.length === 0) return;

          const sectionLabel = document.createElement('div');
          sectionLabel.textContent = 'Cell edits';
          sectionLabel.style.cssText =
            'padding:8px 12px 4px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.04em;';
          wrap.appendChild(sectionLabel);

          const table = document.createElement('table');
          table.style.cssText =
            'width:100%;border-collapse:separate;border-spacing:0;font-size:12px;line-height:1.45;';

          const thead = document.createElement('thead');
          const htr = document.createElement('tr');
          ['Row', 'Column', 'Old Value', 'New Value'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            th.style.cssText =
              'position:sticky;top:0;z-index:1;text-align:left;padding:8px 10px;background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-widget-border);font-weight:600;';
            htr.appendChild(th);
          });
          thead.appendChild(htr);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          diffRows.forEach((row, idx) => {
            const tr = document.createElement('tr');
            const stripe = idx % 2 === 0 ? 'transparent' : 'var(--vscode-keybindingTable-rowsBackground)';
            tr.style.background = stripe;

            const rowTd = document.createElement('td');
            rowTd.textContent = row.rowLabel;
            rowTd.style.cssText =
              'padding:7px 10px;border-bottom:1px solid var(--vscode-widget-border);font-family:var(--vscode-editor-font-family),monospace;white-space:nowrap;';

            const colTd = document.createElement('td');
            colTd.textContent = row.colName;
            colTd.style.cssText =
              'padding:7px 10px;border-bottom:1px solid var(--vscode-widget-border);font-family:var(--vscode-editor-font-family),monospace;';

            const oldTd = document.createElement('td');
            oldTd.textContent = row.oldValue;
            oldTd.style.cssText =
              'padding:7px 10px;border-bottom:1px solid var(--vscode-widget-border);font-family:var(--vscode-editor-font-family),monospace;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            oldTd.title = row.oldValue;

            const newTd = document.createElement('td');
            newTd.textContent = row.newValue;
            newTd.style.cssText =
              'padding:7px 10px;border-bottom:1px solid var(--vscode-widget-border);font-family:var(--vscode-editor-font-family),monospace;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:color-mix(in srgb, #f59e0b 12%, transparent);';
            newTd.title = row.newValue;

            tr.appendChild(rowTd);
            tr.appendChild(colTd);
            tr.appendChild(oldTd);
            tr.appendChild(newTd);
            tbody.appendChild(tr);
          });

          table.appendChild(tbody);
          wrap.appendChild(table);
        };

        const appendDeletionCards = () => {
          if (deletionRows.length === 0) return;

          const sectionLabel = document.createElement('div');
          sectionLabel.textContent = 'Rows to delete';
          sectionLabel.style.cssText =
            'padding:12px 12px 4px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.04em;';
          wrap.appendChild(sectionLabel);

          const divider = document.createElement('div');
          divider.style.cssText =
            'height:1px;margin:2px 12px 12px;background:color-mix(in srgb,var(--vscode-widget-border) 85%,transparent);';
          wrap.appendChild(divider);

          const cardsWrap = document.createElement('div');
          cardsWrap.style.cssText =
            'display:flex;flex-direction:column;gap:12px;padding:0 12px 16px;';

          deletionRows.forEach(({ rowIndex, rowLabel }) => {
            const rowData = originalRows[rowIndex] as Record<string, unknown> | undefined;

            const card = document.createElement('article');
            card.style.cssText = `
              border:1px solid color-mix(in srgb, var(--vscode-widget-border) 70%, transparent);
              border-radius:8px;
              overflow:hidden;
              background:color-mix(in srgb, #dc2626 7%, var(--vscode-editor-background));
              box-shadow:0 1px 2px rgba(0,0,0,0.06);
            `;

            const head = document.createElement('header');
            head.style.cssText = `
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:12px;
              padding:8px 12px;
              border-bottom:1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent);
              background:color-mix(in srgb, #dc2626 11%, transparent);
            `;

            const title = document.createElement('div');
            title.style.cssText =
              'font-size:12px;font-weight:700;font-family:var(--vscode-editor-font-family),monospace;color:var(--vscode-editor-foreground);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            title.textContent = `Row ${rowLabel}`;

            const undoBtn = document.createElement('button');
            undoBtn.type = 'button';
            undoBtn.textContent = 'Undo';
            undoBtn.title = 'Remove this row from the deletion queue';
            undoBtn.style.cssText = `
              flex-shrink:0;padding:3px 10px;font-size:11px;font-family:var(--vscode-font-family);
              cursor:pointer;border-radius:4px;font-weight:600;
              background:transparent;color:var(--vscode-textLink-foreground);
              border:1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 38%, transparent);
            `;
            undoBtn.onmouseover = () => {
              undoBtn.style.background =
                'color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 55%, transparent)';
            };
            undoBtn.onmouseout = () => {
              undoBtn.style.background = 'transparent';
            };
            undoBtn.onclick = () => {
              rowsMarkedForDeletion.delete(rowIndex);
              syncPendingChangesUi();
              tableRenderer.render(buildTableRenderOptions());
              switchTab('review');
            };

            head.appendChild(title);
            head.appendChild(undoBtn);

            const body = document.createElement('div');
            body.style.cssText =
              'padding:10px 12px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-start;';

            columns.forEach((colName: string) => {
              const chip = document.createElement('span');
              chip.style.cssText =
                'display:inline-flex;align-items:baseline;gap:4px;font-size:11px;font-family:var(--vscode-editor-font-family),monospace;line-height:1.4;max-width:100%;word-break:break-word;';
              const k = document.createElement('span');
              k.style.cssText = 'color:var(--vscode-descriptionForeground);font-weight:600;flex-shrink:0;';
              k.textContent = `${colName}=`;
              const v = document.createElement('span');
              v.style.color = 'var(--vscode-editor-foreground)';
              v.textContent = formatDiffValue(rowData?.[colName]);
              chip.appendChild(k);
              chip.appendChild(v);
              body.appendChild(chip);
            });

            const foot = document.createElement('footer');
            foot.style.cssText =
              'padding:7px 12px 10px;font-size:10px;color:var(--vscode-descriptionForeground);font-style:italic;border-top:1px dashed color-mix(in srgb, var(--vscode-widget-border) 55%, transparent);';
            foot.textContent = '→ Will be removed when you commit.';

            card.appendChild(head);
            card.appendChild(body);
            card.appendChild(foot);
            cardsWrap.appendChild(card);
          });

          wrap.appendChild(cardsWrap);
        };

        appendEditTable();
        appendDeletionCards();
        return wrap;
      };

      let reviewTabBtn: HTMLButtonElement | null = null;

      /** Active view — used so the footer hides Delete when not on the table tab */
      let currentMode: string = 'table';

      let syncReviewTabButton: () => void = () => {};

      let stopPendingSaveLoading: (() => void) | undefined;

      let refreshResultFooter: () => void = () => {};

      function syncPendingChangesUi(): void {
        syncReviewTabButton();
        refreshResultFooter();
      }

      function runPerformSaveCommit(): void {
        console.log('Renderer: Commit / save invoked');
        console.log('Renderer: Modified cells size:', modifiedCells.size);
        console.log('Renderer: Rows marked for deletion:', rowsMarkedForDeletion.size);

        const updates: any[] = [];
        modifiedCells.forEach((diff, key) => {
          const parsed = parseCellKey(key);
          if (!parsed) return;
          const { rowIndex, colName } = parsed;

          console.log(`Renderer: Processing diff for row ${rowIndex}, col ${colName}`);

          if (tableInfo?.primaryKeys) {
            const pkValues: Record<string, any> = {};
            tableInfo.primaryKeys.forEach((pk: string) => {
              pkValues[pk] = originalRows[rowIndex][pk];
            });
            updates.push({
              keys: pkValues,
              column: colName,
              value: diff.newValue,
              originalValue: diff.originalValue,
            });
          } else {
            console.warn('Renderer: No primary keys found in tableInfo', tableInfo);
          }
        });

        const deletions: any[] = [];
        rowsMarkedForDeletion.forEach((rowIndex) => {
          if (tableInfo?.primaryKeys) {
            const pkValues: Record<string, any> = {};
            tableInfo.primaryKeys.forEach((pk: string) => {
              pkValues[pk] = originalRows[rowIndex][pk];
            });
            deletions.push({
              keys: pkValues,
              row: originalRows[rowIndex],
            });
          }
        });

        console.log('Renderer: Updates prepared:', updates);
        console.log('Renderer: Deletions prepared:', deletions);

        if (updates.length > 0 || deletions.length > 0) {
          console.log('Renderer: Posting saveChanges message');
          stopPendingSaveLoading?.();
          stopPendingSaveLoading = undefined;
          const commitBtn = contentContainer.querySelector(
            '[data-pg-result-commit]',
          ) as HTMLButtonElement | null;
          stopPendingSaveLoading = commitBtn
            ? startButtonLoading(commitBtn, 'Saving...')
            : undefined;
          context.postMessage?.({
            type: 'saveChanges',
            updates,
            deletions,
            tableInfo,
          });
        } else {
          const reason = !tableInfo?.primaryKeys
            ? 'No primary keys found for this table.'
            : 'Unknown error preparing updates.';
          console.warn(`Renderer: Save failed. ${reason}`);
          context.postMessage?.({
            type: 'showErrorMessage',
            message: `Cannot save changes: ${reason} (Primary keys are required to identify rows)`,
          });
        }
      }

      function performSave(): void {
        const dirty = modifiedCells.size + rowsMarkedForDeletion.size;
        if (dirty <= 0) {
          return;
        }
        if (skipGridCommitConfirm) {
          runPerformSaveCommit();
          return;
        }
        openCommitConfirmDialog({
          confirmLabel: `Commit (${dirty})`,
          onConfirm: (dontAskAgain) => {
            if (dontAskAgain) {
              skipGridCommitConfirm = true;
              context.postMessage?.({
                type: 'gridCommitPreference',
                action: 'set',
                skipConfirm: true,
              });
            }
            runPerformSaveCommit();
          },
          onCancel: () => {},
        });
      }

      let applyCursorResponse: ((message: any) => void) | undefined;

      function markSelectedRowsForDeletion(): void {
        if (selectedIndices.size === 0) return;
        selectedIndices.forEach((index) => {
          rowsMarkedForDeletion.add(index);
        });
        selectedIndices.clear();
        syncPendingChangesUi();
        tableRenderer.render(buildTableRenderOptions());
        updateActionsVisibility();
      }

      // Listen for messages from extension host
      context.onDidReceiveMessage?.((message: any) => {
        if (
          message.type === 'gridCommitPreferenceResponse' &&
          message.requestId === gridPrefRequestId &&
          message.skipConfirm === true
        ) {
          skipGridCommitConfirm = true;
          return;
        }

        // FK lookup response — resolve the waiting dropdown callback
        if (message.type === 'fkLookupResponse') {
          const cb = fkCallbacks.get(message.requestId);
          if (cb) {
            cb(message.rows || [], message.columns || []);
            fkCallbacks.delete(message.requestId);
          }
          return;
        }

        if (message.type === 'resultCursorResponse') {
          applyCursorResponse?.(message);
          return;
        }

        // In-grid insert row result
        if (message.type === 'insertSuccess') {
          tableRenderer.replaceInsertRow(message.tempId, message.actualRow);
          return;
        }
        if (message.type === 'insertFailed') {
          tableRenderer.markInsertFailed(message.tempId, message.error || 'Insert failed');
          return;
        }

        if (message.type === 'saveSuccess') {
          console.log(
            'Renderer: Received saveSuccess, clearing modified cells and removing deleted rows',
          );

          stopPendingSaveLoading?.();
          stopPendingSaveLoading = undefined;

          // Update originalRows with edited values before removing any rows.
          // The renderer now tracks edits by stable source index, so applying
          // edits first keeps those indices aligned for the remaining rows.
          modifiedCells.forEach((diff, key) => {
            const parsed = parseCellKey(key);
            if (!parsed) return;
            const { rowIndex, colName } = parsed;
            if (rowIndex >= 0 && rowIndex < originalRows.length) {
              originalRows[rowIndex][colName] = diff.newValue;
            }
          });

          // Remove deleted rows from arrays (in reverse order to maintain indices)
          const deletedIndices = Array.from(rowsMarkedForDeletion).sort((a, b) => b - a);
          deletedIndices.forEach((index) => {
            currentRows.splice(index, 1);
            originalRows.splice(index, 1);
          });

          // Clear all pending changes
          modifiedCells.clear();
          rowsMarkedForDeletion.clear();

          syncPendingChangesUi();

          // Re-render table to remove highlights and deleted rows
          if (tableRenderer) {
            tableRenderer.render(buildTableRenderOptions());
          }
        }

        if (message.type === 'saveFailed') {
          stopPendingSaveLoading?.();
          stopPendingSaveLoading = undefined;
        }
      });

      /** Last Table / Chart / Analyst view when browsing notices etc. */
      let lastPrimaryMode: 'table' | 'chart' | 'analyst' = 'table';

      // Secondary band: left = Table / Chart / … + optional View Plan; right = Export chart + AI (after chart init)
      const secondaryTabsOuter = document.createElement('div');
      secondaryTabsOuter.style.cssText =
        'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:6px 12px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);';

      const secondaryTabsLeft = document.createElement('div');
      secondaryTabsLeft.style.cssText =
        'display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1;min-width:0;';

      const secondaryTabsRight = document.createElement('div');
      secondaryTabsRight.style.cssText =
        'display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto;';

      const isExplainQuery =
        json.explainPlan ||
        (query && /^\s*EXPLAIN/i.test(query)) ||
        command === 'EXPLAIN' ||
        (columns.length === 1 && columns[0] === 'QUERY PLAN');

      if (isExplainQuery) {
        const explainPlanBtn = document.createElement('button');
        explainPlanBtn.type = 'button';
        fillToolbarButtonContent(explainPlanBtn, 'explain', 'View Plan');
        applyResultRowToolStyle(explainPlanBtn);
        attachResultRowToolInteractions(explainPlanBtn);
        explainPlanBtn.title = json.explainPlan
          ? 'Open EXPLAIN ANALYZE plan view'
          : 'Convert to JSON format and open visual plan view';

        explainPlanBtn.onclick = () => {
          if (json.explainPlan) {
            switchTab('explain');
          } else {
            console.log('Converting EXPLAIN to JSON, query:', query);
            if (!query) {
              alert('Cannot convert EXPLAIN plan: query not available');
              return;
            }
            context.postMessage?.({
              type: 'convertExplainToJson',
              query: query,
            });
          }
        };
        secondaryTabsLeft.appendChild(explainPlanBtn);
      }

      const tableViewBtn = document.createElement('button');
      tableViewBtn.type = 'button';
      fillToolbarButtonContent(tableViewBtn, 'table', 'Table');
      tableViewBtn.onclick = () => switchTab('table');
      attachResultViewTabHover(tableViewBtn);

      const chartViewBtn = document.createElement('button');
      chartViewBtn.type = 'button';
      fillToolbarButtonContent(chartViewBtn, 'chart', 'Chart');
      chartViewBtn.onclick = () => switchTab('chart');
      attachResultViewTabHover(chartViewBtn);

      const analystViewBtn = document.createElement('button');
      analystViewBtn.type = 'button';
      fillToolbarButtonContent(analystViewBtn, 'analyst', 'Analyst');
      analystViewBtn.onclick = () => switchTab('analyst');
      attachResultViewTabHover(analystViewBtn);

      const syncPrimaryButtons = () => {
        applyResultViewTabStyle(tableViewBtn, lastPrimaryMode === 'table');
        applyResultViewTabStyle(chartViewBtn, lastPrimaryMode === 'chart');
        applyResultViewTabStyle(analystViewBtn, lastPrimaryMode === 'analyst');
      };
      syncPrimaryButtons();

      const noticesBtn = document.createElement('button');
      noticesBtn.type = 'button';
      const noticesLabel =
        noticeItems.length > 0 ? `Notices (${noticeItems.length})` : 'Notices';
      fillToolbarButtonContent(noticesBtn, 'notices', noticesLabel);
      noticesBtn.onclick = () => switchTab('notices');
      applyResultViewTabStyle(noticesBtn, false);
      attachResultViewTabHover(noticesBtn);

      const transposeBtn = document.createElement('button');
      transposeBtn.type = 'button';
      fillToolbarButtonContent(transposeBtn, 'transpose', 'Transpose');
      transposeBtn.onclick = () => switchTab('transpose');
      applyResultViewTabStyle(transposeBtn, false);
      attachResultViewTabHover(transposeBtn);

      reviewTabBtn = document.createElement('button');
      reviewTabBtn.type = 'button';
      reviewTabBtn.onclick = () => switchTab('review');

      let explainTabBtn: HTMLButtonElement | null = null;
      if (json.explainPlan) {
        explainTabBtn = document.createElement('button');
        explainTabBtn.type = 'button';
        fillToolbarButtonContent(explainTabBtn, 'explain', 'Explain Plan');
        explainTabBtn.onclick = () => switchTab('explain');
        applyResultViewTabStyle(explainTabBtn, false);
        attachResultViewTabHover(explainTabBtn);
      }

      const REVIEW_AMBER = '#f59e0b';
      syncReviewTabButton = () => {
        if (!reviewTabBtn) return;
        const pending = modifiedCells.size + rowsMarkedForDeletion.size;
        const isActive = currentMode === 'review';

        reviewTabBtn.replaceChildren();
        const ic = document.createElement('span');
        ic.className = RESULT_TOOLBAR_ICON_CLASS;
        ic.innerHTML = resultToolbarSvg('review');
        const title = document.createElement('span');
        title.className = RESULT_TOOLBAR_LABEL_CLASS;
        title.textContent = 'Review Changes';
        reviewTabBtn.appendChild(ic);
        reviewTabBtn.appendChild(title);

        if (pending > 0) {
          const badge = document.createElement('span');
          badge.textContent = String(pending);
          badge.title = `${pending} pending change(s)`;
          badge.style.cssText = `
            display:inline-block;
            margin-left:6px;
            min-width:18px;
            text-align:center;
            padding:0 6px;
            border-radius:999px;
            font-size:10px;
            font-weight:700;
            line-height:16px;
            vertical-align:middle;
            background:color-mix(in srgb, ${REVIEW_AMBER} 26%, transparent);
            color:${REVIEW_AMBER};
            border:1px solid color-mix(in srgb, ${REVIEW_AMBER} 48%, transparent);
          `;
          reviewTabBtn.appendChild(badge);
        }

        applyResultViewTabStyle(reviewTabBtn, isActive);
        if (pending > 0) {
          reviewTabBtn.style.background = isActive
            ? `color-mix(in srgb, ${REVIEW_AMBER} 18%, color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 88%, transparent))`
            : `color-mix(in srgb, ${REVIEW_AMBER} 14%, transparent)`;
          reviewTabBtn.style.borderColor = `color-mix(in srgb, ${REVIEW_AMBER} 42%, var(--vscode-widget-border))`;
        }
        if (!isActive) {
          reviewTabBtn.style.color = 'var(--vscode-editor-foreground)';
        }
      };

      reviewTabBtn.addEventListener('mouseenter', () => {
        if (!reviewTabBtn || currentMode === 'review') return;
        const pending = modifiedCells.size + rowsMarkedForDeletion.size;
        reviewTabBtn.style.background = pending > 0
          ? `color-mix(in srgb, ${REVIEW_AMBER} 16%, color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 48%, transparent))`
          : 'color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 55%, transparent)';
      });
      reviewTabBtn.addEventListener('mouseleave', () => syncReviewTabButton());

      secondaryTabsLeft.appendChild(tableViewBtn);
      secondaryTabsLeft.appendChild(chartViewBtn);
      secondaryTabsLeft.appendChild(analystViewBtn);
      secondaryTabsLeft.appendChild(noticesBtn);
      secondaryTabsLeft.appendChild(transposeBtn);
      secondaryTabsLeft.appendChild(reviewTabBtn);
      if (explainTabBtn) secondaryTabsLeft.appendChild(explainTabBtn);

      secondaryTabsOuter.appendChild(secondaryTabsLeft);
      secondaryTabsOuter.appendChild(secondaryTabsRight);

      if (!json.error) {
        contentContainer.appendChild(secondaryTabsOuter);
      }

      syncReviewTabButton();

      // Views Containers
      const viewContainer = document.createElement('div');
      viewContainer.style.cssText =
        'flex: 1; overflow: hidden; display: flex; flex-direction: column; position: relative; max-height: 500px;';
      if (!json.error) {
        contentContainer.appendChild(viewContainer);
      }

      // TABLE RENDERER
      const tableRenderer = new TableRenderer(viewContainer, {
        onSelectionChange: (indices) => {
          selectedIndices.clear();
          indices.forEach((i) => selectedIndices.add(i));
          updateActionsVisibility();
        },
        onDataChange: (_rowIndex, _col, _newVal, _originalVal) => {
          syncPendingChangesUi();
          updateActionsVisibility();
          if (currentMode === 'review') {
            switchTab('review');
          }
        },
        onInsertRow: (values, tempId) => {
          context.postMessage?.({ type: 'insertRow', tableInfo, values, tempId });
        },
        onFkLookup: (requestId, fkSchema, fkTable, fkColumn, searchText, callback) => {
          fkCallbacks.set(requestId, callback);
          context.postMessage?.({
            type: 'fkLookup',
            requestId,
            fkSchema,
            fkTable,
            fkColumn,
            searchText,
            limit: 50,
          });
        },
        onSortChange: (column, direction) => {
          localSortState = { column, direction };
          refreshStreamingScopeNotice();
        },
        onFilterChange: (state) => {
          localFilterState = {
            globalQuery: state.globalQuery || '',
            clauses: state.clauses.map((c) => ({ ...c })),
          };
          refreshStreamingScopeNotice();
        },
      });

      // Store for cleanup on disposal
      tableInstances.set(element, tableRenderer);

      let slideFetchBusy = false;
      let pendingSlideRequestId = '';
      let pendingSlideTargetStart: number | undefined;
      let suppressSlideScrollUntil = 0;
      let slideScrollCleanup: (() => void) | undefined;
      const DEFAULT_ROW_HEIGHT_PX = 30;
      const getSlideWindowSize = (): number =>
        Math.max(10, slideMeta?.windowSize ?? 100);
      const getMaxBufferedRows = (): number => getSlideWindowSize() * 3;
      const estimateDataRowHeight = (): number => {
        const row = tableRenderer
          .getScrollContainer()
          .querySelector('tr[data-source-index]') as HTMLElement | null;
        if (!row) {
          return DEFAULT_ROW_HEIGHT_PX;
        }
        return Math.max(16, row.offsetHeight || DEFAULT_ROW_HEIGHT_PX);
      };
      const syncSlideMetaFromBuffer = (): void => {
        if (!slideMeta?.sessionId) {
          return;
        }
        slideMeta = {
          sessionId: slideMeta.sessionId,
          windowStartRow: slideBufferedStartRow,
          windowSize: getSlideWindowSize(),
          hasMoreBefore: slideHasMoreBefore,
          hasMoreAfter: slideHasMoreAfter,
        };
      };

      const attachSlideScroll = (): void => {
        slideScrollCleanup?.();
        slideScrollCleanup = undefined;
        if (!slideMeta?.sessionId) {
          return;
        }
        const root = tableRenderer.getScrollContainer();
        let ticking = false;
        const EDGE_PX = 72;
        const onScroll = (): void => {
          if (!slideMeta?.sessionId || slideFetchBusy) {
            return;
          }
          if (Date.now() < suppressSlideScrollUntil) {
            return;
          }
          if (ticking) {
            return;
          }
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            if (!slideMeta?.sessionId || slideFetchBusy) {
              return;
            }
            const distBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
            const distTop = root.scrollTop;
            let nextStart: number | undefined;
            if (slideHasMoreAfter && distBottom < EDGE_PX) {
              nextStart = slideBufferedStartRow + currentRows.length;
            } else if (slideHasMoreBefore && distTop < EDGE_PX) {
              nextStart = Math.max(1, slideBufferedStartRow - getSlideWindowSize());
            }
            if (nextStart === undefined || nextStart === slideBufferedStartRow) {
              return;
            }
            slideFetchBusy = true;
            pendingSlideTargetStart = nextStart;
            pendingSlideRequestId = `slide-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
            context.postMessage?.({
              type: 'resultCursorFetch',
              sessionId: slideMeta.sessionId,
              pageStartRow: nextStart,
              requestId: pendingSlideRequestId,
            });
          });
        };
        root.addEventListener('scroll', onScroll, { passive: true });
        slideScrollCleanup = (): void => {
          root.removeEventListener('scroll', onScroll);
        };
      };

      applyCursorResponse = (message: any): void => {
        if (pendingSlideRequestId && message.requestId !== pendingSlideRequestId) {
          return;
        }
        const previousWindowStart = slideBufferedStartRow;
        const requestedStart = pendingSlideTargetStart;
        const rootBefore = tableRenderer.getScrollContainer();
        const prevScrollTop = rootBefore.scrollTop;
        const rowHeight = estimateDataRowHeight();
        let scrollAdjustPx = 0;
        slideFetchBusy = false;
        pendingSlideRequestId = '';
        pendingSlideTargetStart = undefined;
        if (message.error) {
          slideScrollCleanup?.();
          slideScrollCleanup = undefined;
          slideMeta = undefined;
          mainContainer.insertBefore(
            createInlineBanner({ severity: 'warning', message: String(message.error) }),
            contentContainer,
          );
          refreshStreamingScopeNotice();
          return;
        }
        const incomingRows = message.rows ? JSON.parse(JSON.stringify(message.rows)) : [];
        const incomingOriginalRows = JSON.parse(JSON.stringify(incomingRows));
        const movedForward =
          typeof requestedStart === 'number' && requestedStart > previousWindowStart;
        const movedBackward =
          typeof requestedStart === 'number' && requestedStart < previousWindowStart;

        if (!slideMeta?.sessionId || !requestedStart) {
          currentRows = incomingRows;
          originalRows = incomingOriginalRows;
          slideBufferedStartRow = message.slidingWindow?.windowStartRow ?? slideBufferedStartRow;
        } else if (movedForward) {
          currentRows = [...currentRows, ...incomingRows];
          originalRows = [...originalRows, ...incomingOriginalRows];
        } else if (movedBackward) {
          currentRows = [...incomingRows, ...currentRows];
          originalRows = [...incomingOriginalRows, ...originalRows];
          slideBufferedStartRow = requestedStart;
          scrollAdjustPx += incomingRows.length * rowHeight;
        } else {
          currentRows = incomingRows;
          originalRows = incomingOriginalRows;
          slideBufferedStartRow = requestedStart;
        }

        const maxBufferedRows = getMaxBufferedRows();
        if (currentRows.length > maxBufferedRows) {
          const overflow = currentRows.length - maxBufferedRows;
          if (movedForward) {
            currentRows = currentRows.slice(overflow);
            originalRows = originalRows.slice(overflow);
            slideBufferedStartRow += overflow;
            scrollAdjustPx -= overflow * rowHeight;
          } else if (movedBackward) {
            currentRows = currentRows.slice(0, currentRows.length - overflow);
            originalRows = originalRows.slice(0, originalRows.length - overflow);
          } else {
            currentRows = currentRows.slice(0, maxBufferedRows);
            originalRows = originalRows.slice(0, maxBufferedRows);
          }
        }

        if (message.slidingWindow) {
          if (movedForward) {
            slideHasMoreAfter = message.slidingWindow.hasMoreAfter;
          } else if (movedBackward) {
            slideHasMoreBefore = message.slidingWindow.hasMoreBefore;
          } else {
            slideHasMoreBefore = message.slidingWindow.hasMoreBefore;
            slideHasMoreAfter = message.slidingWindow.hasMoreAfter;
          }
          if (slideBufferedStartRow > 1) {
            slideHasMoreBefore = true;
          }
          syncSlideMetaFromBuffer();
        }
        refreshStreamingScopeNotice();
        selectedIndices.clear();
        modifiedCells.clear();
        rowsMarkedForDeletion.clear();
        if (currentMode === 'table') {
          tableRenderer.render(buildTableRenderOptions());
        }
        updateIdentityStats();
        refreshResultFooter();
        suppressSlideScrollUntil = Date.now() + 120;
        requestAnimationFrame(() => {
          const root = tableRenderer.getScrollContainer();
          const nextScrollTop = Math.max(0, prevScrollTop + scrollAdjustPx);
          root.scrollTop = nextScrollTop;
        });
      };

      const rowToolHandlers: RowToolsOptions = {
        onSelectAll: () => {
          if (selectedIndices.size === currentRows.length && currentRows.length > 0) {
            selectedIndices.clear();
          } else {
            currentRows.forEach((_: any, i: number) => selectedIndices.add(i));
          }
          tableRenderer.updateSelection(selectedIndices);
          refreshResultFooter();
        },
        onCopy: () => {
          const rowsToCopy =
            selectedIndices.size > 0
              ? Array.from(selectedIndices).map((i) => currentRows[i])
              : currentRows;
          const escapeCSV = (val: any): string => {
            if (val === null || val === undefined) return '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };
          const csv = [
            columns.map((c: string) => `"${c.replace(/"/g, '""')}"`).join(','),
            ...rowsToCopy.map((r: any) => columns.map((c: string) => escapeCSV(r[c])).join(',')),
          ].join('\n');
          navigator.clipboard?.writeText(csv);
        },
        onImport: () => {
          showImportModal(columns, tableInfo, context);
        },
        onExport: openResultExportMenu,
      };

      refreshResultFooter = () => {
        if (json.error) return;
        contentContainer.querySelector('[data-result-footer="true"]')?.remove();
        const dirty = modifiedCells.size + rowsMarkedForDeletion.size;
        const tableView = currentMode === 'table';
        const sel = tableView ? selectedIndices.size : 0;
        contentContainer.appendChild(
          createResultFooter({
            rowTools:
              columns.length > 0
                ? {
                    ...rowToolHandlers,
                    allRowsSelected:
                      tableView &&
                      currentRows.length > 0 &&
                      selectedIndices.size === currentRows.length,
                  }
                : undefined,
            onAddRow: tableInfo
              ? () => {
                  switchTab('table');
                  requestAnimationFrame(() => tableRenderer.triggerAddRow());
                }
              : undefined,
            dirtyCount: dirty,
            onCommit: dirty > 0 ? performSave : undefined,
            deleteSelectionCount: sel,
            onDeleteSelected: sel > 0 && tableView ? markSelectedRowsForDeletion : undefined,
            deleteUnavailableReason:
              sel > 0 && !tableInfo?.primaryKeys
                ? 'Warning: No primary keys detected. Deletion may fail.'
                : undefined,
            onRevert:
              dirty > 0
                ? () => {
                    tableRenderer.revertAllPendingChanges();
                    syncPendingChangesUi();
                  }
                : undefined,
          }),
        );
        updateIdentityStats();
      };

      // CHART RENDERER
      const chartCanvas = document.createElement('canvas');
      const chartRenderer = new ChartRenderer(chartCanvas);

      // Store for cleanup on disposal
      chartInstances.set(element, chartRenderer);

      const exportChartBtn = document.createElement('button');
      exportChartBtn.type = 'button';
      fillToolbarButtonContent(exportChartBtn, 'chart', 'Export Chart');
      applyResultRowToolStyle(exportChartBtn);
      attachResultRowToolInteractions(exportChartBtn);
      exportChartBtn.style.display = 'none'; // Hidden by default
      exportChartBtn.onclick = () => {
        const dataUrl = chartRenderer.exportImage('png');
        if (dataUrl) {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `chart-${new Date().toISOString()}.png`;
          a.click();
        }
      };
      secondaryTabsRight.appendChild(exportChartBtn);
      secondaryTabsRight.appendChild(createAiMenuButton(aiMenuCallbacks));

      const updateActionsVisibility = () => {
        if (currentMode === 'chart') {
          exportChartBtn.style.display = 'inline-block';
        } else {
          exportChartBtn.style.display = 'none';
        }
        refreshResultFooter();
      };

      // Switch Tab Logic

      const setSecondaryActive = (mode: string | null) => {
        applyResultViewTabStyle(noticesBtn, mode === 'notices');
        applyResultViewTabStyle(transposeBtn, mode === 'transpose');
        if (explainTabBtn) applyResultViewTabStyle(explainTabBtn, mode === 'explain');
        syncReviewTabButton();
      };

      switchTab = (mode: string) => {
        currentMode = mode;
        viewContainer.innerHTML = '';

        if (mode === 'table' || mode === 'chart' || mode === 'analyst') {
          lastPrimaryMode = mode;
          syncPrimaryButtons();
          setSecondaryActive(null);
        } else {
          syncPrimaryButtons();
          setSecondaryActive(mode);
        }

        if (mode === 'table') {
          updateActionsVisibility();
          tableRenderer.render(buildTableRenderOptions());
          attachSlideScroll();
        } else if (mode === 'notices') {
          updateActionsVisibility();
          viewContainer.appendChild(
            renderNoticesPanel(noticeItems, {
              onAskAssistant: () => {
                context.postMessage?.({
                  type: 'sendToChat',
                  data: {
                    query: query || '',
                    message:
                      'I ran this query and received the following PostgreSQL notices (RAISE NOTICE / server messages). Please help me interpret them or suggest improvements.',
                    notices: noticeItems,
                  },
                });
              },
            }),
          );
        } else if (mode === 'transpose') {
          updateActionsVisibility();
          const transposeEl = renderTransposeTable(
            columns,
            currentRows,
            columnTypes,
            byteaDisplayFormat,
          );
          viewContainer.appendChild(transposeEl);
        } else if (mode === 'review') {
          updateActionsVisibility();
          viewContainer.appendChild(renderReviewChangesView());
        } else if (mode === 'explain') {
          updateActionsVisibility();

          const explainWrapper = document.createElement('div');
          explainWrapper.style.cssText =
            'flex: 1; overflow: auto; height: 100%; display: flex; flex-direction: column;';
          viewContainer.appendChild(explainWrapper);

          if (json.explainPlan) {
            try {
              new ExplainVisualizer(explainWrapper, json.explainPlan).render();
            } catch (e) {
              explainWrapper.textContent = 'Failed to render explain plan: ' + String(e);
            }
          } else {
            explainWrapper.textContent =
              'No explain plan data available. Run EXPLAIN (ANALYZE, FORMAT JSON) to get a visual plan.';
          }
        } else if (mode === 'analyst') {
          updateActionsVisibility();
          const streamingHint = createAnalyticsStreamingWarning('Analyst');
          if (streamingHint) {
            viewContainer.appendChild(streamingHint);
          }
          viewContainer.appendChild(
            renderAnalystPanel({
              columns,
              rows: currentRows,
              columnTypes,
              isStreaming: !!slideMeta?.sessionId,
              onAskAiForPivotHelp: (pivotCtx) => {
                const sqlText = (buildFullDatasetRerunQuery() || exportQuery || query || '').trim();
                context.postMessage?.({
                  type: 'sendToChat',
                  data: {
                    query: sqlText || query || '',
                    message: buildPivotOptimizeUserMessage(pivotCtx, sqlText || query || ''),
                  },
                });
              },
              onRunFullDataset: () => {
                const rerunQuery = buildFullDatasetRerunQuery();
                if (!rerunQuery) {
                  context.postMessage?.({
                    type: 'showErrorMessage',
                    message: 'No query available to rerun for full dataset.',
                  });
                  return;
                }
                context.postMessage?.({
                  type: 'runDerivedQuery',
                  query: rerunQuery,
                  source: 'streaming-analyst-pivot-full-dataset',
                  fullDataset: true,
                });
              },
            }),
          );
        } else {
          // chart
          updateActionsVisibility();
          const streamingHint = createAnalyticsStreamingWarning('Chart');
          if (streamingHint) {
            viewContainer.appendChild(streamingHint);
          }

          const chartWrapper = document.createElement('div');
          chartWrapper.style.cssText =
            'flex: 1; display: flex; flex-direction: column; height: 100%; overflow: hidden;';

          const controlsContainer = document.createElement('div');
          controlsContainer.style.cssText =
            'width: 20%; min-width: 160px; max-width: 240px; display: flex; flex-direction: column; border-right: 1px solid var(--vscode-widget-border);';

          const canvasContainer = document.createElement('div');
          canvasContainer.style.cssText =
            'flex: 1; padding: 8px; position: relative; min-height: 0;';
          canvasContainer.appendChild(chartCanvas);

          const innerContainer = document.createElement('div');
          innerContainer.style.cssText = 'display: flex; flex: 1; overflow: hidden; height: 100%;';
          innerContainer.appendChild(controlsContainer);
          innerContainer.appendChild(canvasContainer);
          chartWrapper.appendChild(innerContainer);

          viewContainer.appendChild(chartWrapper);

          new ChartControls(controlsContainer, {
            columns,
            rows: currentRows,
            onConfigChange: (config) => {
              chartRenderer.render(currentRows, config);
            },
          });
        }
        refreshResultFooter();
      };

      showOverflowMenu = (anchorEl: HTMLElement) => {
        const existing = document.querySelector('.result-overflow-menu');
        if (existing) {
          existing.remove();
          return;
        }

        const menu = document.createElement('div');
        menu.className = 'result-overflow-menu';
        menu.style.cssText =
          'position:fixed;background:var(--vscode-menu-background);border:1px solid var(--vscode-menu-border);box-shadow:0 4px 12px rgba(0,0,0,0.2);z-index:1000;min-width:170px;border-radius:4px;padding:3px 0;';

        const addItem = (label: string, onClick: () => void) => {
          const item = document.createElement('div');
          item.textContent = label;
          item.style.cssText =
            'padding:6px 14px;cursor:pointer;color:var(--vscode-menu-foreground);font-size:12px;font-family:var(--vscode-font-family);';
          item.onmouseenter = () => {
            item.style.background = 'var(--vscode-menu-selectionBackground)';
            item.style.color = 'var(--vscode-menu-selectionForeground)';
          };
          item.onmouseleave = () => {
            item.style.background = 'transparent';
            item.style.color = 'var(--vscode-menu-foreground)';
          };
          item.onclick = (e) => {
            e.stopPropagation();
            onClick();
            menu.remove();
          };
          menu.appendChild(item);
        };

        addItem('⇄ Transpose', () => switchTab('transpose'));
        if (noticeItems.length > 0) {
          addItem(`Notices (${noticeItems.length})`, () => switchTab('notices'));
        }
        if (json.explainPlan) {
          addItem('Explain Plan', () => switchTab('explain'));
        }
        if (breadcrumb?.connectionName) {
          addItem('Switch connection…', () =>
            context.postMessage?.({
              type: 'showConnectionSwitcher',
              connectionId: breadcrumb.connectionId,
            }),
          );
        }
        if (breadcrumb?.database) {
          addItem('Switch database…', () =>
            context.postMessage?.({
              type: 'showDatabaseSwitcher',
              connectionId: breadcrumb.connectionId,
              currentDatabase: breadcrumb.database,
            }),
          );
        }

        document.body.appendChild(menu);
        const rect = anchorEl.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        const mw = 200;
        menu.style.left = `${Math.max(8, Math.min(rect.right - mw, window.innerWidth - mw - 8))}px`;

        setTimeout(() => {
          const close = () => {
            menu.remove();
            document.removeEventListener('click', close);
          };
          document.addEventListener('click', close);
        }, 0);
      };

      // Initial Render
      if (columns.length > 0) {
        switchTab('table');
      } else if (noticeItems.length > 0) {
        switchTab('notices');
      } else {
        const filler = document.createElement('div');
        filler.style.cssText =
          'padding:12px;color:var(--vscode-descriptionForeground);font-size:12px;';
        filler.textContent =
          (rowCount ?? 0) === 0 && (currentRows?.length ?? 0) === 0
            ? 'Query returned no data'
            : 'Unable to display this result (no column metadata). Re-run the query after updating the extension.';
        viewContainer.appendChild(filler);
      }

      // Result history tab strip — rendered above mainContainer when >1 result exists
      const tabStripEl = renderTabStrip(element, resultHistory, 0, (selectedIndex) => {
        // Re-render with a previous result's data
        const entry = getResultHistory(element)[selectedIndex];
        if (!entry) return;
        element.innerHTML = '';
        // Re-trigger renderOutputItem with the historical data by re-building the output
        // For now: show history entry as a read-only view
        const histContainer = document.createElement('div');
        histContainer.style.cssText =
          'padding:6px 12px;font-size:11px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-widget-border);background:var(--vscode-editor-background);';
        histContainer.textContent = `Showing result from ${new Date(entry.timestamp).toLocaleTimeString()} — ${(entry.rowCount ?? entry.rows?.length ?? 0).toLocaleString()} rows`;
        element.appendChild(histContainer);

        const histTableContainer = document.createElement('div');
        histTableContainer.style.cssText = 'max-height:400px;overflow:auto;';
        const histRenderer = new TableRenderer(histTableContainer, {});
        histRenderer.render({
          columns: entry.columns,
          rows: entry.rows || [],
          originalRows: entry.rows || [],
          columnTypes: entry.columnTypes,
          tableInfo: entry.tableInfo,
          byteaDisplayFormat: entry.byteaDisplayFormat ?? BYTEA_DISPLAY_DEFAULT,
        });
        element.appendChild(histTableContainer);
      });
      if (tabStripEl) element.appendChild(tabStripEl);

      const outputRoot = document.createElement('div');
      outputRoot.setAttribute('data-pg-output-hover-root', 'true');
      outputRoot.style.cssText = 'position:relative;display:flex;flex-direction:column;';

      const hoverToolbar = document.createElement('div');
      hoverToolbar.setAttribute('role', 'toolbar');
      hoverToolbar.setAttribute('aria-label', 'Result quick actions');
      hoverToolbar.style.cssText = `
        display:flex;
        flex-wrap:wrap;
        justify-content:flex-end;
        align-items:center;
        gap:6px;
        max-width:min(680px, 100%);
        padding:5px 8px;
        border-radius:10px;
        background:color-mix(in srgb, var(--vscode-editor-background) 86%, transparent);
        border:1px solid color-mix(in srgb, var(--vscode-widget-border) 42%, transparent);
        box-shadow:0 4px 18px rgba(0,0,0,0.1);
        backdrop-filter:blur(10px);
      `;

      const toolbarDock = document.createElement('div');
      toolbarDock.style.cssText = `
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        gap:6px;
        position:absolute;
        right:10px;
        top:-30px;
        z-index:34;
      `;
      const toolbarToggle = document.createElement('button');
      toolbarToggle.type = 'button';
      fillOutputHoverToolButton(toolbarToggle, 'sparkles', 'AI actions');
      toolbarToggle.style.padding = '5px 12px';
      toolbarToggle.style.fontSize = '11px';
      const toggleChevron = document.createElement('span');
      toggleChevron.style.cssText = 'font-size:11px;line-height:1;opacity:0.85;';
      toggleChevron.textContent = '▸';
      toolbarToggle.appendChild(toggleChevron);

      let toolbarCollapsed = true;
      const updateToolbarVisibility = (): void => {
        hoverToolbar.style.display = toolbarCollapsed ? 'none' : 'flex';
        toolbarToggle.setAttribute('aria-expanded', toolbarCollapsed ? 'false' : 'true');
        toolbarToggle.title = toolbarCollapsed ? 'Show result AI actions' : 'Hide result AI actions';
        toggleChevron.textContent = toolbarCollapsed ? '▸' : '▾';
      };
      toolbarToggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toolbarCollapsed = !toolbarCollapsed;
        updateToolbarVisibility();
      });
      updateToolbarVisibility();

      const addHoverTool = (
        glyph: ResultToolbarGlyph,
        label: string,
        onClick: () => void,
        opts?: { disabled?: boolean; title?: string },
      ): void => {
        const btn = document.createElement('button');
        btn.type = 'button';
        fillOutputHoverToolButton(btn, glyph, label);
        const title = opts?.title ?? label;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        if (opts?.disabled) {
          btn.disabled = true;
          btn.style.opacity = '0.42';
          btn.style.cursor = 'not-allowed';
        }
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (btn.disabled) {
            return;
          }
          onClick();
        });
        hoverToolbar.appendChild(btn);
      };

      const queryTrimmed = (query || '').trim();
      const cellLinked = sourceCellIndex >= 0;

      addHoverTool(
        'menuChat',
        'Add to chat',
        () => {
          const resultsJson = buildChatResultsSampleJson(
            columns,
            currentRows,
            CHAT_SEND_SAMPLE_ROW_CAP,
          );
          context.postMessage?.({
            type: 'sendToChat',
            data: {
              query: queryTrimmed,
              ...(resultsJson ? { results: resultsJson } : {}),
              ...(noticeItems.length > 0
                ? { notices: noticeItems.map(n => (n.message || '').trim()).filter(Boolean) }
                : {}),
              message:
                currentRows.length === 0
                  ? 'I ran this query. No rows were returned. Help me validate the query intent and next checks.'
                  : `I ran this query. The attachment includes at most ${CHAT_SEND_SAMPLE_ROW_CAP} sample rows from the result (not the full grid). Help me interpret it.`,
            },
          });
        },
        {
          disabled: !queryTrimmed,
          title: queryTrimmed
            ? 'Attach SQL and sampled result rows to SQL Assistant'
            : 'No query text',
        },
      );
      addHoverTool(
        'menuBolt',
        'Optimize',
        () => {
          aiMenuCallbacks.onOptimize();
        },
        {
          disabled: !queryTrimmed,
          title: queryTrimmed ? 'Suggest optimizations for this query' : 'No query text',
        },
      );
      addHoverTool(
        'sparkles',
        'Ask AI',
        () => {
          context.postMessage?.({
            type: 'notebookOutputToolbar',
            action: 'aiAssist',
            cellIndex: sourceCellIndex,
          });
        },
        {
          disabled: !cellLinked,
          title: cellLinked
            ? 'Ask AI to modify this query'
            : 'Re-run the cell to link actions to the source cell',
        },
      );
      addHoverTool(
        'save',
        'Save',
        () => {
          context.postMessage?.({
            type: 'notebookOutputToolbar',
            action: 'saveQuery',
            cellIndex: sourceCellIndex,
          });
        },
        {
          disabled: !cellLinked,
          title: cellLinked ? 'Save query to library' : 'Re-run the cell to link actions to the source cell',
        },
      );
      addHoverTool(
        'expandCell',
        'Expand',
        () => {
          context.postMessage?.({
            type: 'notebookOutputToolbar',
            action: 'expand',
            cellIndex: sourceCellIndex,
          });
        },
        {
          disabled: !cellLinked,
          title: cellLinked ? 'Focus the SQL cell in the editor' : 'Re-run the cell to link actions to the source cell',
        },
      );

      outputRoot.appendChild(mainContainer);
      toolbarDock.appendChild(toolbarToggle);
      toolbarDock.appendChild(hoverToolbar);
      outputRoot.appendChild(toolbarDock);
      element.appendChild(outputRoot);

      // Transaction state: show banner and amber gutter
      ensureAmberGutterStyle();
      if (transactionState?.isActive) {
        mainContainer.classList.add('amber-gutter');

        // Only add one banner per document (remove stale ones first)
        const existingBanner = document.querySelector('[data-transaction-banner="true"]');
        if (!existingBanner) {
          const banner = createTransactionBanner({
            statementCount: transactionState.statementCount,
            onCommit: () => {
              context.postMessage?.({ type: 'commitTransaction' });
            },
            onRollback: () => {
              context.postMessage?.({ type: 'rollbackTransaction' });
            },
          });
          // Insert banner before the first output container in the element's parent
          const outputHost = element.parentElement || element;
          outputHost.insertBefore(banner, outputHost.firstChild);
        }
      } else {
        // Transaction closed — clear all transaction UI
        clearTransactionUI();
      }
    },
  };
};

/**
 * ResultFooter — optional row tools (far left); Add Row / Delete / Commit / Revert (right).
 * Row count and execution time live in ResultIdentityBar.
 */

import type { RowToolsOptions } from './ActionBar';
import { createRowTools } from './ActionBar';

export interface ResultFooterOptions {
  onAddRow?: () => void;
  dirtyCount: number;
  onCommit?: () => void;
  /** Rows currently selected in the grid (table view); shows Delete Row (n) when &gt; 0. */
  deleteSelectionCount?: number;
  /** Mark selected rows for deletion (staged until Commit). */
  onDeleteSelected?: () => void;
  /** Warning when PK is missing — applied to Delete button title + muted style. */
  deleteUnavailableReason?: string;
  /** Discard pending edits / staged deletes (shown after Commit when dirtyCount &gt; 0). */
  onRevert?: () => void;
  /** All / Copy / Import / Export anchored in the footer (left, before stats). */
  rowTools?: RowToolsOptions;
}

function formatExecutionTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return ms >= 1000 ? `${seconds.toFixed(2)}s` : `${ms}ms`;
}

/** Stats line shown in the identity bar (footer no longer repeats row/time). */
export function formatResultExecutionStats(totalRows: number, executionTimeSeconds?: number): string {
  let statsText = `${totalRows.toLocaleString()} row${totalRows !== 1 ? 's' : ''}`;
  if (executionTimeSeconds !== undefined) {
    statsText += ` · ${formatExecutionTime(executionTimeSeconds)}`;
  }
  return statsText;
}

export function createResultFooter(options: ResultFooterOptions): HTMLElement {
  const {
    onAddRow,
    dirtyCount,
    onCommit,
    deleteSelectionCount = 0,
    onDeleteSelected,
    deleteUnavailableReason,
    onRevert,
    rowTools,
  } = options;

  const footer = document.createElement('div');
  footer.dataset.resultFooter = 'true';
  footer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 12px;
    border-top: 1px solid var(--vscode-widget-border);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
  `;

  if (rowTools) {
    footer.appendChild(createRowTools(rowTools));
  }

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  footer.appendChild(spacer);

  if (onAddRow) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Row';
    addBtn.style.cssText = `
      padding: 2px 10px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      background: none;
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
      border-radius: 3px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.1s;
    `;
    addBtn.onmouseover = () => {
      addBtn.style.background = 'var(--vscode-button-secondaryHoverBackground)';
    };
    addBtn.onmouseout = () => {
      addBtn.style.background = 'none';
    };
    addBtn.onclick = onAddRow;
    footer.appendChild(addBtn);
  }

  /** Lighter tomato — stage rows for deletion */
  const TOMATO = '#ff8066';

  if (deleteSelectionCount > 0 && onDeleteSelected) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('data-pg-result-delete', 'true');
    deleteBtn.textContent = `Delete Row (${deleteSelectionCount})`;
    deleteBtn.style.cssText = `
      padding: 2px 10px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      background: color-mix(in srgb, ${TOMATO} 11%, transparent);
      color: ${TOMATO};
      border: 1px solid color-mix(in srgb, ${TOMATO} 32%, transparent);
      border-radius: 3px;
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
      transition: background 0.1s;
    `;
    if (deleteUnavailableReason) {
      deleteBtn.style.opacity = '0.72';
      deleteBtn.title = deleteUnavailableReason;
    } else {
      deleteBtn.title = 'Stage selected rows for deletion (commit with Commit)';
    }
    deleteBtn.onmouseover = () => {
      deleteBtn.style.background = `color-mix(in srgb, ${TOMATO} 18%, transparent)`;
    };
    deleteBtn.onmouseout = () => {
      deleteBtn.style.background = `color-mix(in srgb, ${TOMATO} 11%, transparent)`;
    };
    deleteBtn.onclick = onDeleteSelected;
    footer.appendChild(deleteBtn);
  }

  if (dirtyCount > 0 && onCommit) {
    const commitBtn = document.createElement('button');
    commitBtn.type = 'button';
    commitBtn.setAttribute('data-pg-result-commit', 'true');
    commitBtn.textContent = `Commit (${dirtyCount})`;
    commitBtn.style.cssText = `
      padding: 2px 10px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      background: color-mix(in srgb, #f59e0b 15%, transparent);
      color: #f59e0b;
      border: 1px solid color-mix(in srgb, #f59e0b 40%, transparent);
      border-radius: 3px;
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
      transition: background 0.1s;
    `;
    commitBtn.onmouseover = () => {
      commitBtn.style.background = 'color-mix(in srgb, #f59e0b 25%, transparent)';
    };
    commitBtn.onmouseout = () => {
      commitBtn.style.background = 'color-mix(in srgb, #f59e0b 15%, transparent)';
    };
    commitBtn.onclick = onCommit;
    footer.appendChild(commitBtn);
  }

  if (dirtyCount > 0 && onRevert) {
    const revertBtn = document.createElement('button');
    revertBtn.type = 'button';
    revertBtn.textContent = 'Revert';
    revertBtn.title = 'Discard all unstaged cell edits and staged row deletions';
    revertBtn.style.cssText = `
      padding: 2px 10px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      background: color-mix(in srgb, #22c55e 14%, transparent);
      color: #22c55e;
      border: 1px solid color-mix(in srgb, #22c55e 38%, transparent);
      border-radius: 3px;
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
      transition: background 0.1s;
    `;
    revertBtn.onmouseover = () => {
      revertBtn.style.background = 'color-mix(in srgb, #22c55e 22%, transparent)';
    };
    revertBtn.onmouseout = () => {
      revertBtn.style.background = 'color-mix(in srgb, #22c55e 14%, transparent)';
    };
    revertBtn.onclick = onRevert;
    footer.appendChild(revertBtn);
  }

  return footer;
}

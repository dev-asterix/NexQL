/**
 * FilterBar.ts
 * Azure-style filter group for the data grid.
 * Supports a global filter, active filter chips, and an add-filter flyout.
 */

import { FilterClause, FilterOperator, FilterState } from '../../../common/types';
import {
  RESULT_TOOLBAR_ICON_CLASS,
  applyAddFilterButtonStyle,
  resultToolbarSvg,
} from '../ResultToolbarUi';

export interface FilterBarOptions {
  columns: string[];
  rows: any[];
  filterState: FilterState;
  onFilterChange: (state: FilterState) => void;
  onAddRow?: () => void;
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'contains',
  equals: 'equals',
  startsWith: 'starts with',
  endsWith: 'ends with',
};

const OPERATOR_OPTIONS: Array<{ value: FilterOperator; label: string }> = [
  { value: 'equals', label: 'Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'startsWith', label: 'Starts With' },
  { value: 'endsWith', label: 'Ends With' },
];

export class FilterBar {
  private container: HTMLElement;
  private filterState: FilterState;
  private onFilterChange: (state: FilterState) => void;
  private onAddRow?: () => void;
  private rows: any[];
  private columns: string[] = [];
  private globalInput: HTMLInputElement | null = null;
  private chipRow: HTMLElement | null = null;
  private badge: HTMLElement | null = null;
  private addFilterPanel: HTMLElement | null = null;

  constructor(options: FilterBarOptions) {
    this.container = document.createElement('div');
    this.filterState = this.cloneFilterState(options.filterState);
    this.rows = options.rows;
    this.onFilterChange = options.onFilterChange;
    this.onAddRow = options.onAddRow;
    this.columns = options.columns;
    this.render(options.columns);
  }

  getElement(): HTMLElement {
    return this.container;
  }

  private cloneFilterState(state: FilterState): FilterState {
    return {
      globalQuery: state.globalQuery || '',
      clauses: state.clauses.map((clause) => ({ ...clause })),
    };
  }

  private emitChange() {
    this.onFilterChange(this.cloneFilterState(this.filterState));
    this.syncFilterGroup();
  }

  private syncFilterGroup() {
    if (this.globalInput) {
      this.globalInput.value = this.filterState.globalQuery;
    }

    if (this.badge) {
      const count = this.countActiveFilters();
      this.badge.textContent = count > 0 ? `${count} active` : '';
      this.badge.style.cssText = count > 0
        ? 'font-size:10px;color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);padding:1px 6px;border-radius:10px;white-space:nowrap;'
        : '';
    }

    const chipRow = this.chipRow;
    if (!chipRow) {
      return;
    }

    chipRow.innerHTML = '';

    this.filterState.clauses.forEach((clause) => {
      const label = `${clause.column} ${OPERATOR_LABELS[clause.operator]} ${clause.value}`;
      chipRow.appendChild(this.createChip(label, () => {
        this.filterState.clauses = this.filterState.clauses.filter((item) => item.id !== clause.id);
        this.emitChange();
      }));
    });

    if (this.filterState.globalQuery) {
      chipRow.appendChild(this.createChip(`Any field contains ${this.filterState.globalQuery}`, () => {
        this.filterState.globalQuery = '';
        this.emitChange();
      }));
    }
  }

  private countActiveFilters(): number {
    return (this.filterState.globalQuery ? 1 : 0) + this.filterState.clauses.length;
  }

  private getDistinctValues(column: string): string[] {
    const values = new Set<string>();
    for (const row of this.rows) {
      const rawValue = row?.[column];
      if (rawValue === null || rawValue === undefined) {
        continue;
      }
      values.add(String(rawValue));
      if (values.size >= 50) {
        break;
      }
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }

  private closeAddFilterPanel() {
    this.addFilterPanel?.remove();
    this.addFilterPanel = null;
  }

  private openAddFilterPanel(columns: string[], anchor?: HTMLElement) {
    if (this.addFilterPanel) {
      this.closeAddFilterPanel();
      return;
    }

    const panel = document.createElement('div');
    panel.style.cssText = `
      position:fixed;
      width:320px;
      background:var(--vscode-editor-background);
      border:1px solid var(--vscode-widget-border);
      box-shadow:0 10px 28px rgba(0,0,0,0.28);
      border-radius:8px;
      padding:14px;
      z-index:50;
      display:flex;
      flex-direction:column;
      gap:10px;
      max-height:calc(100vh - 24px);
      overflow:auto;
    `;

    const title = document.createElement('div');
    title.textContent = 'Filter results';
    title.style.cssText = 'font-size:14px;font-weight:600;color:var(--vscode-foreground);margin-bottom:2px;';
    panel.appendChild(title);

    const createField = (labelText: string) => {
      const wrapper = document.createElement('label');
      wrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--vscode-foreground);';
      const label = document.createElement('span');
      label.textContent = labelText;
      label.style.cssText = 'font-size:12px;color:var(--vscode-foreground);';
      wrapper.appendChild(label);
      return wrapper;
    };

    const columnField = createField('Filter');
    const columnSelect = document.createElement('select');
    columnSelect.style.cssText = `
      height:28px;
      background:var(--vscode-input-background);
      color:var(--vscode-input-foreground);
      border:1px solid var(--vscode-widget-border);
      border-radius:4px;
      padding:0 8px;
      font-size:12px;
    `;
    columns.forEach((column) => {
      const option = document.createElement('option');
      option.value = column;
      option.textContent = column;
      columnSelect.appendChild(option);
    });
    columnField.appendChild(columnSelect);
    panel.appendChild(columnField);

    const operatorField = createField('Operator');
    const operatorSelect = document.createElement('select');
    operatorSelect.style.cssText = columnSelect.style.cssText;
    OPERATOR_OPTIONS.forEach((optionDef) => {
      const option = document.createElement('option');
      option.value = optionDef.value;
      option.textContent = optionDef.label;
      operatorSelect.appendChild(option);
    });
    operatorField.appendChild(operatorSelect);
    panel.appendChild(operatorField);

    const valueField = createField('Value');
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = 'Search values';
    valueInput.style.cssText = `
      height:28px;
      background:var(--vscode-input-background);
      color:var(--vscode-input-foreground);
      border:1px solid var(--vscode-widget-border);
      border-radius:4px;
      padding:0 8px;
      font-size:12px;
      outline:none;
    `;

    const suggestions = document.createElement('datalist');
    suggestions.id = `filter-values-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    valueInput.setAttribute('list', suggestions.id);

    const refreshSuggestions = () => {
      suggestions.innerHTML = '';
      this.getDistinctValues(columnSelect.value).forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        suggestions.appendChild(option);
      });
    };

    refreshSuggestions();
    columnSelect.addEventListener('change', refreshSuggestions);

    valueField.appendChild(valueInput);
    valueField.appendChild(suggestions);
    panel.appendChild(valueField);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:4px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background:none;
      color:var(--vscode-foreground);
      border:1px solid var(--vscode-widget-border);
      border-radius:4px;
      padding:5px 12px;
      cursor:pointer;
      font-size:12px;
    `;
    cancelBtn.addEventListener('click', () => this.closeAddFilterPanel());

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = 'Apply';
    applyBtn.style.cssText = `
      background:var(--vscode-button-background);
      color:var(--vscode-button-foreground);
      border:1px solid transparent;
      border-radius:4px;
      padding:5px 12px;
      cursor:pointer;
      font-size:12px;
    `;
    applyBtn.addEventListener('click', () => {
      const value = valueInput.value.trim();
      if (!value) {
        valueInput.focus();
        return;
      }

      const nextClause: FilterClause = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        column: columnSelect.value,
        operator: operatorSelect.value as FilterOperator,
        value,
      };

      this.filterState.clauses.push(nextClause);
      this.closeAddFilterPanel();
      this.emitChange();
    });

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(applyBtn);
    panel.appendChild(buttonRow);

    const anchorRect = anchor?.getBoundingClientRect();
    const estimatedHeight = 340;
    const viewportPadding = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = viewportWidth - panel.offsetWidth - 16;
    if (anchorRect) {
      left = Math.min(anchorRect.left, viewportWidth - 16 - 320);
      left = Math.max(viewportPadding, left);

      const spaceBelow = viewportHeight - anchorRect.bottom - viewportPadding;
      const spaceAbove = anchorRect.top - viewportPadding;
      if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
        panel.style.top = `${Math.max(viewportPadding, anchorRect.top - estimatedHeight - 8)}px`;
      } else {
        panel.style.top = `${Math.min(viewportHeight - estimatedHeight - viewportPadding, anchorRect.bottom + 8)}px`;
      }
    }
    panel.style.left = `${left}px`;

    this.addFilterPanel = panel;
    document.body.appendChild(panel);
    setTimeout(() => valueInput.focus(), 0);
  }

  private render(columns: string[]) {
    this.container.innerHTML = '';
    this.columns = columns;
    this.container.style.cssText = `
      position:relative;
      display:flex;
      align-items:flex-start;
      gap:8px;
      padding:6px 8px;
      background:var(--vscode-editor-background);
      border-bottom:1px solid var(--vscode-widget-border);
      flex-wrap:wrap;
    `;

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;min-width:0;';

    const globalInput = document.createElement('input');
    globalInput.type = 'text';
    globalInput.placeholder = 'Filter for any field...';
    globalInput.value = this.filterState.globalQuery;
    globalInput.style.cssText = `
      min-width:220px;
      flex:1;
      max-width:100%;
      background:var(--vscode-input-background);
      color:var(--vscode-input-foreground);
      border:1px solid var(--vscode-widget-border);
      border-radius:4px;
      padding:4px 10px;
      font-size:12px;
      outline:none;
    `;
    globalInput.addEventListener('input', () => {
      this.filterState.globalQuery = globalInput.value.trim();
      this.emitChange();
    });
    this.globalInput = globalInput;

    const addFilterBtn = document.createElement('button');
    addFilterBtn.type = 'button';
    addFilterBtn.title = 'Add a column filter';
    applyAddFilterButtonStyle(addFilterBtn);
    addFilterBtn.addEventListener('click', () => this.openAddFilterPanel(columns, addFilterBtn));

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.title = 'Clear all filters';
    clearBtn.setAttribute('aria-label', 'Clear all filters');
    clearBtn.style.cssText = `
      display:inline-flex;
      align-items:center;
      justify-content:center;
      background:none;
      border:none;
      color:var(--vscode-descriptionForeground);
      cursor:pointer;
      padding:4px 6px;
      line-height:1;
      border-radius:4px;
    `;
    const clearIc = document.createElement('span');
    clearIc.className = RESULT_TOOLBAR_ICON_CLASS;
    clearIc.innerHTML = resultToolbarSvg('close');
    clearBtn.appendChild(clearIc);
    clearBtn.addEventListener('mouseenter', () => {
      clearBtn.style.background =
        'color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 55%, transparent)';
    });
    clearBtn.addEventListener('mouseleave', () => {
      clearBtn.style.background = 'none';
    });
    clearBtn.addEventListener('click', () => {
      this.filterState.globalQuery = '';
      this.filterState.clauses = [];
      this.closeAddFilterPanel();
      this.emitChange();
    });

    const badge = document.createElement('span');
    this.badge = badge;

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1 1 100%;min-width:0;margin-top:4px;';

    this.chipRow = chipRow;

    const renderChip = (label: string, onRemove: () => void) => {
      const chip = document.createElement('div');
      chip.style.cssText = `
        display:inline-flex;
        align-items:center;
        gap:6px;
        border-radius:999px;
        padding:4px 10px;
        background:var(--vscode-badge-background);
        color:var(--vscode-badge-foreground);
        font-size:12px;
        line-height:1;
        white-space:nowrap;
      `;

      const text = document.createElement('span');
      text.textContent = label;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Remove filter';
      remove.style.cssText = `
        background:none;
        border:none;
        color:inherit;
        cursor:pointer;
        font-size:14px;
        line-height:1;
        padding:0;
      `;
      remove.addEventListener('click', onRemove);

      chip.appendChild(text);
      chip.appendChild(remove);
      return chip;
    };

    this.createChip = renderChip;
    this.syncFilterGroup();

    leftGroup.appendChild(globalInput);
    leftGroup.appendChild(addFilterBtn);
    leftGroup.appendChild(clearBtn);
    leftGroup.appendChild(badge);

    this.container.appendChild(leftGroup);
    this.container.appendChild(chipRow);

    if (this.addFilterPanel) {
      this.addFilterPanel.remove();
      this.addFilterPanel = null;
    }
  }

  private createChip: (label: string, onRemove: () => void) => HTMLElement = () => document.createElement('div');

  /**
   * Apply filter to rows — returns filtered rows
   */
  static applyFilter(rows: any[], filterState: FilterState, columns: string[]): any[] {
    const hasGlobal = Boolean(filterState.globalQuery?.trim());
    const hasClauses = filterState.clauses.length > 0;
    if (!hasGlobal && !hasClauses) {
      return rows;
    }

    const globalFilter = filterState.globalQuery.trim().toLowerCase();

    return rows.filter((row) => {
      if (globalFilter) {
        const matchesGlobal = columns.some((column) => {
          const value = row[column];
          if (value === null || value === undefined) {
            return false;
          }
          return String(value).toLowerCase().includes(globalFilter);
        });

        if (!matchesGlobal) {
          return false;
        }
      }

      for (const clause of filterState.clauses) {
        const value = row[clause.column];
        if (value === null || value === undefined) {
          return false;
        }

        const left = String(value).toLowerCase();
        const right = clause.value.toLowerCase();

        switch (clause.operator) {
          case 'equals':
            if (left !== right) { return false; }
            break;
          case 'contains':
            if (!left.includes(right)) { return false; }
            break;
          case 'startsWith':
            if (!left.startsWith(right)) { return false; }
            break;
          case 'endsWith':
            if (!left.endsWith(right)) { return false; }
            break;
        }
      }

      return true;
    });
  }
}

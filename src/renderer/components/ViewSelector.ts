/**
 * ViewSelector.ts
 * Dropdown for Table / Chart / Analyst primary views.
 */

export type PrimaryView = 'table' | 'chart' | 'analyst';

export interface ViewSelectorOption {
  id: PrimaryView;
  label: string;
  icon: string;
}

export interface ViewSelectorOptions {
  current: PrimaryView;
  available?: ViewSelectorOption[];
  onChange: (view: PrimaryView) => void;
}

export interface ViewSelectorHandle {
  element: HTMLElement;
  setCurrentView: (view: PrimaryView) => void;
}

const DEFAULT_VIEWS: ViewSelectorOption[] = [
  { id: 'table', label: 'Table', icon: '⊞' },
  { id: 'chart', label: 'Chart', icon: '◎' },
  { id: 'analyst', label: 'Analyst', icon: '⊛' },
];

export function createViewSelector(options: ViewSelectorOptions): ViewSelectorHandle {
  const { current, available = DEFAULT_VIEWS, onChange } = options;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;flex-shrink:0;';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = `
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
  `;

  let currentId: PrimaryView = current;

  const renderBtnLabel = (id: PrimaryView) => {
    currentId = id;
    const opt = available.find((v) => v.id === id) ?? available[0];
    btn.innerHTML = '';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = opt.icon;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = opt.label;
    const chevronSpan = document.createElement('span');
    chevronSpan.textContent = '▾';
    chevronSpan.style.cssText = 'font-size:9px;opacity:0.6;';
    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    btn.appendChild(chevronSpan);
  };

  renderBtnLabel(current);

  btn.onmouseover = () => {
    btn.style.background = 'var(--vscode-button-secondaryHoverBackground)';
  };
  btn.onmouseout = () => {
    btn.style.background = 'var(--vscode-button-secondaryBackground)';
  };

  let popover: HTMLElement | null = null;

  const closePopover = () => {
    popover?.remove();
    popover = null;
    document.removeEventListener('click', outsideClick);
  };

  const outsideClick = (e: MouseEvent) => {
    if (!wrapper.contains(e.target as Node)) closePopover();
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    if (popover) {
      closePopover();
      return;
    }

    popover = document.createElement('div');
    popover.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 2px;
      min-width: 130px;
      background: var(--vscode-menu-background);
      border: 1px solid var(--vscode-menu-border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 500;
      padding: 3px 0;
    `;

    available.forEach((opt) => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 5px 12px;
        cursor: pointer;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-menu-foreground);
        ${opt.id === currentId ? 'font-weight:600;' : ''}
      `;
      const iconSpan = document.createElement('span');
      iconSpan.textContent = opt.icon;
      const labelSpan = document.createElement('span');
      labelSpan.textContent = opt.label;
      item.appendChild(iconSpan);
      item.appendChild(labelSpan);
      if (opt.id === currentId) {
        const check = document.createElement('span');
        check.textContent = '✓';
        check.style.cssText = 'margin-left:auto;font-size:11px;opacity:0.7;';
        item.appendChild(check);
      }
      item.onmouseenter = () => {
        item.style.background = 'var(--vscode-menu-selectionBackground)';
        item.style.color = 'var(--vscode-menu-selectionForeground)';
      };
      item.onmouseleave = () => {
        item.style.background = 'transparent';
        item.style.color = 'var(--vscode-menu-foreground)';
      };
      item.onclick = (ev) => {
        ev.stopPropagation();
        renderBtnLabel(opt.id);
        onChange(opt.id);
        closePopover();
      };
      popover!.appendChild(item);
    });

    wrapper.appendChild(popover);
    setTimeout(() => document.addEventListener('click', outsideClick), 0);
  };

  wrapper.appendChild(btn);

  return {
    element: wrapper,
    setCurrentView: (view: PrimaryView) => {
      if (available.some((o) => o.id === view)) {
        renderBtnLabel(view);
      }
    },
  };
}

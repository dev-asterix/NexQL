/**
 * InlineBanner.ts
 * Dismissible inline banner. Severity controls color.
 */

export type BannerSeverity = 'warning' | 'info' | 'error';

export interface InlineBannerOptions {
  severity: BannerSeverity;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  dismissible?: boolean;
  /** Called when the user clicks the dismiss (×) control. */
  onDismiss?: () => void;
  /** Optional mute control (e.g. hide this hint forever). Rendered before dismiss. */
  onMuteForever?: () => void;
}

const SEVERITY_STYLES: Record<
  BannerSeverity,
  { bg: string; border: string; icon: string; fg: string }
> = {
  warning: {
    bg: 'color-mix(in srgb, #f59e0b 12%, transparent)',
    border: 'color-mix(in srgb, #f59e0b 35%, transparent)',
    fg: 'var(--vscode-editorWarning-foreground)',
    icon: '⚠',
  },
  info: {
    bg: 'color-mix(in srgb, #3b82f6 10%, transparent)',
    border: 'color-mix(in srgb, #3b82f6 30%, transparent)',
    fg: 'var(--vscode-textLink-foreground)',
    icon: 'ⓘ',
  },
  error: {
    bg: 'color-mix(in srgb, #ef4444 10%, transparent)',
    border: 'color-mix(in srgb, #ef4444 30%, transparent)',
    fg: 'var(--vscode-errorForeground)',
    icon: '✕',
  },
};

export function createInlineBanner(options: InlineBannerOptions): HTMLElement {
  const { severity, message, actionLabel, onAction, dismissible = true, onDismiss, onMuteForever } =
    options;
  const s = SEVERITY_STYLES[severity];

  const banner = document.createElement('div');
  banner.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    background: ${s.bg};
    border-bottom: 1px solid ${s.border};
    font-family: var(--vscode-font-family);
    font-size: 11px;
    color: var(--vscode-editor-foreground);
  `;

  const icon = document.createElement('span');
  icon.textContent = s.icon;
  icon.style.cssText = `color: ${s.fg}; font-size: 13px; flex-shrink: 0;`;
  banner.appendChild(icon);

  const text = document.createElement('span');
  text.textContent = message;
  text.style.flex = '1';
  banner.appendChild(text);

  if (actionLabel && onAction) {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.textContent = actionLabel;
    actionBtn.style.cssText = `
      background: none;
      border: 1px solid ${s.border};
      color: ${s.fg};
      border-radius: 3px;
      padding: 1px 8px;
      cursor: pointer;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      flex-shrink: 0;
    `;
    actionBtn.onclick = onAction;
    banner.appendChild(actionBtn);
  }

  const btnStyle = `
      background: none; border: none; cursor: pointer;
      color: var(--vscode-descriptionForeground);
      font-size: 15px; line-height: 1;
      padding: 0 4px;
      flex-shrink: 0;
    `;

  if (onMuteForever) {
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.textContent = '🔕';
    muteBtn.title = 'Mute forever — never show this hint again';
    muteBtn.style.cssText = btnStyle;
    muteBtn.onclick = () => {
      onMuteForever();
      banner.remove();
    };
    banner.appendChild(muteBtn);
  }

  if (dismissible) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = 'Dismiss for now (hint may return after a week or 100 streaming queries)';
    closeBtn.style.cssText = btnStyle;
    closeBtn.onclick = () => {
      onDismiss?.();
      banner.remove();
    };
    banner.appendChild(closeBtn);
  }

  return banner;
}

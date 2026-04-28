/**
 * Modal confirming permanent grid edits before posting saveChanges to the extension host.
 */

export interface CommitConfirmDialogOptions {
  /** Primary label for confirm (includes count if desired). */
  confirmLabel?: string;
  /** Called when user confirms; argument is whether "don't ask again" was checked. */
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

const OVERLAY_Z_INDEX = 5000;

/** Full-viewport overlay + card. Appended to document.body so it stacks above table chrome. */
export function openCommitConfirmDialog(options: CommitConfirmDialogOptions): () => void {
  const confirmLabel = options.confirmLabel ?? 'Commit';

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'presentation');
  overlay.style.cssText = `
    position:fixed;
    inset:0;
    z-index:${OVERLAY_Z_INDEX};
    background:rgba(0,0,0,0.42);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:16px;
    box-sizing:border-box;
    font-family:var(--vscode-font-family),system-ui,sans-serif;
  `;

  const card = document.createElement('div');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'pg-commit-confirm-title');
  card.style.cssText = `
    width:min(380px, 100%);
    border-radius:6px;
    border:1px solid var(--vscode-widget-border);
    background:var(--vscode-editor-background);
    color:var(--vscode-editor-foreground);
    box-shadow:0 12px 40px rgba(0,0,0,0.35);
    padding:16px 18px;
    display:flex;
    flex-direction:column;
    gap:12px;
  `;

  const title = document.createElement('div');
  title.id = 'pg-commit-confirm-title';
  title.textContent = 'Commit changes to the database?';
  title.style.cssText = 'font-size:14px;font-weight:700;line-height:1.35;';

  const body = document.createElement('div');
  body.style.cssText =
    'font-size:12px;line-height:1.5;color:var(--vscode-descriptionForeground);';
  body.textContent =
    'This will apply your edits and deletions directly to the table. This action is permanent and cannot be undone from this notebook.';

  const cbRow = document.createElement('label');
  cbRow.style.cssText =
    'display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;user-select:none;margin-top:2px;';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.style.cursor = 'pointer';

  const cbText = document.createElement('span');
  cbText.textContent = "Don't ask again";

  cbRow.appendChild(checkbox);
  cbRow.appendChild(cbText);

  const actions = document.createElement('div');
  actions.style.cssText =
    'display:flex;justify-content:flex-end;gap:8px;margin-top:6px;flex-wrap:wrap;';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding:6px 14px;font-size:12px;font-family:inherit;border-radius:4px;
    cursor:pointer;background:var(--vscode-button-secondaryBackground);
    color:var(--vscode-button-secondaryForeground);
    border:1px solid var(--vscode-button-border,var(--vscode-widget-border));
  `;

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = confirmLabel;
  confirmBtn.style.cssText = `
    padding:6px 14px;font-size:12px;font-family:inherit;border-radius:4px;font-weight:600;
    cursor:pointer;
    background:color-mix(in srgb,var(--vscode-terminal-ansiYellow) 18%,var(--vscode-button-background));
    color:var(--vscode-button-foreground);
    border:1px solid color-mix(in srgb,var(--vscode-terminal-ansiYellow) 42%,var(--vscode-panel-border));
  `;

  const tearDown = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      tearDown();
      options.onCancel();
    }
  };

  cancelBtn.onclick = () => {
    tearDown();
    options.onCancel();
  };

  confirmBtn.onclick = () => {
    const dontAsk = checkbox.checked;
    tearDown();
    options.onConfirm(dontAsk);
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      tearDown();
      options.onCancel();
    }
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(cbRow);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  document.addEventListener('keydown', onKey);
  setTimeout(() => confirmBtn.focus(), 0);

  return tearDown;
}

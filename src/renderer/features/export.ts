import {
  RESULT_TOOLBAR_ICON_CLASS,
  RESULT_TOOLBAR_LABEL_CLASS,
} from '../components/ResultToolbarUi';

/** Update label span on toolbar-style buttons (Export footer, etc.). */
export function setExportToolbarButtonLabel(btn: HTMLButtonElement, label: string): void {
  const tx = btn.querySelector(`.${RESULT_TOOLBAR_LABEL_CLASS}`);
  if (tx) tx.textContent = label;
}

/** Prefer above anchor — notebook/output below often stacks over `position:fixed` menus (export footer). */
export const EXPORT_MENU_Z_INDEX = '2147483646';

export type DropdownPlacementPreference = 'above' | 'below';

/**
 * Place a fixed menu relative to its anchor.
 * `above`: default for footer Export — avoids overlapping the next notebook cell below.
 * `below`: use for toolbar controls (e.g. Ask AI) so the menu isn’t clipped by cells above.
 */
export function positionExportDropdown(
  menu: HTMLElement,
  anchor: HTMLElement,
  preference: DropdownPlacementPreference = 'above',
): void {
  menu.style.position = 'fixed';
  menu.style.zIndex = EXPORT_MENU_Z_INDEX;

  const rect = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || menu.getBoundingClientRect().width;
  const mh = menu.offsetHeight || menu.getBoundingClientRect().height;
  const vp = 8;

  let top: number;
  if (preference === 'below') {
    top = rect.bottom + 4;
    if (top + mh > window.innerHeight - vp) {
      const aboveTop = rect.top - mh - 4;
      if (aboveTop >= vp) {
        top = aboveTop;
      } else {
        top = Math.max(vp, Math.min(rect.bottom + 4, window.innerHeight - mh - vp));
      }
    }
  } else {
    top = rect.top - mh - 4;
    if (top < vp) {
      top = rect.bottom + 4;
    }
    const maxTop = window.innerHeight - mh - vp;
    if (top > maxTop) {
      top = Math.max(vp, maxTop);
    }
  }

  let left = rect.left;
  if (left + mw > window.innerWidth - vp) {
    left = window.innerWidth - mw - vp;
  }
  left = Math.max(vp, left);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

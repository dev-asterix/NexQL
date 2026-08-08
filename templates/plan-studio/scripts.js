const vscode = acquireVsCodeApi();
function withQueryState(message) {
  const details = document.querySelector('.rail-query');
  const expanded = details instanceof HTMLDetailsElement ? details.open : true;
  return { ...message, queryExpanded: expanded };
}

document.addEventListener('click', (e) => {
  const el = e.target;
  if (!(el instanceof Element)) return;
  const nodeHeader = el.closest('[data-toggle-node="true"]');
  if (nodeHeader) {
    const node = nodeHeader.closest('.explain-node');
    if (node) {
      node.classList.toggle('collapsed');
    }
    return;
  }
  const localActionEl = el.closest('[data-local-action]');
  if (localActionEl instanceof HTMLElement) {
    const localAction = localActionEl.dataset.localAction;
    if (localAction === 'expandAllNodes') {
      document.querySelectorAll('.explain-node.collapsed').forEach((n) => n.classList.remove('collapsed'));
    } else if (localAction === 'collapseAllNodes') {
      document.querySelectorAll('.explain-node').forEach((n) => {
        if (n.querySelector('.explain-children')) {
          n.classList.add('collapsed');
        }
      });
    }
    return;
  }
  const target = el.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  const tab = target.dataset.tab;
  const analyze = target.dataset.analyze === 'true';
  if (action === 'rerun') vscode.postMessage(withQueryState({ type: 'rerun', withAnalyze: analyze }));
  else if (action === 'switchTab') vscode.postMessage(withQueryState({ type: 'switchTab', tab }));
  else if (action === 'selectPlan') vscode.postMessage(withQueryState({ type: 'selectPlan', id }));
  else if (action === 'setCompare') vscode.postMessage(withQueryState({ type: 'setCompare', id }));
  else if (action === 'clearCompare') vscode.postMessage(withQueryState({ type: 'clearCompare' }));
  else if (action === 'pin') vscode.postMessage(withQueryState({ type: 'pin', id }));
  else if (action === 'unpin') vscode.postMessage(withQueryState({ type: 'unpin', id }));
  else if (action === 'deletePlan') vscode.postMessage(withQueryState({ type: 'deletePlan', id }));
  else if (action === 'openSourceCell') vscode.postMessage(withQueryState({ type: 'openSourceCell' }));
  else if (action === 'exportJson') vscode.postMessage(withQueryState({ type: 'exportJson' }));
  else if (action === 'copyQuery') vscode.postMessage(withQueryState({ type: 'copyQuery' }));
});

document.addEventListener('toggle', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  if (!target.classList.contains('rail-query')) return;
  vscode.postMessage({ type: 'setQueryExpanded', expanded: target.open });
});

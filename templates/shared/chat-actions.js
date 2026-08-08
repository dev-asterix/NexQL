/**
 * Shared suggestion-pill renderer for chat and dashboard webviews.
 * Exposes `window.ChatActions`.
 */
(function (global) {
  'use strict';

  function getActionIcon(kind) {
    switch (kind) {
      case 'chart': return '📊';
      case 'notebook': return '📓';
      case 'reveal': return '🔍';
      case 'command': return '⚡';
      case 'ask':
      default: return '💬';
    }
  }

  function dismissBubbleStrip(container, stripId) {
    const id = stripId || 'bubbleStrip';
    if (container && typeof container.querySelector === 'function') {
      const existing = container.querySelector('#' + id);
      if (existing) existing.remove();
      return;
    }
    const existing = document.getElementById(id);
    if (existing) existing.remove();
  }

  function formatNotebookLabel(label, db) {
    if (!db || label.includes('·')) return label;
    return `${label} · ${db}`;
  }

  function isNotebookAllowed(provenanceCtx) {
    if (!provenanceCtx) return false;
    const p = provenanceCtx.provenance;
    return p && p !== 'guess';
  }

  /**
   * @param {Array} actions
   * @param {object} opts
   * @param {HTMLElement} opts.container - messages container
   * @param {string} [opts.stripId]
   * @param {boolean} [opts.append]
   * @param {object} [opts.provenance] - { provenance, database, connectionName }
   * @param {function} opts.onAsk - (action) => void
   * @param {function} opts.onAction - (action, pillEl) => void
   * @param {number} [opts.maxActions]
   */
  function showSuggestionBubbles(actions, opts) {
    opts = opts || {};
    const stripId = opts.stripId || 'bubbleStrip';
    const append = !!opts.append;
    const maxActions = opts.maxActions || 3;
    const container = opts.container || document;

    if (!append) {
      dismissBubbleStrip(container, stripId);
    }
    if (!Array.isArray(actions) || actions.length === 0) return;

    let filtered = actions.slice(0, maxActions);
    if (opts.provenance) {
      filtered = filtered.filter((action) => {
        if (action.kind === 'notebook' && !isNotebookAllowed(opts.provenance)) {
          return false;
        }
        return true;
      });
    }
    if (filtered.length === 0) return;

    const assistantSelector = opts.assistantSelector || '.message.assistant';
    const allMessages = container.querySelectorAll(assistantSelector);
    const lastAssistant = allMessages[allMessages.length - 1];
    if (!lastAssistant) return;

    let pillRow = append ? container.getElementById(stripId) : null;
    if (!pillRow) {
      pillRow = document.createElement('div');
      pillRow.className = 'suggestion-pill-row';
      pillRow.id = stripId;
    }

    const dbLabel = opts.provenance?.database;

    filtered.forEach((action) => {
      if (!action || !action.label) return;
      const pill = document.createElement('button');
      pill.className = 'suggestion-bubble';
      const icon = getActionIcon(action.kind);
      let label = action.label;
      if (action.kind === 'notebook' && dbLabel) {
        label = formatNotebookLabel(label, dbLabel);
      }
      pill.textContent = `${icon} ${label}`;
      pill.title = label;
      pill.onclick = () => {
        if (action.kind === 'ask') {
          if (opts.onAsk) opts.onAsk(action);
        } else if (opts.onAction) {
          opts.onAction(action, pill);
        }
      };
      pillRow.appendChild(pill);
    });

    if (!pillRow.isConnected) {
      lastAssistant.appendChild(pillRow);
    }
  }

  global.ChatActions = {
    getActionIcon,
    dismissBubbleStrip,
    showSuggestionBubbles,
    isNotebookAllowed,
    formatNotebookLabel,
    stripActionsTailForDisplay: function stripActionsTailForDisplay(responseText) {
      if (!responseText) return '';
      const trimmed = responseText.trimEnd();
      const fencedMatch = trimmed.match(/(?:^|\n)```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
      if (fencedMatch) {
        try {
          const parsed = JSON.parse(fencedMatch[1]);
          if (parsed && typeof parsed === 'object' && (Array.isArray(parsed.actions) || Array.isArray(parsed.next_steps))) {
            return trimmed.slice(0, fencedMatch.index).trimEnd();
          }
        } catch (_) { /* fall through */ }
      }
      const rawMatch = trimmed.match(/(?:^|\n)(\{\s*"(?:actions|next_steps)"\s*:[\s\S]*\})\s*$/i);
      if (rawMatch) {
        try {
          const parsed = JSON.parse(rawMatch[1]);
          if (parsed && typeof parsed === 'object' && (Array.isArray(parsed.actions) || Array.isArray(parsed.next_steps))) {
            return trimmed.slice(0, rawMatch.index).trimEnd();
          }
        } catch (_) { /* fall through */ }
      }
      return responseText;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);

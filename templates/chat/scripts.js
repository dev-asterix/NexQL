// DEBUG: Initialization Logger
console.log('[NexQL] Chat script starting...');
window.onerror = function (message, source, lineno, colno, error) {
  console.error('[NexQL] Global Error:', message, error);
  if (typeof vscode !== 'undefined') {
    vscode.postMessage({ type: 'error', error: message });
  }
};
const vscode = acquireVsCodeApi();
console.log('[NexQL] VS Code API acquired');

/** "i" info-circle icon used on the assistant usage row (shared to avoid duplicating the inline SVG). */
const USAGE_INFO_ICON_SVG = '<svg class="usage-info-icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" style="opacity:0.75;"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>';

const messagesContainer = document.getElementById('messagesContainer');
const messagesEnd = document.getElementById('messagesEnd');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const attachBtn = document.getElementById('attachBtn');
const attachMenuWrapper = document.getElementById('attachMenuWrapper');
const attachMenu = document.getElementById('attachMenu');
const attachFileOption = document.getElementById('attachFileOption');
const attachImageOption = document.getElementById('attachImageOption');
const imageFileInput = document.getElementById('imageFileInput');
const chatSessionTitle = document.getElementById('chatSessionTitle');
const chatSessionTitleText = document.getElementById('chatSessionTitleText');
const chatSessionSubtitle = document.getElementById('chatSessionSubtitle');
const chatSessionModelLabel = document.getElementById('chatSessionModelLabel');
const chatContextSep = document.getElementById('chatContextSep');
const chatContextLabel = document.getElementById('chatContextLabel');
const emptyState = document.getElementById('emptyState');
const typingIndicator = document.getElementById('typingIndicator');
const loadingText = document.getElementById('loadingText');
const attachmentsContainer = document.getElementById('attachmentsContainer');
const inputWrapper = document.getElementById('inputWrapper');
const historyOverlay = document.getElementById('historyOverlay');
const historyList = document.getElementById('historyList');
const historySearch = document.getElementById('historySearch');
const mentionPicker = document.getElementById('mentionPicker');
const mentionSearch = document.getElementById('mentionSearch');
const mentionList = document.getElementById('mentionList');
const mentionBtn = document.getElementById('mentionBtn');
const aiModelPicker = document.getElementById('aiModelPicker');
const aiModelTrigger = document.getElementById('aiModelTrigger');
const aiModelTriggerLabel = document.getElementById('aiModelTriggerLabel');
const aiModelMenu = document.getElementById('aiModelMenu');

const CHAT_INPUT_MIN_HEIGHT = 26;
const CHAT_INPUT_MAX_VISIBLE_LINES = 5;
const CHAT_INPUT_USE_FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

let chatInputResizeLimits = null;
let chatInputResizeRaf = null;

let attachedFiles = [];
let loadingInterval = null;
let typingAnimation = null;
let chatHistory = [];
let dbObjects = [];
let selectedMentions = [];
let mentionPickerVisible = false;
let selectedMentionIndex = -1;
let searchDebounceTimer = null;
let currentMessages = [];
let currentModelCatalog = [];
let currentModelSelectionId = '';
let currentModelLabel = 'Loading models…';
let currentSessionTitle = '';
let currentConnectionDisplay = '';
let currentConnectionCtx = {
  connectionId: null,
  connectionName: null,
  database: null,
  provenance: null,
};
let attachMenuVisible = false;
let liveThinkingStartedAt = null;
let liveThinkingSteps = [];
let liveThinkingTicker = null;
let modelCatalogLoading = false;
let modelMenuVisible = false;
let modelSearchInput = null;
let modelSearchValue = '';
let modelHighlightedIndex = -1;
let currentHierarchyPath = {
  connection: null,
  database: null,
  schema: null
};

// Phase B: New state for context bar, retries, and debounced search
let currentContext = {
  connectionName: null,
  database: null
};
let historySearchDebounceTimer = null;

// Phase B: Quick actions and snippets configuration
const QUICK_ACTIONS = [
  { prompt: 'How do I write a JOIN query?', icon: '🔗', title: 'JOINs', desc: 'Query patterns' },
  { prompt: 'Explain CTEs in PostgreSQL', icon: '📋', title: 'CTEs', desc: 'Temp tables' },
  { prompt: 'How to optimize a slow query?', icon: '⚡', title: 'Optimize', desc: 'Performance' },
  { prompt: 'What are window functions?', icon: '📊', title: 'Window Fn', desc: 'Advanced SQL' }
];

const SNIPPETS = [
  { prompt: 'Show me a basic SELECT example', icon: '📝', text: 'SELECT Basics' },
  { prompt: 'How do I filter rows with WHERE?', icon: '🔍', text: 'WHERE Clauses' },
  { prompt: 'Explain GROUP BY and aggregation', icon: '📊', text: 'Aggregations' }
];

/** Full prompt text for quick-start snippet buttons (CSP: no inline handlers in HTML). */
const SNIPPET_PROMPT_BY_KEY = {
  innerJoin:
    'Show me how INNER JOIN works in PostgreSQL with a practical example — join two tables and explain what rows are included vs excluded.',
  withCte:
    'Explain how to write a CTE using WITH cte AS (...) in PostgreSQL. Show a real example and explain when to use a CTE instead of a subquery.',
  rowNumber:
    'How does ROW_NUMBER() work as a window function in PostgreSQL? Show an example that numbers rows within a partition and explain PARTITION BY and ORDER BY.',
  explainAnalyze:
    'How do I use EXPLAIN ANALYZE in PostgreSQL to diagnose a slow query? Show what the output means and what to look for to find performance bottlenecks.',
  onConflict:
    'How does ON CONFLICT work in PostgreSQL for upserts? Show examples of DO NOTHING and DO UPDATE SET, and explain when to use each.',
  jsonbAgg:
    'How does jsonb_agg work in PostgreSQL? Show an example that aggregates rows into a JSON array, and explain how to use it with filters and ordering.'
};

// Hierarchy Navigation
function navigateToRoot() {
  currentHierarchyPath = { connection: null, database: null, schema: null };
  vscode.postMessage({ type: 'getDbHierarchy', path: {} });
  renderBreadcrumbs();
  mentionList.innerHTML = '<div class="mention-picker-loading">Loading connections...</div>';
}

function navigateToConnection(id, name) {
  currentHierarchyPath = {
    connection: { id, name },
    database: null,
    schema: null
  };
  vscode.postMessage({ type: 'getDbHierarchy', path: { connectionId: id } });
  renderBreadcrumbs();
  mentionList.innerHTML = '<div class="mention-picker-loading">Loading databases...</div>';
}

function navigateToDatabase(dbName) {
  if (!currentHierarchyPath.connection) return;
  currentHierarchyPath.database = dbName;
  currentHierarchyPath.schema = null;
  vscode.postMessage({
    type: 'getDbHierarchy',
    path: {
      connectionId: currentHierarchyPath.connection.id,
      database: dbName
    }
  });
  renderBreadcrumbs();
  mentionList.innerHTML = '<div class="mention-picker-loading">Loading schemas...</div>';
}

function navigateToSchema(schemaName) {
  if (!currentHierarchyPath.connection || !currentHierarchyPath.database) return;
  currentHierarchyPath.schema = schemaName;
  vscode.postMessage({
    type: 'getDbHierarchy',
    path: {
      connectionId: currentHierarchyPath.connection.id,
      database: currentHierarchyPath.database,
      schema: schemaName
    }
  });
  renderBreadcrumbs();
  mentionList.innerHTML = '<div class="mention-picker-loading">Loading objects...</div>';
}

function renderBreadcrumbs() {
  const container = document.getElementById('mentionBreadcrumbs');
  if (!container) return;
  // Build breadcrumb elements using DOM APIs to avoid inline handlers and HTML injection
  while (container.firstChild) container.removeChild(container.firstChild);

  const makeSeparator = () => {
    const s = document.createElement('span');
    s.className = 'mention-breadcrumb-separator';
    s.textContent = '/';
    return s;
  };

  const home = document.createElement('div');
  home.className = 'mention-breadcrumb-item';
  home.textContent = 'Home';
  home.addEventListener('click', navigateToRoot);
  container.appendChild(home);

  if (currentHierarchyPath.connection) {
    container.appendChild(makeSeparator());
    const conn = document.createElement('div');
    conn.className = 'mention-breadcrumb-item';
    conn.textContent = currentHierarchyPath.connection.name || '';
    conn.addEventListener('click', () => navigateToConnection(currentHierarchyPath.connection.id, currentHierarchyPath.connection.name));
    container.appendChild(conn);
  }

  if (currentHierarchyPath.database) {
    container.appendChild(makeSeparator());
    const db = document.createElement('div');
    db.className = 'mention-breadcrumb-item';
    db.textContent = currentHierarchyPath.database || '';
    db.addEventListener('click', () => navigateToDatabase(currentHierarchyPath.database));
    container.appendChild(db);
  }

  if (currentHierarchyPath.schema) {
    container.appendChild(makeSeparator());
    const schema = document.createElement('div');
    schema.className = 'mention-breadcrumb-item';
    schema.textContent = currentHierarchyPath.schema || '';
    schema.addEventListener('click', () => navigateToSchema(currentHierarchyPath.schema));
    container.appendChild(schema);
  }
}

function getChatInputResizeLimits() {
  if (!chatInput) {
    return { minHeight: CHAT_INPUT_MIN_HEIGHT, maxHeight: 120 };
  }
  if (!chatInputResizeLimits) {
    const styles = window.getComputedStyle(chatInput);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const paddingBottom = parseFloat(styles.paddingBottom) || 0;
    chatInputResizeLimits = {
      minHeight: CHAT_INPUT_MIN_HEIGHT,
      maxHeight: Math.ceil(lineHeight * CHAT_INPUT_MAX_VISIBLE_LINES + paddingTop + paddingBottom),
    };
  }
  return chatInputResizeLimits;
}

function resizeChatInput() {
  if (!chatInput) {
    return;
  }

  if (resizeChatInputRaf) {
    return;
  }

  resizeChatInputRaf = requestAnimationFrame(() => {
    resizeChatInputRaf = null;
    const limits = getChatInputResizeLimits();

    if (CHAT_INPUT_USE_FIELD_SIZING) {
      chatInput.style.overflowY = chatInput.scrollHeight > limits.maxHeight ? 'auto' : 'hidden';
      return;
    }

    chatInput.style.height = '0px';
    const nextHeight = Math.max(
      limits.minHeight,
      Math.min(chatInput.scrollHeight, limits.maxHeight)
    );
    chatInput.style.height = `${nextHeight}px`;
    chatInput.style.overflowY = chatInput.scrollHeight > limits.maxHeight ? 'auto' : 'hidden';
  });
}

function resetChatInputHeight() {
  chatInputResizeLimits = null;
  if (!chatInput) {
    return;
  }
  chatInput.style.height = '';
  resizeChatInput();
}

function handleContainerClick(index) {
  const obj = dbObjects[index];
  if (obj.type === 'connection') {
    navigateToConnection(obj.connectionId, obj.name);
  } else if (obj.type === 'database') {
    navigateToDatabase(obj.name);
  } else if (obj.type === 'schema') {
    navigateToSchema(obj.name);
  }
}

// History functions
function toggleHistory() {
  historyOverlay.classList.toggle('visible');
  if (historyOverlay.classList.contains('visible')) {
    vscode.postMessage({ type: 'getHistory' });
    historySearch.focus();
  }
}

function closeHistory(event) {
  if (event.target === historyOverlay) {
    historyOverlay.classList.remove('visible');
  }
}

function loadSession(sessionId) {
  vscode.postMessage({ type: 'loadSession', sessionId });
  historyOverlay.classList.remove('visible');
}

let pendingDeleteId = null;

function deleteSession(sessionId, event) {
  console.log('[WebView] deleteSession called with sessionId:', sessionId, 'event:', event);
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  // If already pending for this session, confirm delete
  if (pendingDeleteId === sessionId) {
    console.log('[WebView] Confirmed delete for:', sessionId);
    vscode.postMessage({ type: 'deleteSession', sessionId });
    pendingDeleteId = null;
    return;
  }

  // First click - show confirmation state
  console.log('[WebView] First click, setting pending delete for:', sessionId);
  if (pendingDeleteId) {
    // Reset any other pending delete
    const prevBtn = document.querySelector(`[data-pending-delete="${pendingDeleteId}"]`);
    if (prevBtn) {
      prevBtn.removeAttribute('data-pending-delete');
      prevBtn.classList.remove('confirm-delete');
    }
  }

  pendingDeleteId = sessionId;
  const btn = event.currentTarget || event.target.closest('.history-item-delete');
  if (btn) {
    btn.setAttribute('data-pending-delete', sessionId);
    btn.classList.add('confirm-delete');
  }

  // Auto-reset after 3 seconds
  setTimeout(() => {
    if (pendingDeleteId === sessionId) {
      pendingDeleteId = null;
      if (btn) {
        btn.removeAttribute('data-pending-delete');
        btn.classList.remove('confirm-delete');
      }
    }
  }, 3000);
}

function newChat() {
  vscode.postMessage({ type: 'newChat' });
}

function openAiSettings() {
  vscode.postMessage({ type: 'openAiSettings' });
}

function openIndexPanel() {
  vscode.postMessage({ type: 'openIndexPanel' });
}

/** Insert a node at the end of the transcript (above the fixed composer). */
function appendToMessages(node) {
  if (!messagesContainer || !node) return;
  if (messagesEnd && messagesEnd.parentNode === messagesContainer) {
    messagesContainer.insertBefore(node, messagesEnd);
  } else {
    messagesContainer.appendChild(node);
  }
}

function truncateSessionTitle(text, maxLength = 56) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'New chat';
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.substring(0, maxLength - 1).trimEnd() + '…';
}

function deriveSessionTitleFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  const firstUser = messages.find((msg) => msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim());
  return firstUser ? truncateSessionTitle(firstUser.content) : '';
}

function setChatSessionTitle(title) {
  currentSessionTitle = truncateSessionTitle(title);
  if (chatSessionTitleText) {
    chatSessionTitleText.textContent = currentSessionTitle || 'New chat';
  }
}

function formatConnectionDisplay(connectionName, database) {
  const conn = (connectionName || '').trim();
  const db = (database || '').trim();
  if (conn && db) {
    return `${conn} / ${db}`;
  }
  return conn || db || '';
}

function applyConnectionStampToElement(el, stamp) {
  if (!el || !stamp) return;
  if (stamp.connectionId) el.dataset.connId = stamp.connectionId;
  if (stamp.connectionName) el.dataset.connName = stamp.connectionName;
  if (stamp.database) el.dataset.db = stamp.database;
  if (stamp.provenance) el.dataset.provenance = stamp.provenance;
}

function updateContextLine(connectionName, database, ctx) {
  currentConnectionDisplay = formatConnectionDisplay(connectionName, database);
  if (ctx) {
    currentConnectionCtx = {
      connectionId: ctx.connectionId || null,
      connectionName: ctx.connectionName || connectionName || null,
      database: ctx.database || database || null,
      provenance: ctx.provenance || null,
    };
  }
  syncChatSessionSubtitle();
}

function syncChatSessionSubtitle() {
  if (chatSessionModelLabel) {
    chatSessionModelLabel.textContent = currentModelLabel || 'Smart';
  }
  const showContext = !!currentConnectionDisplay;
  if (chatContextLabel) {
    if (showContext) {
      chatContextLabel.textContent = currentConnectionDisplay;
      chatContextLabel.hidden = false;
      chatContextLabel.title = `Active database context: ${currentConnectionDisplay}`;
    } else {
      chatContextLabel.textContent = '';
      chatContextLabel.hidden = true;
      chatContextLabel.removeAttribute('title');
    }
  }
  if (chatContextSep) {
    chatContextSep.hidden = !showContext;
  }
}

function syncChatSessionHeader(hasMessages) {
  if (!chatSessionTitle || !chatSessionSubtitle) {
    return;
  }

  const hasContext = !!currentConnectionDisplay;
  if (!hasMessages && !hasContext) {
    chatSessionTitle.hidden = true;
    return;
  }

  chatSessionTitle.hidden = false;
  if (!hasMessages) {
    if (chatSessionTitleText) {
      chatSessionTitleText.textContent = 'NexQL Bot';
    }
  } else if (chatSessionTitleText && !currentSessionTitle) {
    chatSessionTitleText.textContent = 'New chat';
  }
  syncChatSessionSubtitle();
}

function setAiModelPickerLabel(label, title) {
  currentModelLabel = label || 'Loading models…';
  if (aiModelTriggerLabel) {
    aiModelTriggerLabel.textContent = currentModelLabel;
  }
  if (aiModelTrigger) {
    aiModelTrigger.title = title || currentModelLabel || 'AI model';
  }
  if (chatSessionTitle && !chatSessionTitle.hidden) {
    syncChatSessionSubtitle();
  }
}

function closeAttachMenu() {
  attachMenuVisible = false;
  if (attachMenuWrapper) {
    attachMenuWrapper.classList.remove('open');
  }
  if (attachBtn) {
    attachBtn.setAttribute('aria-expanded', 'false');
  }
  if (attachMenu) {
    attachMenu.setAttribute('aria-hidden', 'true');
  }
}

function openAttachMenu() {
  if (!attachMenuWrapper || !attachMenu || !attachBtn) {
    return;
  }
  closeAiModelMenu();
  attachMenuVisible = true;
  attachMenuWrapper.classList.add('open');
  attachBtn.setAttribute('aria-expanded', 'true');
  attachMenu.setAttribute('aria-hidden', 'false');
}

function toggleAttachMenu() {
  if (attachMenuVisible) {
    closeAttachMenu();
  } else {
    openAttachMenu();
  }
}

function setComposerControlsDisabled(disabled) {
  if (attachBtn) attachBtn.disabled = disabled;
  if (mentionBtn) mentionBtn.disabled = disabled;
  if (disabled) {
    closeAttachMenu();
  }
}

function closeAiModelMenu() {
  modelMenuVisible = false;
  modelSearchValue = '';
  modelHighlightedIndex = -1;
  if (modelSearchInput) {
    modelSearchInput.value = '';
  }
  if (aiModelMenu) {
    const noResults = aiModelMenu.querySelector('.ai-model-menu-no-results');
    if (noResults) noResults.remove();
    const allGroups = aiModelMenu.querySelectorAll('.ai-model-menu-group');
    allGroups.forEach(g => { g.style.display = ''; });
    const allItems = aiModelMenu.querySelectorAll('.ai-model-menu-item');
    allItems.forEach(i => { i.style.display = ''; i.classList.remove('is-highlighted'); });
  }
  if (aiModelPicker) {
    aiModelPicker.classList.remove('open');
  }
  if (aiModelTrigger) {
    aiModelTrigger.setAttribute('aria-expanded', 'false');
  }
  if (aiModelMenu) {
    aiModelMenu.setAttribute('aria-hidden', 'true');
  }
}

function openAiModelMenu() {
  if (!aiModelPicker || !aiModelMenu || !aiModelTrigger) {
    return;
  }
  closeAttachMenu();
  modelMenuVisible = true;
  modelSearchValue = '';
  modelHighlightedIndex = -1;
  if (modelSearchInput) {
    modelSearchInput.value = '';
  }
  aiModelPicker.classList.add('open');
  aiModelTrigger.setAttribute('aria-expanded', 'true');
  aiModelMenu.setAttribute('aria-hidden', 'false');
  if (modelSearchInput) {
    modelSearchInput.focus();
  }
  modelHighlightedIndex = 0;
  highlightModelItem(modelHighlightedIndex);
}

function toggleAiModelMenu() {
  if (modelMenuVisible) {
    closeAiModelMenu();
  } else {
    openAiModelMenu();
  }
}

function selectAiModel(selectionId) {
  if (!selectionId) {
    return;
  }

  closeAiModelMenu();

  if (selectionId === '__configure__') {
    openAiSettings();
    vscode.postMessage({ type: 'getModelCatalog' });
    return;
  }

  vscode.postMessage({ type: 'switchChatModel', selectionId });
}

// One-line job descriptions for the known NexQL Free tiers (nexql-free:<tier>).
// Other providers don't have a fixed tier set, so they render label-only.
const NEXQL_FREE_TIER_DESCRIPTIONS = {
  smart: 'Fast, everyday queries & explanations',
  engineer: 'Deeper reasoning, multi-step plans',
  architect: 'Schema design, migrations, reviews',
};

function renderAiModelGroup(groupLabel, entries, activeSelectionId) {
  const group = document.createElement('div');
  group.className = 'ai-model-menu-group';

  const heading = document.createElement('div');
  heading.className = 'ai-model-menu-group-title';
  heading.textContent = groupLabel;
  group.appendChild(heading);

  entries.forEach((entry) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ai-model-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', entry.selectionId === activeSelectionId ? 'true' : 'false');
    item.dataset.selectionId = entry.selectionId;
    if (entry.selectionId === activeSelectionId) {
      item.classList.add('is-active');
    }

    const textCol = document.createElement('span');
    textCol.className = 'ai-model-menu-item-text';

    const label = document.createElement('span');
    label.className = 'ai-model-menu-item-label';
    label.textContent = entry.label;
    textCol.appendChild(label);

    const tier = typeof entry.selectionId === 'string' ? entry.selectionId.split(':')[1] : '';
    const description = NEXQL_FREE_TIER_DESCRIPTIONS[tier];
    if (description) {
      const desc = document.createElement('span');
      desc.className = 'ai-model-menu-item-description';
      desc.textContent = description;
      textCol.appendChild(desc);
    }

    item.appendChild(textCol);

    if (entry.selectionId === activeSelectionId) {
      const check = document.createElement('span');
      check.className = 'ai-model-menu-item-check';
      check.textContent = '✓';
      item.appendChild(check);
    }

    item.addEventListener('click', () => selectAiModel(entry.selectionId));
    group.appendChild(item);
  });

  return group;
}

function renderAiModelMenuSkeleton() {
  const group = document.createElement('div');
  group.className = 'ai-model-menu-group ai-model-menu-group--loading';
  group.setAttribute('aria-hidden', 'true');

  const heading = document.createElement('div');
  heading.className = 'ai-model-menu-group-title';
  heading.textContent = 'More providers';
  group.appendChild(heading);

  const widths = ['72%', '58%', '64%'];
  for (const width of widths) {
    const row = document.createElement('div');
    row.className = 'ai-model-menu-skeleton-item';

    const bar = document.createElement('div');
    bar.className = 'skeleton ai-model-menu-skeleton-bar';
    bar.style.width = width;
    row.appendChild(bar);

    group.appendChild(row);
  }

  return group;
}

function renderModelSearchInput() {
  const wrapper = document.createElement('div');
  wrapper.className = 'ai-model-menu-search';

  modelSearchInput = document.createElement('input');
  modelSearchInput.type = 'search';
  modelSearchInput.className = 'ai-model-menu-search-input';
  modelSearchInput.placeholder = 'Search models…';
  modelSearchInput.value = modelSearchValue;
  modelSearchInput.setAttribute('aria-label', 'Search models');
  modelSearchInput.addEventListener('input', () => {
    modelSearchValue = modelSearchInput.value;
    filterModelMenu();
  });
  modelSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const items = getVisibleModelItems();
      if (items.length > 0) {
        modelHighlightedIndex = Math.min(modelHighlightedIndex + 1, items.length - 1);
        highlightModelItem(modelHighlightedIndex);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const items = getVisibleModelItems();
      if (items.length > 0) {
        modelHighlightedIndex = Math.max(modelHighlightedIndex - 1, 0);
        highlightModelItem(modelHighlightedIndex);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectHighlightedModelItem();
      return;
    }
    if (e.key === 'Escape') {
      if (modelSearchValue) {
        modelSearchValue = '';
        modelSearchInput.value = '';
        filterModelMenu();
        e.stopPropagation();
      } else {
        closeAiModelMenu();
      }
    }
  });

  wrapper.appendChild(modelSearchInput);
  return wrapper;
}

function getVisibleModelItems() {
  return Array.from(aiModelMenu.querySelectorAll('.ai-model-menu-group .ai-model-menu-item')).filter(
    i => i.style.display !== 'none' && i.closest('.ai-model-menu-group')?.style.display !== 'none'
  );
}

function highlightModelItem(index) {
  const items = getVisibleModelItems();
  items.forEach((item, i) => {
    if (i === index) {
      item.classList.add('is-highlighted');
    } else {
      item.classList.remove('is-highlighted');
    }
  });
}

function selectHighlightedModelItem() {
  const items = getVisibleModelItems();
  if (modelHighlightedIndex >= 0 && modelHighlightedIndex < items.length) {
    const item = items[modelHighlightedIndex];
    selectAiModel(item.dataset.selectionId);
  }
}

function filterModelMenu() {
  const query = modelSearchValue.toLowerCase().trim();
  const groups = aiModelMenu.querySelectorAll('.ai-model-menu-group');
  let anyVisible = false;

  groups.forEach((group) => {
    const items = group.querySelectorAll('.ai-model-menu-item');
    let groupHasVisible = false;
    items.forEach((item) => {
      const label = item.querySelector('.ai-model-menu-item-label')?.textContent || '';
      const matches = !query || label.toLowerCase().includes(query);
      item.style.display = matches ? '' : 'none';
      if (matches) groupHasVisible = true;
    });
    group.style.display = groupHasVisible ? '' : 'none';
    if (groupHasVisible) anyVisible = true;
  });

  const noResults = aiModelMenu.querySelector('.ai-model-menu-no-results');
  if (!anyVisible && query) {
    if (!noResults) {
      const el = document.createElement('div');
      el.className = 'ai-model-menu-empty ai-model-menu-no-results';
      el.textContent = 'No matching models';
      aiModelMenu.insertBefore(el, aiModelMenu.querySelector('.ai-model-menu-divider'));
    }
    modelHighlightedIndex = -1;
  } else if (noResults) {
    noResults.remove();
  }

  modelHighlightedIndex = anyVisible ? 0 : -1;
  if (modelHighlightedIndex >= 0) {
    const visible = getVisibleModelItems();
    if (modelHighlightedIndex >= visible.length) {
      modelHighlightedIndex = visible.length - 1;
    }
  }
  highlightModelItem(modelHighlightedIndex);
}

function applyModelCatalog(message) {
  if (!aiModelMenu || !Array.isArray(message.catalog)) {
    return;
  }

  const previous = currentModelSelectionId;
  currentModelCatalog = message.catalog.slice();
  currentModelSelectionId = message.activeSelectionId || previous || '';
  modelCatalogLoading = message.catalogLoading === true;

  aiModelMenu.innerHTML = '';

  aiModelMenu.appendChild(renderModelSearchInput());

  const groups = new Map();
  for (const entry of currentModelCatalog) {
    const group = entry.groupLabel || entry.provider;
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group).push(entry);
  }

  if (groups.size === 0 && !modelCatalogLoading) {
    const empty = document.createElement('div');
    empty.className = 'ai-model-menu-empty';
    empty.textContent = 'No models found';
    aiModelMenu.appendChild(empty);
  } else {
    for (const [groupLabel, entries] of groups) {
      aiModelMenu.appendChild(renderAiModelGroup(groupLabel, entries, currentModelSelectionId));
    }
    if (modelCatalogLoading) {
      aiModelMenu.appendChild(renderAiModelMenuSkeleton());
    }
  }

  const divider = document.createElement('div');
  divider.className = 'ai-model-menu-divider';
  aiModelMenu.appendChild(divider);

  const actionGroup = document.createElement('div');
  actionGroup.className = 'ai-model-menu-action';

  const configureOption = document.createElement('button');
  configureOption.type = 'button';
  configureOption.className = 'ai-model-menu-item';
  configureOption.setAttribute('role', 'menuitem');
  configureOption.dataset.selectionId = '__configure__';
  configureOption.addEventListener('click', () => selectAiModel('__configure__'));

  const configureLabel = document.createElement('span');
  configureLabel.className = 'ai-model-menu-item-label';
  configureLabel.textContent = 'Configure AI…';
  configureOption.appendChild(configureLabel);
  actionGroup.appendChild(configureOption);
  aiModelMenu.appendChild(actionGroup);

  if (message.activeModelLabel) {
    setAiModelPickerLabel(message.activeModelLabel, message.activeModelLabel);
  }

  if (!modelMenuVisible) {
    closeAiModelMenu();
  }

  if (modelSearchValue) {
    filterModelMenu();
  }
}

function onAiModelTriggerClick(event) {
  event.stopPropagation();
  toggleAiModelMenu();
}

function onAiModelTriggerKeyDown(event) {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openAiModelMenu();
  } else if (event.key === 'Escape') {
    closeAiModelMenu();
  }
}

function onDocumentClick(event) {
  if (aiModelPicker && modelMenuVisible && !aiModelPicker.contains(event.target)) {
    closeAiModelMenu();
  }
  if (attachMenuWrapper && attachMenuVisible && !attachMenuWrapper.contains(event.target)) {
    closeAttachMenu();
  }
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function renderHistory(sessions) {
  console.log('[WebView] renderHistory called with', sessions?.length, 'sessions');
  chatHistory = sessions;

  const activeSession = Array.isArray(sessions)
    ? sessions.find((session) => session.isActive)
    : null;
  if (activeSession?.title) {
    setChatSessionTitle(activeSession.title);
    syncChatSessionHeader(currentMessages.length > 0);
  }

  filterHistory(historySearch.value);
}

function filterHistory(query) {
  const filtered = query
    ? chatHistory.filter(s => s.title.toLowerCase().includes(query.toLowerCase()))
    : chatHistory;

  if (filtered.length === 0) {
    while (historyList.firstChild) historyList.removeChild(historyList.firstChild);
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = query ? 'No matching chats found' : 'No chat history yet';
    historyList.appendChild(empty);
    return;
  }
  while (historyList.firstChild) historyList.removeChild(historyList.firstChild);

  // Bucket sessions by day using the same day-diff logic as formatDate().
  const now = new Date();
  const buckets = { Today: [], Yesterday: [], Older: [] };
  filtered.forEach(session => {
    const days = Math.floor((now - new Date(session.updatedAt)) / (1000 * 60 * 60 * 24));
    if (days === 0) buckets.Today.push(session);
    else if (days === 1) buckets.Yesterday.push(session);
    else buckets.Older.push(session);
  });

  ['Today', 'Yesterday', 'Older'].forEach(bucketName => {
    const sessions = buckets[bucketName];
    if (sessions.length === 0) return;

    const header = document.createElement('div');
    header.className = 'history-date-group-header';
    header.textContent = bucketName;
    historyList.appendChild(header);

    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'history-item' + (session.isActive ? ' active' : '');
      item.addEventListener('click', () => loadSession(session.id));

      const titleDiv = document.createElement('div');
      titleDiv.className = 'history-item-title';
      titleDiv.textContent = session.title || '';

      const metaDiv = document.createElement('div');
      metaDiv.className = 'history-item-meta';
      const dateSpan = document.createElement('span');
      dateSpan.textContent = '📅 ' + formatDate(session.updatedAt);
      const countSpan = document.createElement('span');
      countSpan.textContent = '💬 ' + (session.messageCount || 0) + ' messages';
      metaDiv.appendChild(dateSpan);
      metaDiv.appendChild(countSpan);

      const delBtn = document.createElement('button');
      delBtn.className = 'history-item-delete';
      delBtn.title = 'Delete chat';
      delBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
          <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
        </svg>`;
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(session.id, e); });

      item.appendChild(titleDiv);
      item.appendChild(metaDiv);
      item.appendChild(delBtn);
      historyList.appendChild(item);
    });
  });
}

// @ Mention functions
function toggleMentionPicker() {
  console.log('[WebView] toggleMentionPicker called, current visible:', mentionPickerVisible);
  mentionPickerVisible = !mentionPickerVisible;
  if (mentionPickerVisible) {
    showMentionPicker();
  } else {
    hideMentionPicker();
  }
}

function showMentionPicker() {
  console.log('[WebView] showMentionPicker called');
  mentionPickerVisible = true;
  mentionPicker.classList.add('visible');
  mentionSearch.value = '';
  mentionSearch.focus();
  // Start at root
  navigateToRoot();
}

function hideMentionPicker() {
  console.log('[WebView] hideMentionPicker called');
  mentionPickerVisible = false;
  mentionPicker.classList.remove('visible');
  selectedMentionIndex = -1;
}

function searchMentions(query) {
  console.log('[WebView] searchMentions:', query);
  if (!query) {
    const path = {};
    if (currentHierarchyPath.connection) {
      path.connectionId = currentHierarchyPath.connection.id;
      if (currentHierarchyPath.database) {
        path.database = currentHierarchyPath.database;
        if (currentHierarchyPath.schema) {
          path.schema = currentHierarchyPath.schema;
        }
      }
    }
    vscode.postMessage({ type: 'getDbHierarchy', path });
    return;
  }
  // Scope the search to the current breadcrumb location so we don't scan every connection.
  const scope = {
    connectionId: currentHierarchyPath.connection ? currentHierarchyPath.connection.id : undefined,
    database: currentHierarchyPath.database || undefined,
    schema: currentHierarchyPath.schema || undefined
  };
  vscode.postMessage({ type: 'searchDbObjects', query: query, scope: scope });
}

function getDbTypeIcon(type) {
  const icons = {
    'table': '📋',
    'view': '👁️',
    'function': '⚙️',
    'materialized-view': '📦',
    'type': '🔤',
    'schema': '📁',
    'database': '🗄️',
    'connection': '🔌',
    'notebook': '📓',
    'saved-query': '💾',
    'notebook-folder': '📓',
    'query-folder': '💾'
  };
  return icons[type] || '📄';
}


function renderHierarchyItems(items) {
  console.log('[WebView] renderHierarchyItems called with', items.length, 'items');
  dbObjects = items;

  if (items.length === 0) {
    while (mentionList.firstChild) mentionList.removeChild(mentionList.firstChild);
    const empty = document.createElement('div');
    empty.className = 'mention-picker-empty';
    empty.textContent = 'No items found.';
    mentionList.appendChild(empty);
    return;
  }

  let html = '';
  // Sort items for display
  items.sort((a, b) => {
    const aContainer = !!a.isContainer;
    const bContainer = !!b.isContainer;

    if (aContainer && !bContainer) return -1;
    if (!aContainer && bContainer) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  // Build DOM elements for each item instead of using innerHTML
  while (mentionList.firstChild) mentionList.removeChild(mentionList.firstChild);

  items.forEach((obj, idx) => {
    const el = document.createElement('div');
    el.className = obj.isContainer ? 'mention-item is-container' : 'mention-item is-leaf';
    el.dataset.index = String(idx);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'mention-item-name';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'db-type-icon';
    iconSpan.textContent = getDbTypeIcon(obj.type);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'mention-item-label';
    const displayName = obj.isContainer ? obj.name : (obj.schema ? obj.schema + '.' + obj.name : obj.name);
    labelSpan.textContent = displayName || '';

    nameDiv.appendChild(iconSpan);
    nameDiv.appendChild(labelSpan);
    el.appendChild(nameDiv);

    if (obj.type !== 'connection') {
      const metaParts = [];
      if (obj.connectionName) metaParts.push(obj.connectionName);
      if (obj.database && obj.type !== 'database') metaParts.push(obj.database);
      if (metaParts.length > 0) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'mention-item-meta';
        metaDiv.textContent = metaParts.join(' • ');
        el.appendChild(metaDiv);
      }
    }

    // Event handlers
    if (obj.isContainer) {
      el.addEventListener('click', () => handleContainerClick(idx));
    } else {
      el.addEventListener('click', () => selectMention(idx));
    }
    el.addEventListener('mouseenter', () => highlightMention(idx));

    mentionList.appendChild(el);
  });
}

function renderDbObjects(objects) {
  console.log('[WebView] renderDbObjects called with', objects.length, 'objects');
  dbObjects = objects;

  if (objects.length === 0) {
    while (mentionList.firstChild) mentionList.removeChild(mentionList.firstChild);
    const empty = document.createElement('div');
    empty.className = 'mention-picker-empty';
    // At Home (no connection selected), object search relies on a built DB index.
    const atHome = !currentHierarchyPath.connection;
    if (atHome) {
      empty.appendChild(document.createTextNode('No matches. Global search needs a built DB index. '));
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'mention-picker-link';
      link.textContent = 'Index a database';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        openIndexPanel();
        hideMentionPicker();
      });
      empty.appendChild(link);
      empty.appendChild(document.createTextNode(' — or open a connection to browse its objects.'));
    } else {
      empty.textContent = 'No matches found. Try a different search term.';
    }
    mentionList.appendChild(empty);
    return;
  }

  selectedMentionIndex = -1;

  // Limit to 20 items for better performance and cleaner display
  const MAX_DISPLAY = 20;
  const displayObjects = objects.slice(0, MAX_DISPLAY);
  const hasMore = objects.length > MAX_DISPLAY;

  // Group by type for cleaner organization
  const grouped = {};
  displayObjects.forEach((obj, originalIdx) => {
    const type = obj.type || 'other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push({ ...obj, originalIdx });
  });

  // Type order and labels
  const typeOrder = ['table', 'view', 'materialized-view', 'function', 'type', 'schema'];
  const typeLabels = {
    'table': 'Tables',
    'view': 'Views',
    'materialized-view': 'Materialized Views',
    'function': 'Functions',
    'type': 'Types',
    'schema': 'Schemas',
    'other': 'Other'
  };

  let globalIdx = 0;

  // Helper to generate item element with metadata
  const renderItem = (obj) => {
    const idx = globalIdx++;
    const itemEl = document.createElement('div');
    itemEl.className = 'mention-item';
    itemEl.dataset.index = String(idx);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'mention-item-name';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'db-type-icon';
    iconSpan.textContent = getDbTypeIcon(obj.type);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'mention-item-label';
    labelSpan.textContent = (obj.schema ? obj.schema + '.' : '') + (obj.name || '');

    nameDiv.appendChild(iconSpan);
    nameDiv.appendChild(labelSpan);
    itemEl.appendChild(nameDiv);

    const metaParts = [];
    if (obj.connectionName) metaParts.push(obj.connectionName);
    if (obj.database) metaParts.push(obj.database);
    if (metaParts.length > 0) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'mention-item-meta';
      metaDiv.textContent = metaParts.join(' • ');
      itemEl.appendChild(metaDiv);
    }

    itemEl.addEventListener('click', () => selectMention(idx));
    itemEl.addEventListener('mouseenter', () => highlightMention(idx));

    return itemEl;
  };

  // Build DOM and append
  while (mentionList.firstChild) mentionList.removeChild(mentionList.firstChild);

  const frag = document.createDocumentFragment();
  // Render in type order
  typeOrder.forEach(type => {
    if (grouped[type] && grouped[type].length > 0) {
      const header = document.createElement('div');
      header.className = 'mention-group-header';
      header.textContent = (typeLabels[type] || type) + ' (' + grouped[type].length + ')';
      frag.appendChild(header);
      grouped[type].forEach(obj => {
        frag.appendChild(renderItem(obj));
      });
    }
  });

  Object.keys(grouped).forEach(type => {
    if (!typeOrder.includes(type) && grouped[type].length > 0) {
      const header = document.createElement('div');
      header.className = 'mention-group-header';
      header.textContent = (typeLabels[type] || type) + ' (' + grouped[type].length + ')';
      frag.appendChild(header);
      grouped[type].forEach(obj => {
        frag.appendChild(renderItem(obj));
      });
    }
  });

  if (hasMore) {
    const more = document.createElement('div');
    more.className = 'mention-picker-more';
    more.textContent = (objects.length - MAX_DISPLAY) + ' more... (refine your search)';
    frag.appendChild(more);
  }

  mentionList.appendChild(frag);

  // Re-map dbObjects to match displayed order
  dbObjects = [];
  typeOrder.forEach(type => {
    if (grouped[type]) {
      grouped[type].forEach(obj => dbObjects.push(obj));
    }
  });
  Object.keys(grouped).forEach(type => {
    if (!typeOrder.includes(type) && grouped[type]) {
      grouped[type].forEach(obj => dbObjects.push(obj));
    }
  });
}

function highlightMention(index) {
  const items = mentionList.querySelectorAll('.mention-item');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === index);
  });
  selectedMentionIndex = index;
}

function selectMention(index) {
  const obj = dbObjects[index];
  if (!obj) return;

  if (obj.isContainer) {
    handleContainerClick(index);
    mentionSearch.value = '';
    mentionSearch.focus();
    return;
  }

  // Notebook and saved-query: delegate to extension for SQL content loading
  if (obj.type === 'notebook' && obj.connectionId && obj.connectionId.startsWith('__nb__')) {
    const uri = obj.connectionId.slice(6); // slice off '__nb__'
    vscode.postMessage({ type: 'attachNotebook', uri, label: obj.name });
    hideMentionPicker();
    chatInput.focus();
    return;
  }
  if (obj.type === 'saved-query' && obj.connectionId && obj.connectionId.startsWith('__sq__')) {
    const queryId = obj.connectionId.slice(6); // slice off '__sq__'
    vscode.postMessage({ type: 'attachSavedQuery', queryId, label: obj.name });
    hideMentionPicker();
    chatInput.focus();
    return;
  }

  // Create mention object
  const mention = {
    name: obj.name,
    type: obj.type,
    schema: obj.schema,
    database: obj.database,
    connectionId: obj.connectionId,
    connectionName: obj.connectionName,
    breadcrumb: obj.breadcrumb
  };

  // Check if already selected
  const exists = selectedMentions.find(m =>
    m.name === mention.name &&
    m.schema === mention.schema &&
    m.database === mention.database
  );

  if (!exists) {
    selectedMentions.push(mention);
    renderMentionChips();

    // Insert @mention in textarea
    const mentionText = '@' + obj.schema + '.' + obj.name;
    const cursorPos = chatInput.selectionStart;
    const textBefore = chatInput.value.substring(0, cursorPos);
    const textAfter = chatInput.value.substring(cursorPos);

    // Check if there's an incomplete @ mention to replace
    const atMatch = textBefore.match(/@[\w.]*$/);
    if (atMatch) {
      chatInput.value = textBefore.substring(0, textBefore.length - atMatch[0].length) + mentionText + ' ' + textAfter;
    } else {
      chatInput.value = textBefore + mentionText + ' ' + textAfter;
    }
  }

  hideMentionPicker();
  chatInput.focus();
}

function removeMention(index) {
  selectedMentions.splice(index, 1);
  renderMentionChips();
}

function renderMentionChips() {
  // Include both files and mentions in the attachments container
  const hasContent = attachedFiles.length > 0 || selectedMentions.length > 0;

  if (!hasContent) {
    attachmentsContainer.classList.remove('has-files');
    attachmentsContainer.classList.remove('has-mentions');
    inputWrapper.classList.remove('has-attachments');
    renderAttachments(); // Just render file chips
    return;
  }

  attachmentsContainer.classList.add('has-files');
  if (selectedMentions.length > 0) {
    attachmentsContainer.classList.add('has-mentions');
  }
  inputWrapper.classList.add('has-attachments');

  // Render file chips first, then mention chips (build DOM to avoid innerHTML injection)
  while (attachmentsContainer.firstChild) attachmentsContainer.removeChild(attachmentsContainer.firstChild);

  attachedFiles.forEach((file, index) => {
    const chip = document.createElement('div');

    if (file.type === 'image' && file.dataUrl) {
      // Images go to the strip, not here — skip
      return;
    }

    chip.className = 'attachment-chip';
    if (file.path) {
      chip.title = 'Click to preview';
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', () => vscode.postMessage({ type: 'previewFile', path: file.path, name: file.name }));
    }
    const iconSpan = document.createElement('span');
    iconSpan.className = 'file-icon';
    iconSpan.textContent = getFileIcon(file.type);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = file.name || '';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove file';
    removeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/></svg>';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeAttachment(index); });
    chip.appendChild(iconSpan);
    chip.appendChild(nameSpan);
    chip.appendChild(removeBtn);
    attachmentsContainer.appendChild(chip);
  });

  renderImageStrip();

  selectedMentions.forEach((mention, index) => {
    const chip = document.createElement('div');
    chip.className = 'mention-chip';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'mention-icon';
    iconSpan.textContent = getDbTypeIcon(mention.type);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'mention-chip-content';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'mention-name';
    const label = (mention.type === 'notebook' || mention.type === 'saved-query')
      ? '@' + mention.name
      : '@' + (mention.schema || '') + '.' + (mention.name || '');
    nameSpan.textContent = label;
    contentDiv.appendChild(nameSpan);

    const metaParts = [];
    if (mention.connectionName) metaParts.push(mention.connectionName);
    if (mention.database) metaParts.push(mention.database);
    if (metaParts.length > 0) {
      const metaSpan = document.createElement('span');
      metaSpan.className = 'mention-chip-meta';
      metaSpan.textContent = metaParts.join(' • ');
      contentDiv.appendChild(metaSpan);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove reference';
    removeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/></svg>';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeMention(index); });

    chip.appendChild(iconSpan);
    chip.appendChild(contentDiv);
    chip.appendChild(removeBtn);
    attachmentsContainer.appendChild(chip);
  });
}

function handleChatInput(event) {
  const value = chatInput.value;
  const cursorPos = chatInput.selectionStart;
  const textUpToCursor = value.substring(0, cursorPos);

  // Check if user just typed @ or is in middle of @mention
  const atMatch = textUpToCursor.match(/@([\w.]*)$/);

  if (atMatch) {
    if (!mentionPickerVisible) {
      showMentionPicker();
    }
    // Debounced search with the text after @
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    const searchQuery = atMatch[1];
    searchDebounceTimer = setTimeout(() => {
      searchMentions(searchQuery);
    }, 250);
  } else if (mentionPickerVisible && !event.inputType?.includes('delete')) {
    // Hide picker if @ context is lost (but not on delete)
    hideMentionPicker();
  }

  resizeChatInput();
}

function handleMentionKeydown(event) {
  if (!mentionPickerVisible) return false;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedMentionIndex = Math.min(selectedMentionIndex + 1, dbObjects.length - 1);
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return true;
  }
  if (event.key === 'Enter' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideMentionPicker();
    return true;
  }
  if (event.key === 'Tab' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return true;
  }
  return false;
}

function scrollMentionIntoView() {
  const selected = mentionList.querySelector('.mention-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Keyboard handler specifically for the search input
function handleMentionSearchKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (selectedMentionIndex < 0) {
      selectedMentionIndex = 0;
    } else {
      selectedMentionIndex = Math.min(selectedMentionIndex + 1, dbObjects.length - 1);
    }
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
    highlightMention(selectedMentionIndex);
    scrollMentionIntoView();
    return;
  }
  if (event.key === 'Enter' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideMentionPicker();
    chatInput.focus();
    return;
  }
  if (event.key === 'Tab' && selectedMentionIndex >= 0) {
    event.preventDefault();
    selectMention(selectedMentionIndex);
    return;
  }
}

function highlightMentionsInText(text) {
  // Escape HTML first, then highlight @mentions
  let html = escapeHtml(text);
  // Match @schema.name or @name patterns
  html = html.replace(/@([\w]+(?:\.[\w]+)?)/g, '<span class="mention-inline">@$1</span>');
  return html;
}

/**
 * Wrap @mentions in markdown-rendered HTML (plain text nodes only; skips pre/code so SQL stays literal).
 */
function highlightMentionsInMarkdownHtml(htmlString) {
  const div = document.createElement('div');
  div.innerHTML = htmlString || '';
  const textNodes = [];
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    textNodes.push(n);
  }
  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (parent && parent.closest('pre, code')) {
      continue;
    }
    const text = textNode.nodeValue || '';
    if (!/@([\w]+(?:\.[\w]+)?)/.test(text)) {
      continue;
    }
    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    text.replace(/@([\w]+(?:\.[\w]+)?)/g, (full, ident, offset) => {
      if (offset > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, offset)));
      }
      const span = document.createElement('span');
      span.className = 'mention-inline';
      span.textContent = '@' + ident;
      frag.appendChild(span);
      lastIdx = offset + full.length;
      return '';
    });
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }
  return div.innerHTML;
}

/** User bubble body: same markdown pipeline as assistant, plus @mention styling outside code blocks. */
function renderUserMessageMarkdownBody(text) {
  return highlightMentionsInMarkdownHtml(parseMarkdown(text));
}

// Quirky loading messages
const quirkyMessages = [
  "🧠 Negotiating with the AI overlords…",
  "🐘 Teaching Postgres new tricks…",
  "💾 Convincing the bits to behave…",
  "🧙‍♂️ Refactoring reality… one spell at a time.",
  "🎮 Buffering your next plot twist…",
  "🍕 Bribing the database with carbs…",
  "🐞 Politely asking bugs to leave… again.",
  "🚨 Deploying controlled chaos…",
  "🤖 Beeping, booping, pretending to work…",
  "🌋 Melting slow queries in hot lava…",
  "🧵 Weaving multi-threaded dreams…",
  "🎯 Aiming for 0ms latency (manifesting hard).",
  "🧊 Freezing the race conditions…",
  "🛸 Abducting your data for analysis…",
  "🌈 Painting graphs with unicorn dust…",
  "🧩 Assembling answers without the manual…",
  "⚔️ Sparring with rogue JOIN statements…",
  "📡 Calling the mothership for wisdom…",
  "🌪️ Spinning up some fresh insights…",
  "🍩 Debugging powered by sugar and despair…"
];

function startLoadingMessages() {
  const textEl = resolveActiveLoadingTextElement(true);
  if (!textEl) {
    return;
  }

  let index = Math.floor(Math.random() * quirkyMessages.length);
  textEl.textContent = quirkyMessages[index];

  loadingInterval = setInterval(() => {
    const activeTextEl = resolveActiveLoadingTextElement(false);
    if (!activeTextEl) {
      return;
    }
    index = (index + 1) % quirkyMessages.length;
    activeTextEl.style.animation = 'none';
    activeTextEl.offsetHeight; // Trigger reflow
    activeTextEl.style.animation = 'fadeInOut 0.3s ease';
    activeTextEl.textContent = quirkyMessages[index];
  }, 2500);
}

function stopLoadingMessages() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
  if (loadingText) {
    loadingText.textContent = '';
  }
  hideInlineTypingIndicator();
}

function attachFile() {
  closeAttachMenu();
  vscode.postMessage({ type: 'pickFile' });
}

function attachImage() {
  closeAttachMenu();
  if (imageFileInput) {
    imageFileInput.click();
  }
}

function handleImageFileInput(event) {
  const file = event.target.files[0];
  if (!file) return;
  readImageFile(file);
  // Reset so same file can be re-selected
  event.target.value = '';
}

function readImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    attachedFiles.push({
      name: file.name,
      content: '',
      type: 'image',
      dataUrl: dataUrl,
      mimeType: file.type
    });
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

function openLightbox(src) {
  const lb = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImg');
  img.src = src;
  lb.style.display = 'flex';
}

function closeLightbox() {
  const lb = document.getElementById('imageLightbox');
  lb.style.display = 'none';
  document.getElementById('lightboxImg').src = '';
}

function removeAttachment(index) {
  attachedFiles.splice(index, 1);
  renderAttachments();
}

function renderImageStrip() {
  const strip = document.getElementById('imagePreviewStrip');
  if (!strip) return;
  strip.innerHTML = '';
  const images = attachedFiles.filter(f => f.type === 'image' && f.dataUrl);
  if (images.length === 0) {
    strip.classList.remove('has-images');
    return;
  }
  strip.classList.add('has-images');
  images.forEach((file) => {
    const realIndex = attachedFiles.indexOf(file);
    const item = document.createElement('div');
    item.className = 'image-strip-item';

    const thumb = document.createElement('img');
    thumb.className = 'image-strip-thumb';
    thumb.src = file.dataUrl;
    thumb.alt = file.name;
    thumb.title = 'Click to preview';
    thumb.addEventListener('click', () => openLightbox(file.dataUrl));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'image-strip-remove';
    removeBtn.title = 'Remove image';
    removeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/></svg>';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeAttachment(realIndex); });

    item.appendChild(thumb);
    item.appendChild(removeBtn);
    strip.appendChild(item);
  });
}

function renderAttachments() {
  attachmentsContainer.innerHTML = '';
  renderImageStrip();

  const nonImages = attachedFiles.filter(f => f.type !== 'image');
  if (nonImages.length === 0) {
    attachmentsContainer.classList.remove('has-files');
    if (attachedFiles.length === 0) {
      inputWrapper.classList.remove('has-attachments');
    }
    return;
  }

  attachmentsContainer.classList.add('has-files');
  inputWrapper.classList.add('has-attachments');

  nonImages.forEach((file) => {
    const realIndex = attachedFiles.indexOf(file);
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    if (file.path) {
      chip.title = 'Click to preview';
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', () => vscode.postMessage({ type: 'previewFile', path: file.path, name: file.name }));
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'file-icon';
    iconSpan.textContent = getFileIcon(file.type);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = file.name || '';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove file';
    removeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/></svg>';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeAttachment(realIndex); });

    chip.appendChild(iconSpan);
    chip.appendChild(nameSpan);
    chip.appendChild(removeBtn);
    attachmentsContainer.appendChild(chip);
  });
}

function getFileIcon(type) {
  const icons = {
    'sql': '📄',
    'json': '📋',
    'csv': '📊',
    'text': '📝',
    'image': '🖼️'
  };
  return icons[type] || '📎';
}

function sendMessage() {
  const message = chatInput.value.trim();
  if (!message && attachedFiles.length === 0 && selectedMentions.length === 0) return;

  // Dismiss error card when sending new message
  dismissError();

  // Dismiss bubble strip when user sends a message
  dismissBubbleStrip();

  if (message && !currentSessionTitle) {
    setChatSessionTitle(message);
  }
  syncChatSessionHeader(true);

  vscode.postMessage({
    type: 'sendMessage',
    message: message || (selectedMentions.length > 0 ? 'Please analyze the referenced database objects' : 'Please analyze the attached file(s)'),
    attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
    mentions: selectedMentions.length > 0 ? [...selectedMentions] : undefined
  });

  chatInput.value = '';
  resizeChatInput();
  chatInput.disabled = true;
  sendBtn.disabled = true;
  setComposerControlsDisabled(true);

  // Clear attachments and mentions after sending
  attachedFiles = [];
  selectedMentions = [];
  renderMentionChips();
}

function sendSuggestion(text) {
  chatInput.value = text;
  resizeChatInput();
  scrollToInputArea('smooth');
  chatInput.focus();
  chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
}

function runSnippet(text) {
  chatInput.value = text;
  resizeChatInput();
  sendMessage();
}

function clearChat() {
  vscode.postMessage({
    type: 'clearChat'
  });
}

function cancelRequest() {
  vscode.postMessage({
    type: 'cancelRequest'
  });
}

function handleKeyDown(event) {
  // Check mention picker navigation first
  if (handleMentionKeydown(event)) {
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// Paste image from clipboard
chatInput.addEventListener('paste', function (e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) readImageFile(file);
      break;
    }
  }
});

// Escape HTML for safe display
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Escape characters for HTML attribute values
function escapeAttribute(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Compact icons for code-block header actions (10×10px, matches 10px label text)
function codeBlockActionIcon(type) {
  const paths = {
    copy: '<path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5z"/>',
    check: '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>',
    notebook: '<path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2h-11zM2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-9z"/><path d="M8 5.5v2H6v1h2v2h1v-2h2v-1H9v-2H8z"/>',
    error: '<path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 2.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 3.5zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>'
  };
  return `<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${paths[type] || ''}</svg>`;
}

function codeBlockCopyButtonHtml() {
  return `${codeBlockActionIcon('copy')}Copy`;
}

function codeBlockNotebookButtonHtml() {
  return `${codeBlockActionIcon('notebook')}Notebook`;
}

// Copy code to clipboard
function copyCode(button, codeId) {
  const codeElement = document.getElementById(codeId);
  if (!codeElement) return;

  // Use data-raw attribute if available (preserves original code without HTML)
  // Otherwise fall back to textContent
  const rawCode = codeElement.getAttribute('data-raw');
  const code = rawCode !== null ? rawCode : (codeElement.textContent || '');

  navigator.clipboard.writeText(code).then(() => {
    button.classList.add('copied');
    button.innerHTML = `${codeBlockActionIcon('check')}Copied!`;
    try {
      vscode.postMessage({ type: 'copyCode' });
    } catch (e) {}
    setTimeout(() => {
      button.classList.remove('copied');
      button.innerHTML = codeBlockCopyButtonHtml();
    }, 2000);
  });
}

// Open SQL code in active notebook
let pendingNotebookButton = null;
let pendingNotebookOriginalHtml = null;

function openInNotebook(button, codeId) {
  const codeElement = document.getElementById(codeId);
  if (!codeElement) return;

  const rawCode = codeElement.getAttribute('data-raw');
  const code = rawCode !== null ? rawCode : (codeElement.textContent || '');

  const messageEl = button.closest('.message');
  const connectionId = messageEl?.dataset?.connId;
  const database = messageEl?.dataset?.db;

  pendingNotebookButton = button;
  pendingNotebookOriginalHtml = button.innerHTML;

  vscode.postMessage({
    type: 'openInNotebook',
    code: code,
    connectionId: connectionId || undefined,
    database: database || undefined,
  });
}

function handleNotebookResult(success, error) {
  if (!pendingNotebookButton) return;

  const button = pendingNotebookButton;
  const originalHtml = pendingNotebookOriginalHtml;

  if (success) {
    button.classList.add('added');
    button.innerHTML = `${codeBlockActionIcon('check')}Added!`;
  } else {
    button.classList.add('error');
    button.innerHTML = `${codeBlockActionIcon('error')}${error || 'Error'}`;
  }

  setTimeout(() => {
    button.classList.remove('added');
    button.classList.remove('error');
    button.innerHTML = originalHtml;
  }, 2000);

  pendingNotebookButton = null;
  pendingNotebookOriginalHtml = null;
}

// Global handler for code-block action buttons (copy, notebook)
document.addEventListener('click', (e) => {
  const copyBtn = e.target.closest && e.target.closest('.copy-btn');
  if (copyBtn) {
    const wrapper = copyBtn.closest('.code-block-wrapper');
    const codeEl = wrapper && wrapper.querySelector('code');
    if (codeEl && codeEl.id) {
      copyCode(copyBtn, codeEl.id);
    }
    return;
  }

  const nbBtn = e.target.closest && e.target.closest('.notebook-btn');
  if (nbBtn) {
    const wrapper = nbBtn.closest('.code-block-wrapper');
    const codeEl = wrapper && wrapper.querySelector('code');
    if (codeEl && codeEl.id) {
      openInNotebook(nbBtn, codeEl.id);
    }
    return;
  }
});

function highlightSql(code) {
  const keywords = ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TABLE', 'INDEX', 'VIEW', 'FUNCTION', 'TRIGGER', 'PROCEDURE', 'CONSTRAINT', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS', 'NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DEFAULT', 'VALUES', 'SET', 'RETURNING', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'GRANT', 'REVOKE'];
  const types = ['INT', 'INTEGER', 'VARCHAR', 'TEXT', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'NUMERIC', 'FLOAT', 'REAL', 'JSON', 'JSONB', 'UUID', 'SERIAL', 'BIGSERIAL'];

  let html = '';
  let rest = code;

  while (rest.length > 0) {
    let match;

    // Comments -- 
    if (match = rest.match(/^(--[^\n]*)/)) {
      html += '<span class="sql-comment">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Block comments /* */
    if (match = rest.match(/^(\/\* [\s\S]*?\*\/)/)) {
      html += '<span class="sql-comment">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Strings
    if (match = rest.match(/^('(?:[^'\\\\]|\\.)*')/)) {
      html += '<span class="sql-string">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Numbers
    if (match = rest.match(/^(\d+\.?\d*)/)) {
      html += '<span class="sql-number">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Keywords & Identifiers
    if (match = rest.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)/)) {
      // Note: added dot . to regex to capture schema.table as one chunk if generic
      // But to color them separately, we should stick to simple identifiers and handle dots as operators
      // Let's revert to simple identifiers and let the dot fall through to punctuation
    }
    if (match = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/)) {
      const word = match[0];
      const upper = word.toUpperCase();
      if (keywords.includes(upper)) {
        html += '<span class="sql-keyword">' + word + '</span>';
      } else if (types.includes(upper)) {
        html += '<span class="sql-type">' + word + '</span>';
      } else {
        // Function check: look ahead for (
        if (/^\s*\(/.test(rest.slice(word.length))) {
          html += '<span class="sql-function">' + word + '</span>';
        } else {
          html += '<span class="sql-identifier">' + word + '</span>';
        }
      }
      rest = rest.slice(word.length);
      continue;
    }

    // HTML entities (skip them or color them)
    if (match = rest.match(/^(&[a-zA-Z]+;)/)) {
      html += match[0];
      rest = rest.slice(match[0].length);
      continue;
    }

    // Operators: +, -, *, /, =, <, >, !, |, %
    if (match = rest.match(/^([+\-\/*=<>!|%]+)/)) {
      html += '<span class="sql-operator">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // Punctuation: , ; ( ) .
    if (match = rest.match(/^([,;().]+)/)) {
      html += '<span class="sql-punctuation">' + match[0] + '</span>';
      rest = rest.slice(match[0].length);
      continue;
    }

    // catch-all
    html += rest[0];
    rest = rest.slice(1);
  }
  return html;
}

// Counter for unique code block IDs
let codeBlockCounter = 0;

/** Provenance context for the message currently being markdown-rendered. */
let _renderProvenance = null;

function notebookProvenanceResolved(ctx) {
  return ctx && ctx.provenance && ctx.provenance !== 'guess';
}

// Initialize marked renderer once
let markedRenderer;

function getMarkedRenderer() {
  if (markedRenderer) return markedRenderer;

  // Check if marked is available
  if (typeof marked === 'undefined') {
    console.error('marked library not loaded');
    return null;
  }

  const renderer = new marked.Renderer();

  // Custom code block renderer
  renderer.code = function ({ text, lang }) {
    const codeId = 'code-block-' + (++codeBlockCounter);
    const language = lang || 'text';
    const displayLang = language === 'text' ? 'CODE' : language.toUpperCase();

    // Securely escape the raw code for the data-raw attribute
    const safeRawCode = escapeAttribute(text);

    // Use highlight.js if available
    let highlightedCode;
    if (typeof hljs !== 'undefined') {
      try {
        if (lang && hljs.getLanguage(lang)) {
          highlightedCode = hljs.highlight(text, { language: lang }).value;
        } else {
          highlightedCode = hljs.highlightAuto(text).value;
        }
      } catch (e) {
        console.error('Highlight.js error:', e);
        highlightedCode = escapeHtml(text);
      }
    } else {
      // Fallback to manual SQL highlighting or simple escape
      if (['sql', 'pgsql', 'postgresql', 'plpgsql'].includes(language.toLowerCase())) {
        let escapedCode = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        highlightedCode = highlightSql(escapedCode);
      } else {
        highlightedCode = escapeHtml(text);
      }
    }

    const isSQL = ['sql', 'pgsql', 'postgresql', 'plpgsql'].includes(language.toLowerCase());
    const prov = _renderProvenance;
    const showNotebook = isSQL && notebookProvenanceResolved(prov);
    const headerLabel = showNotebook && prov?.connectionName && prov?.database
      ? `SQL · ${prov.connectionName} → ${prov.database}`
      : displayLang;

    return `<div class="code-block-wrapper">
            <div class="code-block-header">
              <span class="code-language">${escapeHtml(headerLabel)}</span>
              <div class="code-block-actions">
                ${showNotebook ? `<button type="button" class="notebook-btn" title="Add to active notebook">${codeBlockNotebookButtonHtml()}</button>` : ''}
                <button type="button" class="copy-btn" title="Copy">${codeBlockCopyButtonHtml()}</button>
              </div>
            </div>
            <pre><code id="${codeId}" class="hljs language-${language}" data-raw="${safeRawCode}">${highlightedCode}</code></pre>
          </div>`;
  };

  // Render inline code as proper <code> tags (fixes "(u, o)" meta-notation)
  renderer.codespan = function ({ text }) {
    return `<code class="inline-code">${escapeHtml(text)}</code>`;
  };

  markedRenderer = renderer;
  return markedRenderer;
}

// Basic HTML sanitizer for markdown output
function sanitizeHtml(dirty) {
  if (!dirty) return '';

  // Prefer DOMPurify if available in the webview (very robust)
  if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
    try {
      return DOMPurify.sanitize(dirty);
    } catch (e) {
      console.warn('DOMPurify failed, falling back to simple sanitizer', e);
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(dirty, 'text/html');

  // Allowed tags (keeps markup we use for formatting and highlighting)
  const allowedTags = new Set([
    'a','b','i','em','strong','code','pre','p','br','ul','ol','li',
    'span','div','blockquote','hr','h1','h2','h3','h4','h5','h6',
    'table','thead','tbody','tr','th','td',
    // Keep buttons and simple SVG so action controls remain interactive
    'button','svg','path'
  ]);

  // Allowed attributes per tag ("*" applies to all tags)
  const allowedAttrs = {
    '*': ['class'],
    'a': ['href', 'title', 'rel', 'target', 'class'],
    'img': ['src', 'alt', 'title', 'class'],
    // Preserve data-raw and id on code elements so copy/notebook features work
    'code': ['class', 'data-raw', 'id'],
    'pre': ['class'],
    'button': ['class', 'title', 'type', 'aria-label', 'aria-pressed', 'aria-expanded'],
    'svg': ['viewBox', 'width', 'height', 'fill', 'class', 'aria-hidden'],
    'path': ['d', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width'],
    'span': ['class'],
    'div': ['class'],
    'p': ['class'],
    'table': ['class'],
    'th': ['class'],
    'td': ['class']
  };

  const nodes = Array.from(doc.body.querySelectorAll('*'));
  nodes.forEach(node => {
    const tag = node.nodeName.toLowerCase();

    if (!allowedTags.has(tag)) {
      // Replace disallowed tags with their text content to drop any inner markup
      const textNode = doc.createTextNode(node.textContent);
      node.parentNode.replaceChild(textNode, node);
      return;
    }

    // Sanitize attributes
    const attrs = Array.from(node.attributes);
    attrs.forEach(attr => {
      const name = attr.name.toLowerCase();

      // Remove event handlers and style attributes
      if (name.startsWith('on') || name === 'style') {
        node.removeAttribute(attr.name);
        return;
      }

      // Handle href specially to avoid javascript: URIs
      if (tag === 'a' && name === 'href') {
        const val = (node.getAttribute('href') || '').trim();
        if (/^\s*(javascript|data):/i.test(val)) {
          node.removeAttribute('href');
          return;
        }
        // enforce safer defaults
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('target', '_blank');
        return;
      }

      // Only keep whitelisted attributes for the tag (or global ones)
      const allowedForTag = (allowedAttrs[tag] || []).concat(allowedAttrs['*'] || []);
      if (!allowedForTag.includes(name)) {
        node.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
}

// Markdown parser using marked.js (sanitizes output)
function parseMarkdown(text, provenanceCtx) {
  _renderProvenance = provenanceCtx || null;
  try {
    let parsed = '';
    if (typeof marked !== 'undefined') {
      try {
        const renderer = getMarkedRenderer();
        if (renderer) {
          parsed = marked.parse(text, { renderer: renderer, breaks: true });
          return sanitizeHtml(parsed);
        }
      } catch (e) {
        console.error('Error parsing markdown with marked:', e);
      }
    }

    return sanitizeHtml(text.replace(/\n/g, '<br>'));
  } finally {
    _renderProvenance = null;
  }
}

// Typing effect for assistant messages
function typeText(element, text, callback, provenanceCtx) {
  if (typingAnimation) {
    clearInterval(typingAnimation);
  }

  const parsedHtml = parseMarkdown(text, provenanceCtx);
  let charIndex = 0;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = parsedHtml;
  const plainText = tempDiv.textContent || '';

  // For complex HTML, just set it with a quick fade effect
  if (text.includes('```') || text.includes('**') || text.length > 1000) {
    element.style.opacity = '0';
    element.innerHTML = parsedHtml;
    element.style.transition = 'opacity 0.3s ease';
    requestAnimationFrame(() => {
      element.style.opacity = '1';
    });
    if (callback) setTimeout(callback, 300);
    return;
  }

  // Simple typing effect for shorter, simpler messages
  const cursor = document.createElement('span');
  cursor.className = 'typing-cursor';
  element.innerHTML = '';
  element.appendChild(cursor);

  const speed = Math.max(5, Math.min(20, 1000 / plainText.length)); // Adaptive speed

  typingAnimation = setInterval(() => {
    if (charIndex < plainText.length) {
      cursor.before(plainText[charIndex]);
      charIndex++;
    } else {
      clearInterval(typingAnimation);
      typingAnimation = null;
      cursor.remove();
      // Now apply full formatting
      element.innerHTML = parsedHtml;
      if (callback) callback();
    }
  }, speed);
}

// Handle messages from extension
window.addEventListener('message', event => {
  const message = event.data;

  switch (message.type) {
    case 'renderChart':
      {
        renderInlineChatChart(message.chartSpec);
      }
      break;
    case 'startStream':
      {
        console.log('[WebView] startStream received');
        stopLoadingMessages();
        emptyState.style.display = 'none';
        syncChatSessionHeader(true);
        dismissBubbleStrip();
        syncGlobalTypingVisibility(false);

        const messageDiv = getOrCreateLiveAssistantMessage();
        applyConnectionStampToElement(messageDiv, {
          connectionId: message.connectionId || currentConnectionCtx.connectionId,
          connectionName: message.connectionName || currentConnectionCtx.connectionName,
          database: message.database || currentConnectionCtx.database,
          provenance: message.provenance || currentConnectionCtx.provenance,
        });
        const bubbleDiv = messageDiv.querySelector('.message-bubble');

        let contentDiv = document.getElementById('streaming-content');
        if (!contentDiv && bubbleDiv) {
          contentDiv = document.createElement('div');
          contentDiv.className = 'message-content';
          contentDiv.id = 'streaming-content';
          bubbleDiv.appendChild(contentDiv);
        }

        if (!messageDiv.querySelector('.message-usage-row')) {
          messageDiv.appendChild(buildAssistantFooterRow('', ''));
        }

        messageDiv.scrollIntoView({ block: 'start', behavior: 'smooth' });

        currentMessages.push({ role: 'assistant', content: '' });
        lastMessageCount = currentMessages.length;
      }
      break;
    case 'streamChunk':
      {
        console.log('[WebView] streamChunk received, text length:', message.text?.length, 'accumulated length:', message.accumulated?.length);
        const contentDiv = document.getElementById('streaming-content');
        if (contentDiv) {
          const messageDiv = contentDiv.closest('.message');
          const prov = messageDiv ? {
            provenance: messageDiv.dataset.provenance,
            connectionName: messageDiv.dataset.connName,
            database: messageDiv.dataset.db,
          } : null;
          const displayAccumulated = (window.ChatActions && ChatActions.stripActionsTailForDisplay)
            ? ChatActions.stripActionsTailForDisplay(message.accumulated)
            : message.accumulated;
          contentDiv.innerHTML = parseMarkdown(displayAccumulated, prov);

          const liveThinking = messageDiv?.querySelector('#live-thinking-trace, .thinking-trace--live');
          if (liveThinking && message.accumulated && message.accumulated.trim()) {
            // First token of the answer: collapse the activity card to its one-line summary,
            // Codex/ChatGPT-style. Update via updateActivityShell (not summary.textContent),
            // which would otherwise wipe the status dot along with the label.
            updateActivityShell(liveThinking, {
              active: false,
              meta: formatThinkingSummary(liveThinkingSteps, liveThinkingStartedAt, true),
              open: false,
            });
            liveThinking.classList.remove('thinking-trace--live');
            stopLiveThinkingTicker();
          }
          hideInlineTypingIndicator();

          if (messageDiv) {
            const usageEl = messageDiv.querySelector('.message-usage-row');
            if (usageEl) {
              const newUsageEl = buildAssistantFooterRow('', message.accumulated);
              usageEl.parentNode.replaceChild(newUsageEl, usageEl);
            }
          }

          // Scroll as we receive content
          scrollMessagesToEnd('auto');
        }
      }
      break;
    case 'updateMessages':
      stopLoadingMessages();
      promoteLiveAssistantMessage();
      if (message.sessionTitle) {
        setChatSessionTitle(message.sessionTitle);
      } else if (!currentSessionTitle) {
        const derivedTitle = deriveSessionTitleFromMessages(message.messages);
        if (derivedTitle) {
          setChatSessionTitle(derivedTitle);
        }
      }
      renderMessages(message.messages, true);
      chatInput.disabled = false;
      sendBtn.disabled = false;
      setComposerControlsDisabled(false);
      chatInput.focus();
      break;
    case 'setTyping':
      if (message.isTyping) {
        syncGlobalTypingVisibility(true);
        const hasActivity =
          !!document.getElementById('live-thinking-trace') || liveThinkingSteps.length > 0;
        if (!hasActivity) {
          startLoadingMessages();
        } else {
          stopLoadingMessages();
          hideInlineTypingIndicator();
        }
        scrollMessagesToEnd('auto');
        sendBtn.style.display = 'none';
        stopBtn.style.display = 'flex';
      } else {
        syncGlobalTypingVisibility(false);
        stopLoadingMessages();
        stopBtn.style.display = 'none';
        sendBtn.style.display = 'flex';
      }
      break;
    case 'thinkingStart':
      liveThinkingStartedAt = Date.now();
      renderInlineLiveThinking(message.steps || [], { allowEmpty: true });
      break;
    case 'thinkingUpdate':
      renderInlineLiveThinking(message.steps || []);
      break;
    case 'thinkingEnd':
      finalizeInlineLiveThinking(message.steps || []);
      break;
    case 'confirmWrite':
      renderWriteConfirmCard(message);
      break;
    case 'confirmWriteClosed':
      removeWriteConfirmCard(message.id);
      break;
    case 'fileAttached':
      attachedFiles.push(message.file);
      renderAttachments();
      break;
    case 'attachInvocation':
      // Unified attach path for AssistantGateway invocations (tree @, result grid,
      // EXPLAIN tab, migration generator, index advisor, backup tools, ...). Never
      // writes temp files — attachments carry their content in-memory.
      if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        attachedFiles.push(...message.attachments);
        renderAttachments();
      }
      if (Array.isArray(message.mentions) && message.mentions.length > 0) {
        for (const obj of message.mentions) {
          const mention = {
            name: obj.name,
            type: obj.type,
            schema: obj.schema,
            database: obj.database,
            connectionId: obj.connectionId,
            connectionName: obj.connectionName,
            breadcrumb: obj.breadcrumb,
            schemaInfo: obj.details
          };
          const exists = selectedMentions.find(m =>
            m.name === mention.name && m.schema === mention.schema && m.database === mention.database
          );
          if (!exists) {
            selectedMentions.push(mention);
          }
        }
        renderMentionChips();
      }
      if (typeof message.draftText === 'string' && message.draftText.length > 0) {
        chatInput.value = message.draftText;
        resetChatInputHeight();
      }
      if (message.autoSend) {
        sendMessage();
      } else {
        chatInput.focus();
        chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
      }
      break;
    case 'updateHistory':
      renderHistory(message.sessions);
      break;
    case 'dbHierarchyData':
      if (message.error) {
        while (mentionList.firstChild) mentionList.removeChild(mentionList.firstChild);
        const empty = document.createElement('div');
        empty.className = 'mention-picker-empty';
        empty.textContent = message.error || '';
        mentionList.appendChild(empty);
      } else {
        renderHierarchyItems(message.items);
      }
      break;
    case 'dbObjectsResult':
      console.log('[WebView] Received dbObjectsResult:', message.objects?.length || 0, 'objects');
      if (message.error) {
        while (mentionList.firstChild) mentionList.removeChild(mentionList.firstChild);
        const empty = document.createElement('div');
        empty.className = 'mention-picker-empty';
        empty.textContent = message.error || '';
        mentionList.appendChild(empty);
      } else {
        renderDbObjects(message.objects);
      }
      break;
    case 'addMentionFromTree':
      // Add object to selectedMentions from tree @ button
      if (message.object) {
        const mention = {
          name: message.object.name,
          type: message.object.type,
          schema: message.object.schema,
          database: message.object.database,
          connectionId: message.object.connectionId,
          connectionName: message.object.connectionName,
          breadcrumb: message.object.breadcrumb,
          schemaInfo: message.object.details
        };

        // Check if already selected
        const exists = selectedMentions.find(m =>
          m.name === mention.name &&
          m.schema === mention.schema &&
          m.database === mention.database
        );

        if (!exists) {
          selectedMentions.push(mention);
          renderMentionChips();
        }

        // Always ensure the text reference exists or append it
        const isNonDb = mention.type === 'notebook' || mention.type === 'saved-query';
        const mentionText = isNonDb ? '@' + mention.name : '@' + mention.schema + '.' + mention.name;
        if (!chatInput.value.includes(mentionText)) {
          const prefix = chatInput.value.length > 0 && !chatInput.value.endsWith(' ') ? ' ' : '';
          chatInput.value += prefix + mentionText;
        }

        chatInput.focus();
        // Move cursor to end
        chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
      }
      break;
    case 'schemaError':
      // Show a toast notification about schema fetch error
      showToast('⚠️ Could not fetch schema for ' + message.object + ': ' + message.error, 'warning');
      break;
    case 'updateModelCatalog':
      applyModelCatalog(message);
      break;
    case 'updateModelInfo':
      if (message.modelName) {
        setAiModelPickerLabel(message.modelName, message.modelName);
      }
      break;

    case 'contextUpdate':
      if (message.connectionId && message.database) {
        updateContextLine(message.connectionName || message.connectionId, message.database, message);
      } else {
        updateContextLine('', '', { provenance: 'guess' });
      }
      syncChatSessionHeader(messagesContainer.querySelectorAll('.message').length > 0);
      break;

    case 'notebookResult':
      handleNotebookResult(message.success, message.error);
      break;
    case 'runChatActionResult':
      handleChatActionResult(message.success, message.error);
      break;
    case 'prefillInput':
      // Pre-fill chat input with query from "Chat" button
      if (message.message) {
        chatInput.value = message.message;
        resetChatInputHeight();
        chatInput.focus();
        // Auto-send if it's a query
        if (message.autoSend) {
          sendMessage();
        }
      }
      break;

    case 'error':
      showErrorCard(message.title || 'Error', message.message || 'An error occurred');
      break;

    case 'noConnectionsAvailable':
      showNoConnectionCard();
      break;

    case 'authState':
      updateAuthBanner(!!message.showBanner);
      break;
  }
});

// ==================== Sign-in banner (unsigned nexql-free users) ====================
const authBanner = document.getElementById('authBanner');

function updateAuthBanner(show) {
  if (!authBanner) return;
  authBanner.hidden = !show;
}

document.getElementById('authBannerSignIn')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'signInNexql' });
});
document.getElementById('authBannerProvider')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'openAiSettings' });
});
document.getElementById('authBannerDismiss')?.addEventListener('click', () => {
  updateAuthBanner(false);
  vscode.postMessage({ type: 'dismissAuthBanner' });
});

/** Scroll transcript so newest content sits above the composer (ChatGPT-style when sending). */
function scrollMessagesToEnd(behavior = 'smooth') {
  if (!messagesContainer) return;
  requestAnimationFrame(() => {
    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior });
  });
}

/** Focus composer; scroll transcript only (composer stays fixed at bottom). */
function scrollToInputArea(behavior = 'smooth') {
  scrollMessagesToEnd(behavior);
  requestAnimationFrame(() => {
    if (chatInput && !chatInput.disabled) {
      chatInput.focus({ preventScroll: true });
    }
  });
}

/** Anchor the top of the latest assistant reply under the viewport top so readers start at the beginning. */
function scrollLastAssistantMessageIntoViewStart() {
  const nodes = messagesContainer.querySelectorAll('.message.assistant');
  const last = nodes[nodes.length - 1];
  if (last && last.scrollIntoView) {
    last.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

/** After rendering, scroll based on whose turn ended: assistant → show reply from top; user → composer. */
function applyChatScrollStrategy(messages, options) {
  const opts = options || {};
  if (!messages.length || opts.skip) return;
  requestAnimationFrame(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.role === 'assistant') {
      scrollLastAssistantMessageIntoViewStart();
    } else if (last.role === 'user') {
      scrollToInputArea('smooth');
    }
  });
}

/** Plain copy text for clipboard (markdown source for assistant when available). */
function getPlainCopyTextForMessage(msg, cleanedAssistantContent) {
  if (!msg || !msg.role) return '';
  if (msg.role === 'user') {
    const c = msg.content || '';
    return c.split('\n\n📎')[0].split('\n\n🖼️')[0].trim() || c;
  }
  return cleanedAssistantContent != null ? cleanedAssistantContent : msg.content || '';
}

const MSG_ICON_SVG_COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

const MSG_ICON_SVG_RETRY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>';

function mkMsgIconBtn(title, ariaLabel, svgInner, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'msg-action-btn msg-action-btn--icon';
  b.title = title;
  b.setAttribute('aria-label', ariaLabel);
  b.innerHTML = svgInner;
  b.addEventListener('click', onClick);
  return b;
}

/** Icon-only Copy + Retry for assistant footer (same row as usage). */
function buildAssistantIconActions(plainTextForClipboard) {
  const row = document.createElement('div');
  row.className = 'msg-actions msg-actions--inline';

  row.appendChild(
    mkMsgIconBtn('Copy message text', 'Copy message', MSG_ICON_SVG_COPY, async ev => {
      ev.stopPropagation();
      try {
        await navigator.clipboard.writeText(plainTextForClipboard || '');
        showToast('Copied', 'info');
      } catch (e) {
        console.warn('[NexQL] Copy failed', e);
      }
    }),
  );
  row.appendChild(
    mkMsgIconBtn('Replace the assistant reply without duplicating your message', 'Retry response', MSG_ICON_SVG_RETRY, ev => {
      ev.stopPropagation();
      vscode.postMessage({ type: 'regenerateAssistant' });
    }),
  );

  return row;
}

/** Same icon styling as assistant; resend truncates later turns in-place (extension). */
function buildUserIconActions(plainTextForClipboard, userMessageIndex) {
  const row = document.createElement('div');
  row.className = 'msg-actions msg-actions--inline';

  row.appendChild(
    mkMsgIconBtn('Copy message text', 'Copy message', MSG_ICON_SVG_COPY, async ev => {
      ev.stopPropagation();
      try {
        await navigator.clipboard.writeText(plainTextForClipboard || '');
        showToast('Copied', 'info');
      } catch (e) {
        console.warn('[NexQL] Copy failed', e);
      }
    }),
  );
  row.appendChild(
    mkMsgIconBtn(
      'Resend this message and replace replies after it',
      'Resend message',
      MSG_ICON_SVG_RETRY,
      ev => {
        ev.stopPropagation();
        vscode.postMessage({ type: 'resendUserMessage', userIndex: userMessageIndex });
      },
    ),
  );

  return row;
}

/** Token/time line + icon actions on one row (assistant only). */
function buildAssistantFooterRow(usageText, plainTextForClipboard) {
  const wrap = document.createElement('div');
  wrap.className = 'message-usage-row';

  const usageEl = document.createElement('div');
  usageEl.className = 'message-usage';
  if (usageText) {
    usageEl.title = usageText;
    usageEl.style.cursor = 'help';
    usageEl.innerHTML = USAGE_INFO_ICON_SVG;
  }

  wrap.appendChild(usageEl);
  wrap.appendChild(buildAssistantIconActions(plainTextForClipboard));

  return wrap;
}

/** Foot row under user bubbles: icons aligned with assistant (right). */
function buildUserFooterRow(plainTextForClipboard, userMessageIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'message-usage-row message-usage-row--user';

  const spacer = document.createElement('div');
  spacer.className = 'message-usage message-usage--user-spacer';
  spacer.setAttribute('aria-hidden', 'true');

  wrap.appendChild(spacer);
  wrap.appendChild(buildUserIconActions(plainTextForClipboard, userMessageIndex));

  return wrap;
}

function showToast(text, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = text;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function formatThinkingStepLabel(label) {
  if (!label) return { isTool: false, text: '' };

  const separatorIdx = label.indexOf(' · ');
  if (separatorIdx !== -1) {
    const toolName = label.substring(0, separatorIdx);
    const toolArgs = label.substring(separatorIdx + 3);
    const isJsonOrLong = toolArgs.startsWith('{') || toolArgs.startsWith('[') || toolArgs.length > 40;
    return {
      isTool: true,
      toolName: toolName,
      toolArgs: toolArgs,
      isToolDetail: isJsonOrLong,
      text: humanizeToolName(toolName)
    };
  } else if (label.startsWith('Calling ') && label.endsWith('…')) {
    const toolName = label.substring(8, label.length - 1);
    return {
      isTool: true,
      toolName: toolName,
      toolArgs: '',
      isToolDetail: false,
      text: `Running ${humanizeToolName(toolName)}`
    };
  }

  const lines = label.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    let title = lines[0];
    title = title.replace(/^(#+\s*|\*+\s*|_\s*)/, '').replace(/(\*+|_)$/, '').trim();
    const detail = lines.slice(1).join('\n');
    if (!title) {
      const fallback = detail.split('\n').map((line) => line.trim()).find(Boolean) || 'Reasoning';
      title = fallback.length > 72 ? `${fallback.slice(0, 71)}…` : fallback;
    }
    return {
      isTool: false,
      title: title,
      detail: detail,
      text: title
    };
  }

  return {
    isTool: false,
    title: label,
    detail: '',
    text: label
  };
}

/** Unwrap Cursor/OpenCode MCP tool labels (`mcp · toolName: run_select, …`) into a real tool identity. */
function resolveActivityToolIdentity(label) {
  const info = formatThinkingStepLabel(label);
  if (!info.isTool) {
    return { toolName: '', displayText: info.text, toolArgs: '', info };
  }

  let toolName = info.toolName || '';
  let toolArgs = info.toolArgs || '';
  let displayText = info.text || '';

  if (toolName === 'mcp' && toolArgs) {
    const toolNameMatch = toolArgs.match(/(?:toolName|tool_name):\s*([^,]+)/i);
    if (toolNameMatch) {
      toolName = toolNameMatch[1].trim();
      displayText = humanizeToolName(toolName);
      const sqlMatch = toolArgs.match(/(?:\bsql\b|\bquery\b):\s*(.+)$/i);
      if (sqlMatch) {
        toolArgs = sqlMatch[1].trim();
      } else {
        toolArgs = toolArgs
          .replace(/providerIdentifier:\s*[^,]+,?\s*/gi, '')
          .replace(/toolName:\s*[^,]+,?\s*/gi, '')
          .replace(/tool_name:\s*[^,]+,?\s*/gi, '')
          .replace(/^,\s*|,\s*$/g, '')
          .trim();
      }
    }
  }

  return {
    toolName,
    displayText,
    toolArgs,
    info: { ...info, toolName, toolArgs, text: displayText, isToolDetail: toolArgs.length > 40 || toolArgs.startsWith('{') },
  };
}

function isVerboseResultSummary(text) {
  if (!text) return false;
  const t = String(text).trim();
  return t.startsWith('{') || t.startsWith('[') || t.length > 72;
}

function formatActivityResultText(raw) {
  if (!raw) return '';
  const text = String(raw).trim();
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Short human-readable outcome for activity headers — never dump raw JSON inline. */
function summarizeActivityResultSummary(text) {
  if (!text) return '';
  const t = String(text).trim();
  if (!isVerboseResultSummary(t)) return t;

  try {
    const parsed = JSON.parse(t);
    if (parsed?.status === 'success' && parsed?.value) {
      const content = parsed.value.content;
      if (Array.isArray(content)) {
        const parts = [];
        for (const block of content) {
          if (typeof block === 'string') {
            parts.push(block);
            continue;
          }
          if (!block || typeof block !== 'object') continue;
          if (typeof block.text === 'string') {
            parts.push(block.text);
            continue;
          }
          const nested = block.text;
          if (nested && typeof nested === 'object' && Array.isArray(nested.text)) {
            parts.push(...nested.text.filter((line) => typeof line === 'string'));
          }
        }
        const joined = parts.join('\n').trim();
        if (joined) {
          try {
            const rows = JSON.parse(joined);
            if (Array.isArray(rows)) {
              return `${rows.length} row${rows.length === 1 ? '' : 's'}`;
            }
          } catch (_) {}
          const oneLine = joined.replace(/\s+/g, ' ').trim();
          return oneLine.length > 72 ? `${oneLine.slice(0, 71)}…` : oneLine;
        }
      }
      return 'Completed';
    }
    if (parsed?.status === 'error') {
      const err = typeof parsed.error === 'string' ? parsed.error : 'Failed';
      return `error: ${err}`;
    }
    if (Array.isArray(parsed)) {
      return `${parsed.length} row${parsed.length === 1 ? '' : 's'}`;
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
      return `error: ${parsed.error}`;
    }
  } catch (_) {}

  const oneLine = t.replace(/\s+/g, ' ').trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 71)}…` : oneLine;
}

function humanizeToolName(name) {
  const labels = {
    search_schema: 'Search schema',
    describe_object: 'Inspect database object',
    get_ddl: 'Read object definition',
    run_select: 'Run read-only query',
    execute_sql: 'Run SQL',
    explain_query: 'Analyze query plan',
    analyze_query_plan: 'Analyze query plan',
    index_usage: 'Check index usage',
    table_stats: 'Inspect table statistics',
    db_health_check: 'Run database health check',
    resolve_target: 'Resolve database target',
    switch_connection: 'Switch connection',
    select_connection_context: 'Choose connection',
    list_connections: 'List connections',
    list_databases: 'List databases',
    list_schemas: 'List schemas',
    list_objects: 'List objects',
    get_current_context: 'Read active context',
    render_chart: 'Render chart',
  };
  return labels[name] || String(name || 'database tool').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * One status-icon vocabulary for every activity row, live or persisted. Tool rows get the
 * same circular badge as the finished accordion (spinner while active, ✓/× once resolved) —
 * no more squared `>` terminal glyph. Reasoning rows keep their lighter neutral-dot treatment.
 */
function renderActivityStatusIcon(status, { isTool } = {}) {
  const icon = document.createElement('span');

  if (!isTool) {
    icon.className = 'thinking-step-icon';
    if (status === 'active') {
      icon.innerHTML = '<span class="thinking-spinner"></span>';
    } else if (status === 'error') {
      icon.className = 'thinking-step-icon thinking-bullet-error';
      icon.textContent = '';
    } else {
      icon.innerHTML = '<span class="thinking-bullet-dot"></span>';
    }
    return icon;
  }

  icon.className = 'thinking-step-icon activity-status-icon';
  if (status === 'active') {
    icon.classList.add('is-active');
  } else if (status === 'error') {
    icon.classList.add('activity-status-icon--error');
  } else {
    icon.classList.add('activity-status-icon--done');
  }
  return icon;
}

/**
 * Groups consecutive same-tool steps (e.g. several `run_select` calls inside one agent turn)
 * into a single row with a `×N` badge — stops a repeated tool from stacking N near-identical
 * rows top to bottom. Non-tool rows and non-adjacent repeats of the same tool are left alone.
 */
function groupConsecutiveActivitySteps(steps) {
  const grouped = [];
  for (const step of steps) {
    const identity = resolveActivityToolIdentity(step.label);
    const info = identity.info;
    const prev = grouped[grouped.length - 1];
    if (info.isTool && prev && prev.__group && prev.__group.toolName === identity.toolName) {
      prev.__group.items.push(step);
      prev.__group.count++;
      // Completion-only merges omit `label` — never wipe the args-bearing label from the active push.
      if (step.label) prev.label = step.label;
      prev.status = step.status;
      if (step.resultSummary) prev.resultSummary = step.resultSummary;
      if (step.source) prev.source = step.source;
      continue;
    }
    grouped.push({
      ...step,
      __group: info.isTool ? { toolName: identity.toolName, count: 1, items: [step] } : null,
    });
  }
  return grouped;
}

/** Resolve the visible header text and whether an activity row is worth rendering at all. */
function resolveActivityStepDisplay(step) {
  const identity = resolveActivityToolIdentity(step.label);
  const info = identity.info;
  const group = step.__group;
  const isGrouped = !!group && group.count > 1;
  const isToolRow = info.isTool || step.kind === 'tool' || step.kind === 'mcp';

  let displayText = (identity.displayText || info.text || '').trim();
  if (!displayText && info.detail?.trim()) {
    const previewLine = info.detail.split('\n').map((line) => line.trim()).find(Boolean);
    if (previewLine) {
      displayText = previewLine.length > 72 ? `${previewLine.slice(0, 71)}…` : previewLine;
    }
  }
  if (!displayText && isToolRow) {
    displayText = humanizeToolName(identity.toolName || info.toolName || step.label?.split(' · ')[0] || '');
  }
  if (!displayText && step.kind === 'agent') {
    displayText = 'Agent activity';
  }

  const hasDetail =
    isGrouped ||
    (!isToolRow && !!info.detail?.trim()) ||
    !!step.ragContext ||
    (isToolRow && !!identity.toolArgs) ||
    isVerboseResultSummary(step.resultSummary);

  const renderable =
    isGrouped ||
    !!displayText ||
    !!step.source?.trim() ||
    !!step.resultSummary?.trim() ||
    hasDetail;

  return { info, identity, isToolRow, isGrouped, displayText, hasDetail, renderable };
}

function countRenderableActivitySteps(steps) {
  return groupConsecutiveActivitySteps(steps).filter(
    (step) => resolveActivityStepDisplay(step).renderable
  ).length;
}

function renderThinkingStepRow(step) {
  const { info, identity, isToolRow, isGrouped, displayText, hasDetail, renderable } = resolveActivityStepDisplay(step);
  const group = step.__group;

  if (!renderable) {
    return null;
  }

  const row = document.createElement(hasDetail ? 'details' : 'div');
  row.className = 'activity-row thinking-step thinking-step-' + step.status;
  if (hasDetail) {
    row.className += ' thinking-step-collapsible';
    if (step.status === 'active') {
      row.open = true;
    } else {
      row.open = false;
    }
  }
  row.dataset.stepId = step.id;

  const headerContainer = document.createElement(hasDetail ? 'summary' : 'div');
  headerContainer.className = hasDetail ? 'thinking-step-summary' : 'thinking-step-header-container';

  headerContainer.appendChild(renderActivityStatusIcon(step.status, { isTool: isToolRow }));

  const contentWrap = document.createElement('div');
  contentWrap.className = 'thinking-step-content';

  const headerRow = document.createElement('div');
  headerRow.className = 'thinking-step-header-row';

  const label = document.createElement('span');
  label.className = 'thinking-step-label';
  label.textContent = displayText;
  headerRow.appendChild(label);

  if (isGrouped) {
    const badge = document.createElement('span');
    badge.className = 'activity-count-badge';
    badge.textContent = `×${group.count}`;
    headerRow.appendChild(badge);
  }

  if (step.source) {
    const source = document.createElement('span');
    source.className = 'activity-source';
    source.textContent = step.source;
    headerRow.appendChild(source);
  }

  if (isToolRow && step.resultSummary) {
    const shortSummary = summarizeActivityResultSummary(step.resultSummary);
    if (shortSummary) {
      const result = document.createElement('span');
      result.className = 'activity-result-summary';
      result.textContent = shortSummary;
      headerRow.appendChild(result);
    }
  }

  if (hasDetail) {
    const chevron = document.createElement('span');
    chevron.className = 'thinking-step-chevron';
    chevron.innerHTML = `<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.646 5.646a.5.5 0 0 1 .708 0L8 8.293l2.646-2.647a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 0-.708z"/>
    </svg>`;
    headerRow.appendChild(chevron);
  }

  contentWrap.appendChild(headerRow);
  headerContainer.appendChild(contentWrap);
  row.appendChild(headerContainer);

  if (hasDetail) {
    const detailsContent = document.createElement('div');
    detailsContent.className = 'thinking-step-details-content';

    if (!isToolRow && info.detail) {
      const detailDiv = document.createElement('div');
      detailDiv.className = 'thinking-step-detail';
      detailDiv.innerHTML = parseMarkdown(info.detail);
      detailsContent.appendChild(detailDiv);
    }

    if (isGrouped) {
      group.items.forEach((item, idx) => {
        const itemIdentity = resolveActivityToolIdentity(item.label);
        const itemRow = document.createElement('div');
        itemRow.className = 'activity-group-item';
        const itemHead = document.createElement('div');
        itemHead.className = 'activity-group-item-head';
        const outcome = item.resultSummary ? summarizeActivityResultSummary(item.resultSummary) : '';
        itemHead.textContent = `#${idx + 1}${outcome ? ` · ${outcome}` : ''}`;
        itemRow.appendChild(itemHead);
        if (itemIdentity.toolArgs) {
          const code = document.createElement('code');
          code.className = 'thinking-step-code-pill block-code-pill';
          code.textContent = itemIdentity.toolArgs;
          itemRow.appendChild(code);
        }
        if (item.resultSummary && isVerboseResultSummary(item.resultSummary)) {
          const output = document.createElement('pre');
          output.className = 'activity-tool-output activity-inline-result';
          output.textContent = formatActivityResultText(item.resultSummary);
          itemRow.appendChild(output);
        }
        detailsContent.appendChild(itemRow);
      });
    } else if (isToolRow && identity.toolArgs) {
      const detailDiv = document.createElement('div');
      detailDiv.className = 'thinking-step-detail';
      const codePill = document.createElement('code');
      codePill.className = 'thinking-step-code-pill block-code-pill';
      codePill.textContent = identity.toolArgs;
      detailDiv.appendChild(codePill);
      detailsContent.appendChild(detailDiv);
    }

    if (step.resultSummary && isVerboseResultSummary(step.resultSummary)) {
      const output = document.createElement('pre');
      output.className = 'activity-tool-output activity-inline-result';
      output.textContent = formatActivityResultText(step.resultSummary);
      detailsContent.appendChild(output);
    }

    if (step.ragContext) {
      const ragInline = buildRagContextCollapsible(step.ragContext);
      if (ragInline) {
        detailsContent.appendChild(ragInline);
      }
    }

    row.appendChild(detailsContent);
  }

  return row;
}

/** Elapsed-time label: sub-10s shows one decimal (matches Codex/ChatGPT-style tickers), else whole seconds. */
function formatElapsedLabel(startedAt) {
  if (!startedAt) return '';
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  return elapsedMs < 10000 ? `${Math.max(0.1, elapsedMs / 1000).toFixed(1)}s` : `${Math.round(elapsedMs / 1000)}s`;
}

/** Drop generic header rows once concrete tool/MCP work is visible. */
function filterGenericActivityTrace(trace) {
  const list = Array.isArray(trace) ? trace : [];
  const hasSpecific = list.some((step) =>
    step.id?.startsWith('tool-') ||
    step.kind === 'tool' ||
    step.kind === 'mcp' ||
    (step.kind === 'agent' && step.id?.startsWith('context-'))
  );
  if (!hasSpecific) {
    return list;
  }
  return list.filter((step) => step.id !== 'ai' && step.id !== 'agent');
}

/** Prefer an active tool/MCP row over generic "Generating response" for the header ticker. */
function pickActiveStepForSummary(steps) {
  const active = steps.filter((step) => step.status === 'active');
  const meaningful = active.filter((step) => {
    if (step.kind === 'tool' || step.kind === 'mcp') return true;
    if (step.id?.startsWith('tool-')) return true;
    if (step.kind === 'agent' && step.id?.startsWith('context-')) return true;
    if (step.id === 'ai' || step.id === 'agent') return false;
    return !!step.label?.trim();
  });
  if (meaningful.length > 0) {
    return meaningful[meaningful.length - 1];
  }
  return active[active.length - 1];
}

/** Single source of truth for the activity card's header meta text, live and finalized. */
function formatThinkingSummary(steps, startedAt, forceDone) {
  const list = Array.isArray(steps) ? steps : [];
  const hasActive = !forceDone && list.some((step) => step.status === 'active');
  const elapsedLabel = formatElapsedLabel(startedAt);

  if (hasActive) {
    const running = pickActiveStepForSummary(list);
    const info = running ? formatThinkingStepLabel(running.label) : null;
    const activity = info && info.isTool ? `Running ${info.text}…` : running?.label?.trim() || 'Thinking…';
    return elapsedLabel ? `${activity} ${elapsedLabel}` : activity;
  }

  const completedCount = countRenderableActivitySteps(
    list.filter((step) => step.status !== 'active')
  );
  if (forceDone) {
    return elapsedLabel
      ? `${completedCount} step${completedCount === 1 ? '' : 's'} · ${elapsedLabel}`
      : `${completedCount} step${completedCount === 1 ? '' : 's'} completed`;
  }
  return elapsedLabel ? `Thinking… ${elapsedLabel}` : 'Thinking…';
}

function getOrCreateLiveAssistantMessage() {
  let messageDiv = document.getElementById('live-assistant-message');
  if (messageDiv) {
    return messageDiv;
  }

  messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.id = 'live-assistant-message';

  const roleDiv = document.createElement('div');
  roleDiv.className = 'message-role';
  roleDiv.textContent = 'NexQL';

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'message-bubble';

  messageDiv.appendChild(roleDiv);
  messageDiv.appendChild(bubbleDiv);
  appendToMessages(messageDiv);
  return messageDiv;
}

function getLiveAssistantBubble() {
  const messageDiv = getOrCreateLiveAssistantMessage();
  return messageDiv.querySelector('.message-bubble');
}

/**
 * Renders the confirm card for an `execute_sql` write request: SQL, risk badge, impact
 * preview, Approve/Reject. Sent by ChatViewProvider._confirmWriteViaWebview; the response
 * is posted back as `confirmWriteResponse` and resolves the tool call on the extension side.
 */
function renderWriteConfirmCard(message) {
  hideInlineTypingIndicator();

  // A write is a deliberate execution gate, not another assistant sentence.
  // Keeping it as a dedicated transcript item makes the target and the decision
  // unambiguous without changing the existing approve/reject round-trip.
  let gate = document.getElementById(`write-confirm-message-${message.id}`);
  if (gate) gate.remove();
  gate = document.createElement('div');
  gate.className = 'message execution-gate';
  gate.id = `write-confirm-message-${message.id}`;

  const gateLabel = document.createElement('div');
  gateLabel.className = 'message-role';
  gateLabel.textContent = 'Approval required';
  gate.appendChild(gateLabel);

  const card = document.createElement('div');
  card.className = 'write-confirm-card';
  card.id = `write-confirm-${message.id}`;
  card.dataset.confirmId = message.id;

  const badge = document.createElement('span');
  badge.className = `write-confirm-badge write-confirm-badge--${message.classification || 'dml'}`;
  badge.textContent = (message.classification || 'dml').toUpperCase();

  const reasonEl = document.createElement('div');
  reasonEl.className = 'write-confirm-reason';
  reasonEl.textContent = message.reason || 'The assistant wants to run a write query.';

  const sqlEl = document.createElement('pre');
  sqlEl.className = 'write-confirm-sql';
  const codeEl = document.createElement('code');
  codeEl.textContent = message.sql || '';
  sqlEl.appendChild(codeEl);

  const impactEl = document.createElement('div');
  impactEl.className = 'write-confirm-impact';
  impactEl.textContent = message.impact ? `Impact: ${message.impact}` : '';

  const scopeParts = [
    message.environment ? String(message.environment).toUpperCase() : '',
    message.connectionName || '',
    message.database || '',
    message.readOnlyMode ? 'read-only policy' : '',
  ].filter(Boolean);
  const scopeEl = document.createElement('div');
  scopeEl.className = 'write-confirm-scope';
  scopeEl.textContent = scopeParts.join(' · ');

  const actions = document.createElement('div');
  actions.className = 'write-confirm-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'write-confirm-btn write-confirm-approve';
  approveBtn.textContent = 'Approve & Run';
  approveBtn.addEventListener('click', () => resolveWriteConfirm(message.id, true));

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'write-confirm-btn write-confirm-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', () => resolveWriteConfirm(message.id, false));

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);

  const header = document.createElement('div');
  header.className = 'write-confirm-header';
  header.appendChild(badge);
  header.appendChild(reasonEl);

  card.appendChild(header);
  if (scopeParts.length > 0) card.appendChild(scopeEl);
  card.appendChild(sqlEl);
  if (message.impact) {
    card.appendChild(impactEl);
  }
  card.appendChild(actions);

  gate.appendChild(card);
  appendToMessages(gate);
  gate.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function resolveWriteConfirm(id, approved) {
  const card = document.getElementById(`write-confirm-${id}`);
  if (card) {
    card.classList.add(approved ? 'write-confirm-card--approved' : 'write-confirm-card--rejected');
    card.querySelectorAll('.write-confirm-btn').forEach(btn => { btn.disabled = true; });
  }
  vscode.postMessage({ type: 'confirmWriteResponse', id, approved });
}

function removeWriteConfirmCard(id) {
  const card = document.getElementById(`write-confirm-${id}`);
  if (card) {
    card.querySelectorAll('.write-confirm-btn').forEach(btn => { btn.disabled = true; });
    card.classList.add('write-confirm-card--rejected');
  }
}

function syncGlobalTypingVisibility(isTyping) {
  if (!typingIndicator) {
    return;
  }
  const hasLiveAssistant = !!document.getElementById('live-assistant-message');
  if (isTyping && hasLiveAssistant) {
    typingIndicator.classList.remove('visible');
    showInlineTypingIndicator();
    return;
  }
  hideInlineTypingIndicator();
  if (isTyping) {
    typingIndicator.classList.add('visible');
  } else {
    typingIndicator.classList.remove('visible');
  }
}

function ensureInlineTypingIndicator(bubbleDiv) {
  let indicator = bubbleDiv.querySelector('#inline-typing-indicator');
  if (indicator) {
    return indicator;
  }

  indicator = document.createElement('div');
  indicator.className = 'typing-indicator inline-typing-indicator';
  indicator.id = 'inline-typing-indicator';

  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  for (let i = 0; i < 3; i += 1) {
    dots.appendChild(document.createElement('span'));
  }

  const text = document.createElement('div');
  text.className = 'loading-text';
  text.id = 'inlineLoadingText';

  indicator.appendChild(dots);
  indicator.appendChild(text);

  const contentDiv = bubbleDiv.querySelector('#streaming-content');
  const thinkingTrace = bubbleDiv.querySelector('#live-thinking-trace, .thinking-trace');
  if (contentDiv) {
    bubbleDiv.insertBefore(indicator, contentDiv);
  } else if (thinkingTrace) {
    thinkingTrace.insertAdjacentElement('afterend', indicator);
  } else {
    bubbleDiv.appendChild(indicator);
  }

  return indicator;
}

function showInlineTypingIndicator() {
  const bubbleDiv = getLiveAssistantBubble();
  if (!bubbleDiv) {
    return null;
  }

  const hasStreamedContent = bubbleDiv.querySelector('#streaming-content')?.textContent?.trim();
  if (hasStreamedContent) {
    return null;
  }

  const indicator = ensureInlineTypingIndicator(bubbleDiv);
  indicator.classList.add('visible');
  return indicator.querySelector('#inlineLoadingText');
}

function hideInlineTypingIndicator() {
  const indicator = document.getElementById('inline-typing-indicator');
  if (indicator) {
    indicator.classList.remove('visible');
    indicator.remove();
  }
}

function resolveActiveLoadingTextElement(createInlineIfNeeded) {
  const hasLiveAssistant = !!document.getElementById('live-assistant-message');
  if (hasLiveAssistant) {
    const inlineText = createInlineIfNeeded
      ? showInlineTypingIndicator()
      : document.getElementById('inlineLoadingText');
    if (inlineText) {
      return inlineText;
    }
  }
  return loadingText;
}

/**
 * Builds the same bordered `<details class="activity-stream">` card used for the persisted,
 * post-response accordion (`buildActivityStream`). The live view and the final view share this
 * one shell so a running tool call and its finished record are visually the same card, not a
 * plain trace that later snaps into a different-looking one.
 */
function createActivityShell(active) {
  const container = document.createElement('details');
  container.className = 'activity-stream';
  container.open = !!active;

  const summary = document.createElement('summary');
  summary.className = 'activity-summary';

  summary.appendChild(document.createElement('span')).className = 'activity-summary-status';
  summary.appendChild(document.createElement('span')).className = 'activity-summary-title';
  summary.appendChild(document.createElement('span')).className = 'activity-summary-meta';

  container.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'activity-list';
  container.appendChild(list);

  updateActivityShell(container, { active: !!active, meta: '' });
  return container;
}

/** Updates an activity shell's header in place — never touches `<summary>` directly, which would wipe its children. */
function updateActivityShell(container, { active, meta, open } = {}) {
  const status = container.querySelector(':scope > .activity-summary > .activity-summary-status');
  const title = container.querySelector(':scope > .activity-summary > .activity-summary-title');
  const metaEl = container.querySelector(':scope > .activity-summary > .activity-summary-meta');
  if (status) status.classList.toggle('is-active', !!active);
  if (title) title.textContent = active ? 'Working' : 'Activity';
  if (metaEl) metaEl.textContent = meta || '';
  if (typeof open === 'boolean') container.open = open;
}

/** Re-renders the live activity card's meta text once a second so a long-running single tool call keeps visibly ticking instead of appearing frozen. */
function startLiveThinkingTicker() {
  stopLiveThinkingTicker();
  liveThinkingTicker = setInterval(() => {
    const container = document.getElementById('live-thinking-trace');
    if (!container) {
      stopLiveThinkingTicker();
      return;
    }
    updateActivityShell(container, {
      active: true,
      meta: formatThinkingSummary(liveThinkingSteps, liveThinkingStartedAt, false),
    });
  }, 1000);
}

function stopLiveThinkingTicker() {
  if (liveThinkingTicker) {
    clearInterval(liveThinkingTicker);
    liveThinkingTicker = null;
  }
}

function renderInlineLiveThinking(steps, options = {}) {
  if (Array.isArray(steps) && steps.length > 0) {
    liveThinkingSteps = steps;
  }

  const normalizedSteps = filterGenericActivityTrace(liveThinkingSteps);
  if (normalizedSteps.length === 0 && !options.allowEmpty) {
    return;
  }

  hideInlineTypingIndicator();
  stopLoadingMessages();

  if (!liveThinkingStartedAt) {
    liveThinkingStartedAt = Date.now();
  }

  const bubbleDiv = getLiveAssistantBubble();
  if (!bubbleDiv) {
    return;
  }

  let container = bubbleDiv.querySelector('#live-thinking-trace');
  if (!container) {
    container = createActivityShell(true);
    container.classList.add('thinking-trace--live');
    container.id = 'live-thinking-trace';
    container.querySelector('.activity-list').id = 'live-thinking-trace-content';

    const contentDiv = bubbleDiv.querySelector('#streaming-content');
    if (contentDiv) {
      bubbleDiv.insertBefore(container, contentDiv);
    } else {
      bubbleDiv.prepend(container);
    }

    startLiveThinkingTicker();
  }

  const forceDone = !!options.forceDone;
  updateActivityShell(container, {
    active: !forceDone,
    meta: formatThinkingSummary(normalizedSteps, liveThinkingStartedAt, forceDone),
    open: forceDone ? false : true,
  });

  const content = container.querySelector('#live-thinking-trace-content');
  if (content) {
    content.replaceChildren();
    groupConsecutiveActivitySteps(normalizedSteps).forEach((step) => {
      const row = renderThinkingStepRow(step);
      if (row) content.appendChild(row);
    });
  }

  scrollMessagesToEnd('auto');
}

function finalizeInlineLiveThinking(steps) {
  const resolvedSteps = Array.isArray(steps) && steps.length > 0 ? steps : liveThinkingSteps;
  renderInlineLiveThinking(resolvedSteps, { forceDone: true, allowEmpty: true });
  liveThinkingSteps = [];
  stopLiveThinkingTicker();
}

function promoteLiveAssistantMessage() {
  const messageDiv = document.getElementById('live-assistant-message');
  if (!messageDiv) {
    return;
  }
  hideInlineTypingIndicator();
  stopLiveThinkingTicker();
  messageDiv.removeAttribute('id');
  const thinkingTrace = messageDiv.querySelector('#live-thinking-trace');
  if (thinkingTrace) {
    thinkingTrace.removeAttribute('id');
    thinkingTrace.classList.remove('thinking-trace--live');
    const content = thinkingTrace.querySelector('#live-thinking-trace-content');
    if (content) {
      content.removeAttribute('id');
    }
  }
  liveThinkingStartedAt = null;
}

function summarizeToolResultForActivity(result) {
  const text = String(result || '').trim();
  if (!text) return 'No result returned';
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return `${parsed.length} row${parsed.length === 1 ? '' : 's'} returned`;
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') return `Failed: ${parsed.error}`;
  } catch (_) {}
  const firstLine = text.replace(/\s+/g, ' ');
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}

function createAgentActivityRow(step) {
  const row = document.createElement('details');
  const summaryText = summarizeToolResultForActivity(step.result);
  const failed = summaryText.startsWith('Failed:') || /^error:/i.test(summaryText);
  row.className = `activity-row activity-agent-row${failed ? ' activity-agent-row--error' : ''}`;

  const summary = document.createElement('summary');
  summary.className = 'activity-agent-summary';

  const icon = document.createElement('span');
  icon.className = `activity-status-icon${failed ? ' activity-status-icon--error' : ' activity-status-icon--done'}`;
  summary.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'activity-agent-title';
  title.textContent = humanizeToolName(step.toolCall.name);
  summary.appendChild(title);

  const source = document.createElement('span');
  source.className = 'activity-source';
  source.textContent = step.toolCall.transport === 'mcp'
    ? `MCP${step.toolCall.server ? ` · ${step.toolCall.server}` : ''}`
    : 'Database tool';
  summary.appendChild(source);

  const result = document.createElement('span');
  result.className = 'activity-result-summary';
  result.textContent = summaryText;
  summary.appendChild(result);
  row.appendChild(summary);

  const detail = document.createElement('div');
  detail.className = 'activity-agent-detail';
  const args = document.createElement('code');
  args.className = 'thinking-step-code-pill block-code-pill';
  args.textContent = typeof step.toolCall.arguments === 'object'
    ? JSON.stringify(step.toolCall.arguments, null, 2)
    : String(step.toolCall.arguments || '');
  detail.appendChild(args);

  const output = document.createElement('pre');
  output.className = 'activity-tool-output';
  output.textContent = step.result || 'No result returned';
  detail.appendChild(output);
  row.appendChild(detail);
  return row;
}

/** One inspectable stream for schema retrieval, model work, built-in tools, and MCP calls. */
function buildActivityStream(thinkingTrace, agenticSteps) {
  const trace = Array.isArray(thinkingTrace) ? thinkingTrace : [];
  const steps = Array.isArray(agenticSteps) ? agenticSteps : [];
  if (trace.length === 0 && steps.length === 0) return null;

  // Agentic steps hold the rich arguments and raw results, so avoid repeating their
  // lightweight live-trace counterpart after the final response is persisted.
  const toolIds = new Set(steps.map(step => `tool-${step.toolCall.id}`));
  const visibleTrace = filterGenericActivityTrace(trace.filter(step => !toolIds.has(step.id)));
  const groupedTrace = groupConsecutiveActivitySteps(visibleTrace);
  const renderableTrace = groupedTrace.filter(
    (step) => resolveActivityStepDisplay(step).renderable
  );
  const completed = renderableTrace.filter(step => step.status === 'done').length + steps.length;
  const active = visibleTrace.some(step => step.status === 'active');

  const container = createActivityShell(active);
  updateActivityShell(container, {
    active,
    meta: active
      ? 'Checking your database…'
      : `${completed} check${completed === 1 ? '' : 's'} completed`,
    open: active,
  });

  const list = container.querySelector('.activity-list');
  renderableTrace.forEach(step => {
    const row = renderThinkingStepRow(step);
    if (row) list.appendChild(row);
  });
  steps.forEach(step => list.appendChild(createAgentActivityRow(step)));
  return container;
}

function buildThinkingTraceCollapsible(thinkingTrace) {
  return buildActivityStream(thinkingTrace, []);
}

function buildRagContextCollapsible(ragContext) {
  if (!ragContext) return null;

  const container = document.createElement('div');
  container.className = 'inline-context-block';

  const objectsCount = ragContext.objects ? ragContext.objects.length : 0;
  const header = document.createElement('div');
  header.className = 'inline-context-header';
  header.textContent = `🔍 Retrieved schema context (${objectsCount} table${objectsCount !== 1 ? 's' : ''})`;
  container.appendChild(header);

  if (ragContext.objects && ragContext.objects.length > 0) {
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'inline-context-chips';

    ragContext.objects.forEach(obj => {
      const chip = document.createElement('span');
      chip.className = 'inline-context-chip';
      
      const refSpan = document.createElement('span');
      refSpan.textContent = obj.ref;
      chip.appendChild(refSpan);

      const detailSpan = document.createElement('span');
      detailSpan.className = 'inline-context-chip-detail';
      detailSpan.textContent = `(${obj.detail})`;
      chip.appendChild(detailSpan);

      chipsContainer.appendChild(chip);
    });
    container.appendChild(chipsContainer);
  }

  if (ragContext.joinHints && ragContext.joinHints.length > 0) {
    const joinTitle = document.createElement('div');
    joinTitle.className = 'inline-context-section-title';
    joinTitle.textContent = 'Join Relationships Identified:';
    container.appendChild(joinTitle);

    const joinList = document.createElement('div');
    joinList.className = 'inline-context-joins';
    ragContext.joinHints.forEach(hint => {
      const item = document.createElement('div');
      item.className = 'inline-context-join-item';
      item.textContent = hint;
      joinList.appendChild(item);
    });
    container.appendChild(joinList);
  }

  if (ragContext.tokensUsed) {
    const tokensInfo = document.createElement('div');
    tokensInfo.className = 'inline-context-tokens';
    tokensInfo.textContent = `Context budget tokens: ${ragContext.tokensUsed}`;
    container.appendChild(tokensInfo);
  }

  return container;
}

let lastMessageCount = 0;

function renderMessages(messages, animate = false) {
  console.log('[WebView] renderMessages messages:', messages);
  currentMessages = Array.isArray(messages) ? [...messages] : [];

  if (messages.length === 0) {
    emptyState.style.display = 'flex';
    currentSessionTitle = '';
    liveThinkingStartedAt = null;
    liveThinkingSteps = [];
    stopLiveThinkingTicker();
    syncChatSessionHeader(false);
    const messageElements = messagesContainer.querySelectorAll('.message');
    messageElements.forEach(el => el.remove());
    dismissBubbleStrip();
    lastMessageCount = 0;
    return;
  }

  emptyState.style.display = 'none';
  if (!currentSessionTitle) {
    const derivedTitle = deriveSessionTitleFromMessages(messages);
    if (derivedTitle) {
      setChatSessionTitle(derivedTitle);
    }
  }
  syncChatSessionHeader(true);
  dismissBubbleStrip();

  // Check if this is a new assistant message (for typing effect)
  const isNewAssistantMessage = animate &&
    messages.length > lastMessageCount &&
    messages[messages.length - 1].role === 'assistant';

  lastMessageCount = messages.length;
  let activeSuggestionBubbles = [];
  let skipDefaultEndScroll = false;

  // Clear existing messages (but keep typing indicator)
  const messageElements = messagesContainer.querySelectorAll('.message');
  messageElements.forEach(el => el.remove());

  // Render new messages (insert before typing indicator)
  messages.forEach((msg, idx) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + msg.role;

    const roleDiv = document.createElement('div');
    roleDiv.className = 'message-role';
    roleDiv.textContent = msg.role === 'user' ? 'You' : 'NexQL';

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Render attachments for user messages
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      msg.attachments.forEach(att => {
        if (att.type === 'image' && att.dataUrl) {
          const imgWrap = document.createElement('div');
          imgWrap.className = 'file-preview image-message-preview';
          const img = document.createElement('img');
          img.src = att.dataUrl;
          img.alt = att.name;
          img.title = 'Click to preview';
          img.className = 'image-message-thumb';
          img.addEventListener('click', () => openLightbox(att.dataUrl));
          imgWrap.appendChild(img);
          contentDiv.appendChild(imgWrap);
        } else {
          const filePreview = document.createElement('div');
          filePreview.className = 'file-preview';
          if (att.path) {
            filePreview.style.cursor = 'pointer';
            filePreview.title = 'Click to open in editor';
            filePreview.addEventListener('click', () => vscode.postMessage({ type: 'previewFile', path: att.path, name: att.name }));
          }
          filePreview.innerHTML = `
                    <div class="file-preview-header">
                      <span>${getFileIcon(att.type)}</span>
                      <span>${escapeHtml(att.name)}</span>
                      ${att.path ? '<span style="margin-left:auto;opacity:0.6;font-size:10px;">open ↗</span>' : ''}
                    </div>
                    <div class="file-preview-content">${escapeHtml(att.content.substring(0, 500))}${att.content.length > 500 ? '...' : ''}</div>
                  `;
          contentDiv.appendChild(filePreview);
        }
      });

      // Add the text message after attachments if exists
      const textWithoutAttachments = msg.content.split('\n\n📎')[0].split('\n\n🖼️')[0].trim();
      if (textWithoutAttachments && textWithoutAttachments !== 'Please analyze the attached file(s)') {
        const textWrap = document.createElement('div');
        textWrap.className = 'message-user-text';
        textWrap.innerHTML = renderUserMessageMarkdownBody(textWithoutAttachments);
        contentDiv.appendChild(textWrap);
      }
    } else if (msg.role === 'user') {
      // User message without attachments — markdown + @mentions (same typography as assistant)
      const text = msg.content.split('\n\n📎')[0].trim();
      if (text && text !== 'Please analyze the referenced database objects' && text !== 'Please analyze the attached file(s)') {
        contentDiv.innerHTML = renderUserMessageMarkdownBody(text);
      } else {
        contentDiv.textContent = msg.content;
      }
    } else if (msg.role === 'assistant') {
      if (msg.connectionId) messageDiv.dataset.connId = msg.connectionId;
      if (msg.connectionName) messageDiv.dataset.connName = msg.connectionName;
      if (msg.database) messageDiv.dataset.db = msg.database;
      if (msg.provenance) messageDiv.dataset.provenance = msg.provenance;

      const provCtx = {
        provenance: msg.provenance,
        connectionName: msg.connectionName,
        database: msg.database,
      };

      // Apply typing effect for the newest assistant message
      const isLastMessage = idx === messages.length - 1;
      const cleanContent = msg.content || '';
      const actions = msg.actions || [];

      if (isNewAssistantMessage && isLastMessage) {
        // Will be typed out — anchor assistant turn at top so the reply is read from the start
        const activityStream = buildActivityStream(msg.thinkingTrace, msg.agenticSteps);
        if (activityStream) {
          bubbleDiv.appendChild(activityStream);
        }
        bubbleDiv.appendChild(contentDiv);
        if (msg.chart) {
          renderChartIntoBubble(bubbleDiv, msg.chart);
        }
        messageDiv.appendChild(roleDiv);
        messageDiv.appendChild(bubbleDiv);
        messageDiv.appendChild(buildAssistantFooterRow(msg.usage || '', cleanContent));
        appendToMessages(messageDiv);
        messageDiv.scrollIntoView({ block: 'start', behavior: 'smooth' });
        skipDefaultEndScroll = true;
        typeText(contentDiv, cleanContent, () => {
          const usageEl = messageDiv.querySelector('.message-usage-row .message-usage');
          if (usageEl && msg.usage) {
            usageEl.title = msg.usage;
            usageEl.style.cursor = 'help';
            usageEl.innerHTML = USAGE_INFO_ICON_SVG;
          }
          if (actions.length > 0) {
            showSuggestionBubbles(actions, { provenance: provCtx });
          } else {
            dismissBubbleStrip();
          }
        }, provCtx);
        return; // Skip the normal append below
      } else {
        contentDiv.innerHTML = parseMarkdown(cleanContent, provCtx);
        if (isLastMessage) {
          activeSuggestionBubbles = actions;
        }
      }
    } else {
      contentDiv.textContent = msg.content;
    }

    // One activity stream unifies schema retrieval, thinking, tools, and MCP calls.
    if (msg.role === 'assistant') {
      const activityStream = buildActivityStream(msg.thinkingTrace, msg.agenticSteps);
      if (activityStream) {
        bubbleDiv.appendChild(activityStream);
      }
    }

    // Back-compat: sessions saved before the thinkingTrace UI stored RAG context on
    // the user message. Only fall back to it when the following assistant reply has
    // no thinkingTrace of its own (i.e. it's an old session, not double-rendering).
    if (msg.role === 'user' && msg.ragContext) {
      const nextMsg = messages[idx + 1];
      const hasNewTrace = nextMsg && nextMsg.role === 'assistant' && nextMsg.thinkingTrace && nextMsg.thinkingTrace.length > 0;
      if (!hasNewTrace) {
        const ragCollapsible = buildRagContextCollapsible(msg.ragContext);
        if (ragCollapsible) {
          bubbleDiv.appendChild(ragCollapsible);
        }
      }
    }

    bubbleDiv.appendChild(contentDiv);
    if (msg.role === 'assistant' && msg.chart) {
      renderChartIntoBubble(bubbleDiv, msg.chart);
    }
    messageDiv.appendChild(roleDiv);
    messageDiv.appendChild(bubbleDiv);

    let copyPlain = '';
    if (msg.role === 'user') {
      copyPlain = getPlainCopyTextForMessage(msg);
    } else {
      copyPlain = msg.content || '';
    }
    if (msg.role === 'user') {
      messageDiv.appendChild(buildUserFooterRow(copyPlain, typeof msg._rawIdx === 'number' ? msg._rawIdx : idx));
    }
    if (msg.role === 'assistant') {
      messageDiv.appendChild(buildAssistantFooterRow(msg.usage || '', copyPlain));
    }

    appendToMessages(messageDiv);
  });

  if (!skipDefaultEndScroll) {
    applyChatScrollStrategy(messages);
  }

  if (activeSuggestionBubbles.length > 0) {
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
    showSuggestionBubbles(activeSuggestionBubbles, {
      provenance: lastAssistantMsg ? {
        provenance: lastAssistantMsg.provenance,
        database: lastAssistantMsg.database,
        connectionName: lastAssistantMsg.connectionName,
      } : null,
    });
  } else {
    dismissBubbleStrip();
  }
}

// ============================================================================
// Phase B: Frontend Logic - Context Bar, Bubbles, Errors, and Utilities
// ============================================================================

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

let pendingChatActionButton = null;
let pendingChatActionOriginalText = null;

/** Handles the `runChatActionResult` reply for a clicked suggestion pill. */
function handleChatActionResult(success, error) {
  if (!pendingChatActionButton) return;

  const pill = pendingChatActionButton;
  const originalText = pendingChatActionOriginalText;
  pill.classList.remove('pending');

  if (success) {
    pill.classList.add('done');
    pill.textContent = `✓ ${originalText}`;
  } else {
    pill.classList.add('error');
    pill.title = error || 'Action failed';
    pill.disabled = false;
    setTimeout(() => {
      pill.classList.remove('error');
      pill.textContent = originalText;
    }, 2000);
  }

  pendingChatActionButton = null;
  pendingChatActionOriginalText = null;
}

/**
 * Show suggestion action pills below the last assistant message.
 * @param {Array} actions - Array of ChatAction objects
 * @param {{append?: boolean}} [opts] - `append: true` adds to the existing pill row
 *   instead of dismissing it first — used when a chart's "Open in notebook" pill
 *   arrives after the message's own action pills are already showing, so neither
 *   set evicts the other.
 */
function showSuggestionBubbles(actions, opts) {
  if (window.ChatActions && ChatActions.showSuggestionBubbles) {
    ChatActions.showSuggestionBubbles(actions, {
      container: messagesContainer,
      append: opts && opts.append,
      provenance: opts && opts.provenance,
      maxActions: 3,
      onAsk: (action) => {
        chatInput.value = action.prompt || action.label;
        dismissBubbleStrip();
        scrollToInputArea('smooth');
        chatInput.focus();
      },
      onAction: (action, pill) => {
        pill.classList.add('pending');
        pill.disabled = true;
        pendingChatActionButton = pill;
        pendingChatActionOriginalText = pill.textContent;
        vscode.postMessage({
          type: 'runChatAction',
          action: action,
        });
      },
    });
    return;
  }
  dismissBubbleStrip();
}

/**
 * Dismiss the suggestion bubble strip
 */
function dismissBubbleStrip() {
  if (window.ChatActions && ChatActions.dismissBubbleStrip) {
    ChatActions.dismissBubbleStrip(messagesContainer);
    return;
  }
  const existing = document.getElementById('bubbleStrip');
  if (existing) existing.remove();
}

/**
 * Build the chart canvas and render it into a message bubble. Shared by the
 * live 'renderChart' event and renderMessages() restoring a chart persisted
 * on msg.chart, so a rebuild (e.g. the tool loop continuing) doesn't lose it.
 * @param {HTMLElement} bubbleDiv - The `.message-bubble` to append the chart into
 * @param {object} spec - Chart specification { sql, chartType, xAxis, yAxis, title, rows }
 */
function renderChartIntoBubble(bubbleDiv, spec) {
  if (!bubbleDiv || !spec || !spec.rows || spec.rows.length === 0) return;

  const chartWrap = document.createElement('div');
  chartWrap.className = 'chat-inline-chart-container';

  const canvas = document.createElement('canvas');
  canvas.className = 'chat-inline-chart-canvas';
  chartWrap.appendChild(canvas);

  bubbleDiv.appendChild(chartWrap);

  if (typeof window.renderChatChart === 'function') {
    try {
      window.renderChatChart({
        canvas,
        rows: spec.rows,
        chartType: spec.chartType,
        xAxis: spec.xAxis,
        yAxis: spec.yAxis,
        title: spec.title
      });
    } catch (e) {
      console.error('[ChatView] Failed to render inline chart:', e);
    }
  }
}

/**
 * Render inline chart in the chat view (live path — a chart arriving mid-turn,
 * before the next renderMessages() rebuild picks it up from msg.chart).
 * @param {object} spec - Chart specification { sql, chartType, xAxis, yAxis, title, rows }
 */
function renderInlineChatChart(spec) {
  if (!spec || !spec.rows || spec.rows.length === 0) return;

  const allAssistant = messagesContainer.querySelectorAll('.message.assistant');
  const lastAssistant = allAssistant[allAssistant.length - 1];
  if (!lastAssistant) return;

  const bubbleDiv = lastAssistant.querySelector('.message-bubble');
  renderChartIntoBubble(bubbleDiv, spec);

  if (spec.sql) {
    const lastAssistantMsg = currentMessages.length > 0
      ? [...currentMessages].reverse().find((m) => m.role === 'assistant')
      : null;
    const notebookAllowed = lastAssistantMsg && lastAssistantMsg.provenance && lastAssistantMsg.provenance !== 'guess';
    if (notebookAllowed) {
      const db = lastAssistantMsg.database;
      const label = db ? `Open in notebook · ${db}` : 'Open in notebook';
      showSuggestionBubbles([
        { kind: 'notebook', label, sql: spec.sql }
      ], {
        append: true,
        provenance: {
          provenance: lastAssistantMsg.provenance,
          database: lastAssistantMsg.database,
          connectionName: lastAssistantMsg.connectionName,
        },
      });
    }
  }
}


/**
 * Show error card with message and action buttons.
 * @param {string} title - Card title
 * @param {string} message - Card body message
 * @param {{variant?: 'error'|'info'}} [opts] - 'info' renders a calmer, non-alarming variant
 *   (used for routine states like "no database connected") with a single primary action
 *   ("Connect a database") instead of Retry/Configure.
 */
function showErrorCard(title, message, opts) {
  const variant = (opts && opts.variant) || 'error';
  const errorCard = document.getElementById('errorCard');
  const titleElem = document.getElementById('errorCardTitle');
  const messageElem = document.getElementById('errorCardMessage');
  const retryBtn = document.getElementById('errorRetryBtn');
  const configureBtn = document.getElementById('errorConfigureBtn');
  const dismissBtn = document.getElementById('errorDismissBtn');
  const iconElem = errorCard ? errorCard.querySelector('.error-card-icon') : null;

  if (!errorCard) return;

  if (titleElem) titleElem.textContent = title || 'Error';
  if (messageElem) messageElem.textContent = message || 'An error occurred';
  if (iconElem) iconElem.textContent = variant === 'info' ? '🔌' : '⚠️';

  errorCard.classList.toggle('error-card--info', variant === 'info');

  if (variant === 'info') {
    if (retryBtn) {
      retryBtn.textContent = '🔌 Connect a database';
      retryBtn.title = 'Connect a database';
    }
    if (configureBtn) configureBtn.style.display = 'none';
    if (dismissBtn) dismissBtn.textContent = 'Continue without connection';
  } else {
    if (retryBtn) {
      retryBtn.textContent = '🔄 Retry';
      retryBtn.title = 'Retry the last message';
    }
    if (configureBtn) configureBtn.style.display = '';
    if (dismissBtn) dismissBtn.textContent = '✕ Dismiss';
  }

  errorCard.dataset.variant = variant;
  errorCard.style.display = 'flex';
}

/**
 * Show the calm "no database connected" prompt (info variant of the error card).
 */
function showNoConnectionCard() {
  showErrorCard(
    'No database connected',
    "I can still answer general Postgres/SQL questions — but connect a database to run queries and ground answers in your schema.",
    { variant: 'info' }
  );
}

/**
 * Dismiss the error card
 */
function dismissError() {
  const errorCard = document.getElementById('errorCard');
  if (errorCard) {
    errorCard.style.display = 'none';
  }
}

function retryLastMessage() {
  const errorCard = document.getElementById('errorCard');
  const isInfoVariant = errorCard && errorCard.dataset.variant === 'info';
  dismissError();
  if (isInfoVariant) {
    vscode.postMessage({ type: 'requestAddConnection' });
  } else {
    vscode.postMessage({ type: 'regenerateAssistant' });
  }
}

/**
 * Debounced history search with delay timer
 * @param {string} value - Search query
 * @param {number} delay - Debounce delay in ms (default 300)
 */
function debounceHistorySearch(value, delay = 300) {
  if (historySearchDebounceTimer) {
    clearTimeout(historySearchDebounceTimer);
  }
  
  historySearchDebounceTimer = setTimeout(() => {
    filterHistoryHelper(value);
  }, delay);
}

/**
 * Helper for history filtering (called after debounce)
 * @param {string} searchTerm - Search query
 */
function filterHistoryHelper(searchTerm) {
  const historyItems = document.querySelectorAll('.history-item');
  const normalizedTerm = searchTerm.toLowerCase();
  
  historyItems.forEach(item => {
    const title = item.querySelector('.history-item-title');
    if (!title) return;
    
    const matches = title.textContent.toLowerCase().includes(normalizedTerm);
    item.style.display = matches ? 'block' : 'none';
  });
}

/**
 * Group history sessions by date (Today, Yesterday, This week, Older)
 * @param {array} sessions - Array of ChatSessionSummary
 * @returns {object} Sessions grouped by date category
 */
function groupSessionsByDate(sessions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const groups = {
    today: [],
    yesterday: [],
    thisWeek: [],
    older: []
  };
  
  sessions.forEach(session => {
    const sessionDate = new Date(session.createdAt);
    const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
    
    if (sessionDay.getTime() === today.getTime()) {
      groups.today.push(session);
    } else if (sessionDay.getTime() === yesterday.getTime()) {
      groups.yesterday.push(session);
    } else if (sessionDay.getTime() >= weekAgo.getTime()) {
      groups.thisWeek.push(session);
    } else {
      groups.older.push(session);
    }
  });
  
  return groups;
}

/**
 * Binds UI events in JS (required: CSP `script-src` nonce blocks HTML `onclick` / `oninput` etc.).
 */
function wireChatDomEvents() {
  const historyPanel = document.getElementById('historyPanel');
  if (historyOverlay) {
    historyOverlay.addEventListener('click', closeHistory);
  }
  if (historyPanel) {
    historyPanel.addEventListener('click', (e) => e.stopPropagation());
  }
  document.getElementById('historyCloseBtn')?.addEventListener('click', toggleHistory);
  if (historySearch) {
    historySearch.addEventListener('input', () => filterHistory(historySearch.value));
  }
  document.getElementById('btnChatHistory')?.addEventListener('click', toggleHistory);
  document.getElementById('btnNewChat')?.addEventListener('click', newChat);
  aiModelTrigger?.addEventListener('click', onAiModelTriggerClick);
  aiModelTrigger?.addEventListener('keydown', onAiModelTriggerKeyDown);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAiModelMenu();
      closeAttachMenu();
      closeLightbox();
    }
  });
  vscode.postMessage({ type: 'getModelCatalog' });

  document.querySelectorAll('.quick-card').forEach((btn) => {
    const s = btn.getAttribute('data-suggestion');
    if (s) {
      btn.addEventListener('click', () => sendSuggestion(s));
    }
  });
  document.querySelectorAll('.snippet-btn').forEach((btn) => {
    const key = btn.getAttribute('data-snippet');
    const text = key && SNIPPET_PROMPT_BY_KEY[key];
    if (text) {
      btn.addEventListener('click', () => runSnippet(text));
    }
  });

  document.getElementById('errorRetryBtn')?.addEventListener('click', retryLastMessage);
  document.getElementById('errorConfigureBtn')?.addEventListener('click', openAiSettings);
  document.getElementById('errorDismissBtn')?.addEventListener('click', dismissError);

  if (mentionSearch) {
    mentionSearch.addEventListener('input', () => {
      const value = mentionSearch.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => searchMentions(value), 180);
    });
    mentionSearch.addEventListener('keydown', handleMentionSearchKeydown);
  }

  if (chatInput) {
    chatInput.addEventListener('input', handleChatInput);
    chatInput.addEventListener('keydown', handleKeyDown);
  }

  attachBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleAttachMenu();
  });
  attachFileOption?.addEventListener('click', attachFile);
  attachImageOption?.addEventListener('click', attachImage);
  imageFileInput?.addEventListener('change', handleImageFileInput);
  mentionBtn?.addEventListener('click', toggleMentionPicker);
  sendBtn?.addEventListener('click', sendMessage);
  stopBtn?.addEventListener('click', cancelRequest);

  // Drag-and-drop DB objects from explorer tree.
  // The VS Code tree → webview drag bridge only forwards the custom mime type declared
  // in dragMimeTypes (browsers lowercase DataTransfer type strings) — text/plain does NOT
  // survive the bridge, so read the JSON payload straight off the custom mime.
  const NEXQL_DRAG_MIME = 'application/vnd.code.tree.postgresexplorer';
  const NEXQL_DRAG_MIME_CASELESS = 'application/vnd.code.tree.postgresExplorer';
  const dragDropTargets = [inputWrapper, document.querySelector('.chat-container')].filter(Boolean);

  function maybeParseNexqlDrop(dataTransfer) {
    const raw = dataTransfer.getData(NEXQL_DRAG_MIME) || dataTransfer.getData(NEXQL_DRAG_MIME_CASELESS);
    if (!raw) { return null; }
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  // NOTE: dataTransfer.getData() only returns a value during 'dragstart'/'drop'.
  // During 'dragenter'/'dragover' browsers only expose dataTransfer.types (no payload),
  // so drop-target eligibility must be judged from types alone, not the parsed payload.
  function hasNexqlDragType(dataTransfer) {
    const types = Array.from(dataTransfer.types || []).map(t => String(t).toLowerCase());
    return types.includes(NEXQL_DRAG_MIME);
  }

  function maybeParseNexqlDrop(dataTransfer) {
    const raw = dataTransfer.getData(NEXQL_DRAG_MIME) || dataTransfer.getData(NEXQL_DRAG_MIME_CASELESS);
    if (!raw) { return null; }
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  // NOTE: dataTransfer.getData() only returns a value during 'dragstart'/'drop'.
  // During 'dragenter'/'dragover' browsers only expose dataTransfer.types (no payload),
  // so drop-target eligibility must be judged from types alone, not the parsed payload.
  function hasNexqlDragType(dataTransfer) {
    const types = (dataTransfer.types || []).map(t => String(t).toLowerCase());
    return types.includes(NEXQL_DRAG_MIME);
  }

  // VS Code disables webviews during workbench-internal drags (security, since 1.90) —
  // no drag event reaches this webview at all until the user holds Shift, at which point
  // pointer-events are re-enabled and dragenter fires. So this hint can only ever appear
  // once Shift is already held (a static tip lives in the @ button's title for
  // upfront discoverability); this is a same-drag confirmation, not a pre-drag prompt.
  let dragHintEl = null;
  let globalDragCounter = 0;
  function showDragHint() {
    if (!dragHintEl) {
      dragHintEl = document.createElement('div');
      dragHintEl.className = 'drag-hint';
      dragHintEl.textContent = '⇧ Shift held — drop to attach';
      document.body.appendChild(dragHintEl);
    }
    dragHintEl.classList.add('visible');
  }
  function hideDragHint() {
    dragHintEl?.classList.remove('visible');
  }

  dragDropTargets.forEach(el => {
    // Per-element counter — each target tracks its own nested dragenter/dragleave pairs
    // independently, so moving between overlapping targets (chat-container -> inputWrapper)
    // doesn't miscount and flicker the other target's 'drag-over' ring off.
    let elDragCounter = 0;
    el.addEventListener('dragenter', (e) => {
      if (!hasNexqlDragType(e.dataTransfer)) { return; }
      elDragCounter++;
      globalDragCounter++;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drag-over');
      showDragHint();
    });
    el.addEventListener('dragleave', (e) => {
      if (!hasNexqlDragType(e.dataTransfer)) { return; }
      elDragCounter = Math.max(0, elDragCounter - 1);
      globalDragCounter = Math.max(0, globalDragCounter - 1);
      if (elDragCounter === 0) {
        el.classList.remove('drag-over');
      }
      if (globalDragCounter === 0) {
        hideDragHint();
      }
    });
    el.addEventListener('dragover', (e) => {
      if (!hasNexqlDragType(e.dataTransfer)) { return; }
      // preventDefault required on EVERY dragover tick to keep the element a valid
      // drop target; skipping one tick can make the 'drop' event never fire.
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('drop', (e) => {
      elDragCounter = 0;
      globalDragCounter = 0;
      el.classList.remove('drag-over');
      hideDragHint();

      console.log('[ChatView] drop event fired, types:', Array.from(e.dataTransfer.types || []));

      if (!hasNexqlDragType(e.dataTransfer)) {
        console.log('[ChatView] drop skipped: no NexQL MIME in types');
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      // May legitimately parse to null (empty dataTransfer on some platforms) —
      // the extension host falls back to the payload stashed at drag start.
      const objects = maybeParseNexqlDrop(e.dataTransfer);
      console.log('[ChatView] parsed objects from drop:', objects);
      vscode.postMessage({ type: 'attachObjectFromDrop', objects });
      el.classList.add('drag-accepted');
      setTimeout(() => el.classList.remove('drag-accepted'), 600);
    });
  });

  document.getElementById('imageLightbox')?.addEventListener('click', closeLightbox);
  document.getElementById('closeLightboxBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });
}

wireChatDomEvents();

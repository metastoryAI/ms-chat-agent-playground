// ─── UI HELPERS ──────────────────────────────────────────────────────────────

// Message log for structured JSON persistence
let _messageLog = [];
let _restoring  = false;

function addUserMessage(parts) {
  if (!_restoring) _messageLog.push({ type: 'user', parts });
  const el = document.createElement('div');
  el.className = 'msg user';
  let html = '';
  parts.forEach(p => {
    if (p.type === 'file') html += `<div class="attach-badge"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1h5l3 3v7H2V1z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>${p.name}</div>`;
    if (p.type === 'text') html += `<div class="bubble">${escHtml(p.text).replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>')}</div>`;
  });
  el.innerHTML = html;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();
}

const _contextCardActions = new Set(['analyze_document', 'analyze_input', 'add_input', 'modify_input', 'remove_input', 'enrich_context', 'enrich_discard', 'builder_discard']);

function addAssistantMessage(text, nextActions, action) {
  if (!_restoring) _messageLog.push({ type: 'assistant', text, nextActions: nextActions || null, action: action || null });
  removeAllNextActions();
  const el = document.createElement('div');
  el.className = 'msg assistant';
  let html = '';

  // Support { text, hint } object or plain string
  const msgText = typeof text === 'object' && text !== null ? (text.text || '') : (text || '');
  const msgHint = typeof text === 'object' && text !== null ? (text.hint || '') : '';

  if (action && _contextCardActions.has(action)) {
    if (msgText) html += `<div class="bubble">${renderMarkdown(msgText)}</div>`;
    html += buildContextCardHTML();
    if (msgHint) html += `<div class="chat-hint">${renderMarkdown(msgHint)}</div>`;
  } else {
    if (msgText) html += `<div class="bubble">${renderMarkdown(msgText)}</div>`;
    if (msgHint) html += `<div class="chat-hint">${renderMarkdown(msgHint)}</div>`;
  }
  if (nextActions) html += renderNextActions(nextActions);
  el.innerHTML = html;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();
}

function addErrorMessage(msg) {
  if (!_restoring) _messageLog.push({ type: 'error', message: msg });
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = `<div class="bubble" style="border-color:var(--red);color:var(--red);">Error: ${escHtml(msg)}</div>`;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();
}

// Normalize a raw date match into { y, m, d }. Returns null on invalid.
function _normalizeDate(y, m, d) {
  y = String(y); m = String(m).padStart(2, '0'); d = String(d).padStart(2, '0');
  if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
  return { y, m, d };
}

// Find a date in free text. Handles yyyy-mm-dd, yyyy_mm_dd, dd.mm.yyyy, dd/mm/yyyy, mm/dd/yyyy (ambiguous → European).
function extractDateFromText(text) {
  if (!text) return null;
  const s = String(text).slice(0, 4000);
  let m;
  if ((m = s.match(/\b(\d{4})[._\-\/](\d{1,2})[._\-\/](\d{1,2})\b/))) return _normalizeDate(m[1], m[2], m[3]);
  if ((m = s.match(/\b(\d{1,2})[._\-\/](\d{1,2})[._\-\/](\d{4})\b/))) return _normalizeDate(m[3], m[2], m[1]);
  if ((m = s.match(/\b(\d{1,2})[._\-\/](\d{1,2})[._\-\/](\d{2})\b/))) return _normalizeDate(m[3], m[2], m[1]);
  return null;
}

function extractDateFromFilename(name) {
  return extractDateFromText(name);
}

// Format { y, m, d } for display based on project language.
// German / most European → "22.12.2025". US English → "12/22/2025". Default → "2025-12-22".
function formatDate(d) {
  if (!d) return '';
  const lang = (state.project_language || '').toLowerCase();
  if (['de', 'nl', 'pl', 'cs', 'fi', 'da', 'no', 'sv', 'tr', 'ru', 'uk'].includes(lang)) return `${d.d}.${d.m}.${d.y}`;
  if (['en', 'en-us'].includes(lang)) return `${d.m}/${d.d}/${d.y}`;
  if (['fr', 'it', 'es', 'pt', 'ro', 'hu', 'el'].includes(lang)) return `${d.d}/${d.m}/${d.y}`;
  return `${d.y}-${d.m}-${d.d}`;
}

// Turn a document into a short group label — generic "Doc N (date)" wording.
// Upload order is authoritative; the date (from content, else filename) is appended when found.
function shortenDocLabel(nameOrDoc, index) {
  if (!nameOrDoc) return '';
  const isObj = typeof nameOrDoc === 'object' && nameOrDoc !== null;
  const name = isObj ? String(nameOrDoc.name || '') : String(nameOrDoc);
  const textDate = isObj ? extractDateFromText(nameOrDoc.text) : null;
  const date = textDate || extractDateFromFilename(name);
  const dateSuffix = date ? ` (${formatDate(date)})` : '';
  const n = Number.isInteger(index) ? index + 1 : null;
  if (n != null) return `Doc ${n}${dateSuffix}`;
  return (date ? 'Doc' : (name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Doc')) + dateSuffix;
}

// Group points by source. Returns ordered list of { label, items, key }.
// Multi-source items (source includes comma or "Both") land in a shared group rendered last.
function groupPointsBySource(points, inputs) {
  const docs = (inputs || []).filter(i => i.source === 'document');

  // Build doc label map using upload order — "Doc 1 (date)", "Doc 2 (date)", …
  const docLabelByKey = new Map();
  const docIndexByKey = new Map();
  docs.forEach((d, idx) => {
    const key = String(d.name || '').toLowerCase();
    docLabelByKey.set(key, shortenDocLabel(d, idx));
    docIndexByKey.set(key, idx);
  });

  const singles = new Map(); // key → { label, items }
  const multi   = { label: 'Both meetings', items: [] };
  const generated = { label: 'From generated structure', items: [] };

  for (const p of points) {
    const raw = typeof p === 'object' ? String(p.source || '') : '';

    // Builder-absorbed items (after discard) — own group, clear labelling.
    if (raw === '__generated__') {
      generated.items.push(p);
      continue;
    }

    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

    if (parts.length === 0) {
      // Source missing — bucket silently, no "Unknown" label.
      if (!singles.has('__unsourced__')) singles.set('__unsourced__', { label: 'Other', items: [] });
      singles.get('__unsourced__').items.push(p);
      continue;
    }

    if (parts.length === 1) {
      const s = parts[0];
      const isBoth = /^both$/i.test(s);
      if (isBoth) {
        multi.items.push(p);
        continue;
      }
      const key = s.toLowerCase();
      const label = docLabelByKey.get(key) || shortenDocLabel(s);
      if (!singles.has(key)) singles.set(key, { label, items: [] });
      singles.get(key).items.push(p);
    } else {
      if (parts.length === 2) multi.label = 'Both meetings';
      else multi.label = 'Multiple meetings';
      multi.items.push(p);
    }
  }

  const ordered = [];
  // Follow upload order of docs
  for (const d of docs) {
    const key = String(d.name || '').toLowerCase();
    if (singles.has(key)) {
      ordered.push({ key, ...singles.get(key) });
      singles.delete(key);
    }
  }
  // Any remaining singles (unsourced / fallback)
  for (const [key, g] of singles) ordered.push({ key, ...g });
  if (multi.items.length > 0) ordered.push({ key: '__multi__', ...multi });
  if (generated.items.length > 0) ordered.push({ key: '__generated__', ...generated });
  return ordered;
}

function renderGroupedPoints(points, inputs, rowClass) {
  if (points.length === 0) return '';
  const groups = groupPointsBySource(points, inputs);

  // Open only the most recent doc group (last single-doc group, not the
  // special "__multi__" / "__generated__" / "__unsourced__" buckets).
  const isDocKey = (k) => k && !k.startsWith('__');
  let openIdx = -1;
  for (let i = groups.length - 1; i >= 0; i--) {
    if (isDocKey(groups[i].key)) { openIdx = i; break; }
  }
  if (openIdx === -1) openIdx = 0; // fallback: if no doc group, open the first

  return groups.map((g, idx) => {
    const body = renderFlatPoints(g.items, rowClass);
    return `<details class="cc-source-group" ${idx === openIdx ? 'open' : ''}>
      <summary class="cc-source-group-head"><span class="cc-source-group-label">${escHtml(g.label)}</span><span class="cc-source-group-count">${g.items.length}</span></summary>
      <div class="cc-source-group-body">${body}</div>
    </details>`;
  }).join('');
}

// Render a list of { title, summary } objects as rows of a given rowClass.
function renderFlatPoints(points, rowClass) {
  const contentClass = rowClass === 'cc-note' ? 'cc-note-content'
                    : rowClass === 'cc-topic-row' ? 'cc-topic-row-content'
                    : 'cc-point-content';
  const titleClass   = rowClass === 'cc-note' ? 'cc-note-title'
                    : rowClass === 'cc-topic-row' ? 'cc-topic-row-title'
                    : 'cc-point-title';
  const summaryClass = rowClass === 'cc-note' ? 'cc-note-summary'
                    : rowClass === 'cc-topic-row' ? 'cc-topic-row-summary'
                    : 'cc-point-summary';
  return points.map(p => {
    if (typeof p === 'object' && p !== null) {
      const title = p.title || p.text || '';
      const tag = (state._topicTags || {})[String(title).toLowerCase()] || '';
      const tagHtml = tag === 'NEW' ? ' <span class="cc-topic-tag cc-tag-new">NEW</span>'
                    : tag === 'UPDATED' ? ' <span class="cc-topic-tag cc-tag-updated">UPDATED</span>'
                    : '';
      return `<div class="${rowClass}"><div class="${contentClass}"><span class="${titleClass}">${escHtml(title)}${tagHtml}</span><span class="${summaryClass}">${escHtml(p.summary || '')}</span></div></div>`;
    }
    return `<div class="${rowClass}">${escHtml(p)}</div>`;
  }).join('');
}

function _fmtElapsedMs(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function renderAnalyzingState() {
  const start = state._openPointsLoadingStart || Date.now();
  return `<div class="cc-analyzing">
    <span class="cc-analyzing-text">Analyzing document…</span>
    <div class="loading-dots"><div class="dot-anim"></div><div class="dot-anim"></div><div class="dot-anim"></div></div>
    <span class="cc-analyzing-timer" data-start="${start}">${escHtml(_fmtElapsedMs(Date.now() - start))}</span>
  </div>`;
}

// Single global ticker: updates every `.cc-analyzing-timer` currently in the DOM.
if (!window._ccAnalyzingTickerStarted) {
  window._ccAnalyzingTickerStarted = true;
  setInterval(() => {
    document.querySelectorAll('.cc-analyzing-timer[data-start]').forEach(el => {
      const start = parseInt(el.dataset.start, 10);
      if (!Number.isFinite(start)) return;
      el.textContent = _fmtElapsedMs(Date.now() - start);
    });
  }, 1000);
}

function buildContextCardHTML() {
  const topics = state._capturedTopics || [];
  const openPoints = state._openPoints || [];
  const projectNotes = state._projectNotes || [];
  const loadingCount = state._openPointsLoadingCount || 0;
  const loading = loadingCount > 0;
  const docCount = (state.inputs || []).filter(i => i.source === 'document').length;
  const multiDoc = docCount > 1;

  if (topics.length === 0 && openPoints.length === 0 && projectNotes.length === 0 && !loading) return '';

  let html = '';

  const opCount = openPoints.length;
  const pnCount = projectNotes.length;
  const tcCount = topics.length;

  html += '<div class="context-card cc-tabbed-card">';
  html += `<div class="cc-tabs">`;
  const tabDots = `<span class="cc-tab-dots"><span></span><span></span><span></span></span>`;
  const opSuffix = loading ? tabDots : (opCount ? ` (${opCount})` : '');
  const pnSuffix = loading ? tabDots : (pnCount ? ` (${pnCount})` : '');
  html += `<button class="cc-tab cc-tab-active" data-tab="covered-topics">Covered Topics${tcCount ? ` (${tcCount})` : ''}</button>`;
  html += `<button class="cc-tab" data-tab="open-points">Open Points${opSuffix}</button>`;
  html += `<button class="cc-tab" data-tab="project-notes">Project Notes${pnSuffix}</button>`;
  html += `</div>`;

  // Covered Topics pane (active by default) — not loaded async, never shows "Analyzing…"
  html += `<div class="cc-tab-pane cc-tab-pane-active" data-pane="covered-topics">`;
  if (tcCount > 0) {
    html += multiDoc
        ? renderGroupedPoints(topics, state.inputs, 'cc-topic-row')
        : renderFlatPoints(topics, 'cc-topic-row');
  }
  html += `</div>`;

  // Open Points pane — during extraction, show "Analyzing document…" with thinking animation
  html += `<div class="cc-tab-pane" data-pane="open-points">`;
  if (loading) {
    html += renderAnalyzingState(loadingCount);
  } else if (opCount > 0) {
    html += multiDoc
        ? renderGroupedPoints(openPoints, state.inputs, 'cc-point')
        : renderFlatPoints(openPoints, 'cc-point');
  }
  html += `</div>`;

  // Project Notes pane
  html += `<div class="cc-tab-pane" data-pane="project-notes">`;
  if (loading) {
    html += renderAnalyzingState();
  } else if (pnCount > 0) {
    html += multiDoc
        ? renderGroupedPoints(projectNotes, state.inputs, 'cc-note')
        : renderFlatPoints(projectNotes, 'cc-note');
  }
  html += `</div>`;
  html += '</div>'; // close .cc-tabbed-card

  return html;
}

// Tab switching — delegated event listener
document.addEventListener('click', e => {
  const tab = e.target.closest('.cc-tab');
  if (!tab) return;
  const card = tab.closest('.cc-tabbed-card');
  if (!card) return;
  const target = tab.dataset.tab;
  card.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('cc-tab-active', t.dataset.tab === target));
  card.querySelectorAll('.cc-tab-pane').forEach(p => p.classList.toggle('cc-tab-pane-active', p.dataset.pane === target));
});

function addLoading() {
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = `<div class="bubble loading">
    <span class="loading-text">Thinking</span>
    <div class="loading-dots"><div class="dot-anim"></div><div class="dot-anim"></div><div class="dot-anim"></div></div>
    <span class="loading-timer" id="loading-timer">0s</span>
  </div>`;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();

  const start = Date.now();
  el._timerInterval = setInterval(() => {
    const timerEl = el.querySelector('#loading-timer');
    if (timerEl) {
      const s = Math.floor((Date.now() - start) / 1000);
      timerEl.textContent = s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
    }
  }, 1000);

  return el;
}

function removeLoading(el) {
  clearInterval(el._timerInterval);
  el.remove();
}

function renderMarkdown(text) {
  if (!text) return '';
  // Normalize common unicode escapes to actual characters
  const normalized = String(text)
      .replace(/\u{1F4A1}/gu, '💡')
      .replace(/\u{2705}/gu, '✅')
      .replace(/\u{26A1}/gu, '⚡')
      .replace(/\u{1F50D}/gu, '🔍');

  // Use marked.js when available for full markdown support (headings, tables, lists, code, etc.)
  if (typeof marked !== 'undefined' && marked.parse) {
    try {
      return marked.parse(normalized, { gfm: true, breaks: true });
    } catch (err) {
      console.warn('[renderMarkdown] marked.parse failed, falling back:', err);
    }
  }

  // Fallback: minimal inline rendering (bold, bullets, line breaks)
  return normalized
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*<\/li>)/g, '<ul>$1</ul>')
      .replace(/<\/li>\n<li>/g, '</li><li>')
      .replace(/\n/g, '<br>');
}

// Enter key icon SVG
const _enterSvg = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 2v4.5a1 1 0 01-1 1H3.5M3.5 7.5L5.5 5.5M3.5 7.5l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderNextActions(na) {
  const bar = document.getElementById('next-actions-bar');
  if (!bar) return '';
  if (!na) { bar.style.display = 'none'; bar.innerHTML = ''; return ''; }

  let html = '';
  let hasAny = false;

  function renderBtn(btn, groupIdx) {
    const data = JSON.stringify(btn).replace(/"/g, '&quot;');
    const cmdName = '/' + (btn.name || '').toLowerCase().replace(/\+/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const grp = groupIdx !== undefined ? ` data-group="${groupIdx}"` : '';
    const cmd = btn.command ? ` data-cmd="${btn.command}"` : '';
    return `<button class="na-btn"${grp}${cmd} onclick="handleButtonClick(this,${data})">
      <span class="na-btn-cmd">${escHtml(cmdName)}</span>
      ${btn.subtext ? `<span class="na-btn-sub">${escHtml(btn.subtext)}</span>` : '<span class="na-btn-sub"></span>'}
      <span class="na-btn-key">${_enterSvg}</span>
    </button>`;
  }

  if (na.groups) {
    na.groups.forEach((g, gi) => {
      if (g.separator) { html += '<hr class="na-separator">'; return; }
      if (!g.buttons?.length) return;
      g.buttons.forEach(btn => { html += renderBtn(btn, gi); hasAny = true; });
    });
  }
  if (na.buttons) na.buttons.forEach(btn => { html += renderBtn(btn); hasAny = true; });

  if (!hasAny) { bar.style.display = 'none'; bar.innerHTML = ''; return ''; }

  html += `<div class="na-footer"><span class="na-footer-esc"><kbd>esc</kbd> to close</span><span class="na-footer-move"><kbd>↑</kbd><kbd>↓</kbd> move</span></div>`;
  bar.innerHTML = html;
  bar.style.display = 'flex';
  _naHidden = false;
  if (typeof updateNaPlaceholder === 'function') updateNaPlaceholder();
  return '';
}

function removeAllNextActions() {
  if (_restoring) return;
  const bar = document.getElementById('next-actions-bar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  if (typeof updateNaPlaceholder === 'function') updateNaPlaceholder();
}

function handleButtonClick(el, btn) {
  const input = document.getElementById('user-input');

  if (btn.id === 'keep_existing_project') {
    state._pendingConflict = null;
    document.getElementById('user-input').value = 'Keep existing project';
    sendMessage();
    return;
  }

  if (btn.id === 'switch_to_new_project') {
    const conflict = state._pendingConflict;
    // Reset all project state for the new project
    state._pendingConflict = null;
    state.inputs = [];
    state.project_summary = null;
    state.project_context = null;
    state.existing_structure = null;
    state._capturedTopics = null;
    state._openPoints = [];
    state._resolvedPoints = [];
    state._resolvedAnswers = [];
    state._mode = 'chat';
    if (typeof updateContextTag === 'function') updateContextTag();

    if (conflict?.source === 'document' && conflict.fileText) {
      pendingFiles = [{
        file:  { name: conflict.fileName },
        text:  conflict.fileText,
        ready: Promise.resolve(),
        error: null,
      }];
      renderFilePreview();
      sendMessage();
    } else {
      document.getElementById('user-input').value = _lastUserText || conflict?.summary || '';
      sendMessage();
    }
    return;
  }

  if (btn.command === 'open_file_picker') {
    document.getElementById('file-input').click();
    return;
  }

  if (btn.command === 'focus_chat_input') {
    input.focus();
    return;
  }

  const BUILDER_GENERATION_TYPE = {
    trigger_builder_modules:          'modules',
    trigger_builder_modules_features: 'modules_features',
  };
  if (btn.command in BUILDER_GENERATION_TYPE) {
    removeAllNextActions();
    addUserMessage([{ type: 'text', text: btn.name }]);
    handleResponse({
      action: 'route_to_agent',
      agent:  'agent_builder',
      handoff: { generation_type: BUILDER_GENERATION_TYPE[btn.command] },
    }, null);
    return;
  }

  if (btn.command === 'trigger_enrich_context') {
    removeAllNextActions();
    addUserMessage([{ type: 'text', text: 'Enrich Context' }]);
    setEnrichContextSource('chat');
    handleResponse({
      action: 'route_to_agent',
      agent:  'agent_interviewer',
      handoff: {
        mode:             'enrich_context',
        status:           'start',
        answers:          [],
        platform_type:    state.project_context?.platform_type || null,
        project_summary:  state.project_summary,
        project_context:  state.project_context,
        captured_topics:  state._capturedTopics || [],
        existing_modules: (state.existing_structure?.sections || []).flatMap(s => s.modules || []),
        project_language: state.project_language || null,
      },
    }, null);
    return;
  }

  // Structure card commands
  if (btn.command === 'builder_insert')  { removeAllNextActions(); handleBuilderAction('insert');              return; }
  if (btn.command === 'builder_resolve') { removeAllNextActions(); handleBuilderAction('resolve_assumptions'); return; }
  if (btn.command === 'builder_discard') { removeAllNextActions(); handleBuilderAction('discard');             return; }
  if (btn.command === 'builder_enrich') {
    removeAllNextActions();
    addUserMessage([{ type: 'text', text: 'Enrich Context' }]);
    handleBuilderAction('enrich_context');
    return;
  }

  input.value = COMMAND_TO_TEXT[btn.command] || btn.command || btn.name;
  sendMessage();
}

// ─── DEBUG PANEL ─────────────────────────────────────────────────────────────

let _ioView = 'inline';
let _lastInput = null, _lastOutput = null;

function setIOView(view) {
  _ioView = view;
  document.getElementById('iotb-json').classList.toggle('active', view === 'json');
  document.getElementById('iotb-inline').classList.toggle('active', view === 'inline');
  document.getElementById('io-json-view').style.display = view === 'json' ? 'block' : 'none';
  document.getElementById('io-inline-view').style.display = view === 'inline' ? 'block' : 'none';
}

function plainText(val, indent) {
  const pad = '  '.repeat(indent);
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    if (val.length === 0) return '(empty)';
    return val.map((item, i) => {
      if (item === null || typeof item !== 'object') return `${pad}• ${item}`;
      const lines = Object.entries(item).map(([k, v]) => {
        const inner = plainText(v, indent + 2);
        return `${pad}  ${k}: ${inner}`;
      }).join('\n');
      return `${pad}[${i + 1}]\n${lines}`;
    }).join('\n\n');
  }
  return Object.entries(val).map(([k, v]) => {
    const inner = plainText(v, indent + 1);
    const multiline = inner.includes('\n');
    return multiline ? `${pad}${k}:\n${inner}` : `${pad}${k}: ${inner}`;
  }).join('\n');
}

function renderInline(elId, obj) {
  const el = document.getElementById(elId);
  if (!obj || typeof obj !== 'object') { el.innerHTML = ''; return; }
  el.innerHTML = Object.entries(obj).map(([key, val]) => {
    const isNull  = val === null || val === undefined;
    const isArr   = Array.isArray(val);
    const isObj   = !isNull && !isArr && typeof val === 'object';
    const isEmpty = isArr ? val.length === 0 : isObj ? Object.keys(val).length === 0 : false;

    let badge = '';
    if (isNull)       badge = `<span class="inline-null">null</span>`;
    else if (isArr)   badge = `<span class="inline-badge">[${val.length}]</span>`;
    else if (isObj)   badge = `<span class="inline-badge">{…}</span>`;
    else              badge = `<span class="inline-badge">${String(val).length > 30 ? String(val).substring(0,30)+'…' : String(val)}</span>`;

    const canOpen = !isNull && !isEmpty && (isArr || isObj || (typeof val === 'string' && val.length > 30));
    const chevron = canOpen ? `<span class="inline-chevron">▶</span>` : '';
    const bodyContent = canOpen ? escHtml(plainText(val, 0)) : '';

    return `<div class="inline-row">
      <div class="inline-row-head" ${canOpen ? `onclick="toggleInlineRow(this)"` : ''}>
        <span class="inline-key">${key}</span>
        <span class="inline-meta">${badge}${chevron}</span>
      </div>
      ${canOpen ? `<div class="inline-body">${bodyContent}</div>` : ''}
    </div>`;
  }).join('');
}

function toggleInlineRow(head) {
  const chevron = head.querySelector('.inline-chevron');
  const body    = head.nextElementSibling;
  if (!body) return;
  const open = body.classList.toggle('open');
  if (chevron) chevron.classList.toggle('open', open);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showDebugInput(payload, fileName, agentKey) {
  document.getElementById('io-empty').style.display = 'none';
  document.getElementById('io-content').style.display = 'block';
  let display = { _agent: agentKey || 'agent_chat', ...payload };
  if (fileName) display._file_attached = fileName;
  _lastInput = display;
  _lastOutput = null;
  document.getElementById('debug-input').textContent = JSON.stringify(display, null, 2);
  document.getElementById('debug-output').innerHTML = '<span style="color:var(--text3)">Waiting for response...</span>';
  document.getElementById('inline-output').innerHTML = '<span style="color:var(--text3);font-size:11px;padding:8px 10px;display:block;">Waiting for response...</span>';
  renderInline('inline-input', display);
  // Don't force-switch tabs — respect whatever tab the user has open (Backend, State, etc.)
}

function showDebugOutput(data, agentKey) {
  const display = agentKey ? { _agent: agentKey, ...data } : data;
  _lastOutput = display;
  document.getElementById('debug-output').textContent = JSON.stringify(display, null, 2);
  renderInline('inline-output', display);
}

// ─── TOKEN TRACKING ──────────────────────────────────────────────────────────

function trackTokens(rawResponse, agentKey) {
  let input = 0, output = 0;

  if (rawResponse.usage?.input_tokens) {
    input = rawResponse.usage.input_tokens;
    output = rawResponse.usage.output_tokens || 0;
  }
  if (rawResponse.usage?.prompt_tokens) {
    input = rawResponse.usage.prompt_tokens;
    output = rawResponse.usage.completion_tokens || 0;
  }
  if (rawResponse.usage?.input_tokens && !rawResponse.usage?.prompt_tokens) {
    input = rawResponse.usage.input_tokens;
    output = rawResponse.usage.output_tokens || 0;
  }
  if (rawResponse.usageMetadata?.promptTokenCount) {
    input = rawResponse.usageMetadata.promptTokenCount;
    output = rawResponse.usageMetadata.candidatesTokenCount || 0;
  }

  if (input === 0 && output === 0) return;

  tokenStats.totalInput += input;
  tokenStats.totalOutput += output;
  tokenStats.requests++;
  tokenStats.log.unshift({
    agent: agentKey || 'agent_chat',
    provider: provider,
    model: getModelForAgent(agentKey || 'agent_chat'),
    input,
    output,
    total: input + output,
    time: new Date().toLocaleTimeString()
  });

  updateTokenPanel();
}

function updateTokenPanel() {
  const total = tokenStats.totalInput + tokenStats.totalOutput;
  const lastReq = tokenStats.log[0] || null;
  const lastInput = lastReq ? lastReq.input : 0;

  document.getElementById('tk-total-input').textContent = tokenStats.totalInput.toLocaleString();
  document.getElementById('tk-total-output').textContent = tokenStats.totalOutput.toLocaleString();
  document.getElementById('tk-total').textContent = total.toLocaleString();
  document.getElementById('tk-requests').textContent = tokenStats.requests;

  const limit = getModelContextLimit();
  // Progress bar shows last request's input tokens vs context window (per-request metric)
  const pct = lastInput > 0 ? Math.min((lastInput / limit) * 100, 100) : 0;
  const fill = document.getElementById('token-bar-fill');
  fill.style.width = pct + '%';

  let color, label;
  if (pct < 15) { color = '#16a34a'; label = 'Low'; }
  else if (pct < 40) { color = '#65a30d'; label = 'Moderate'; }
  else if (pct < 65) { color = '#ca8a04'; label = 'High'; }
  else if (pct < 85) { color = '#ea580c'; label = 'Very High'; }
  else { color = '#dc2626'; label = 'Critical'; }
  fill.style.background = color;

  const limitStr = limit >= 1000000 ? (limit / 1000000).toFixed(1) + 'M' : (limit / 1000).toFixed(0) + 'K';
  const barLabel = lastInput > 0
      ? `Last request: ${lastInput.toLocaleString()} input tokens · <span style="color:${color};font-weight:600;">${label}</span>`
      : `${total.toLocaleString()} tokens total`;
  document.getElementById('token-bar-legend').innerHTML =
      `<span>${barLabel}</span><span>${limitStr}</span>`;

  const logEl = document.getElementById('token-log');
  if (tokenStats.log.length === 0) {
    logEl.innerHTML = '<span style="color:var(--text3)">No requests yet.</span>';
  } else {
    logEl.innerHTML = tokenStats.log.map(l =>
        `<div class="token-log-item">
        <span class="tl-agent">${l.agent}</span> · ${l.provider} · ${l.model}<br>
        <span class="tl-tokens">↑${l.input.toLocaleString()} ↓${l.output.toLocaleString()}</span> = ${l.total.toLocaleString()} · ${l.time}
      </div>`
    ).join('');
  }
}

// ─── STATE PANEL ─────────────────────────────────────────────────────────────

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'ms_chat_session_';
const STORAGE_VERSION = 6;

function getStorageKey() {
  return STORAGE_KEY_PREFIX + provider;
}

function persistChat() {
  try {
    if (_messageLog.length === 0) return;
    const session = {
      v: STORAGE_VERSION,
      state: {
        inputs:             state.inputs,
        project_summary:    state.project_summary,
        project_context:    state.project_context,
        existing_structure: state.existing_structure,
        _capturedTopics:    state._capturedTopics,
        _openPoints:        state._openPoints,
        _projectNotes:      state._projectNotes,
        _resolvedPoints:    state._resolvedPoints,
        _mode:              state._mode,
      },
      docCounter,
      messageLog: _messageLog,
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(session));
  } catch(e) { /* storage full or unavailable */ }
}

function restoreChat() {
  try {
    // Migrate old single-key storage to per-provider
    const oldRaw = localStorage.getItem('ms_chat_session');
    if (oldRaw) {
      localStorage.setItem(getStorageKey(), oldRaw);
      localStorage.removeItem('ms_chat_session');
    }

    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return;
    const session = JSON.parse(raw);

    if (session.v !== STORAGE_VERSION && session.v !== 5) {
      localStorage.removeItem(getStorageKey());
      return;
    }

    if (session.state) {
      // Migrate v5 (3 arrays) → v6 (unified inputs[])
      if (session.v === 5) {
        const inputs = [];
        (session.state.documents || []).forEach(d => {
          if (d.original_summary) { d.summary = d.original_summary; delete d.original_summary; }
          if (d.uploaded_at) { d.added_at = d.uploaded_at; delete d.uploaded_at; }
          inputs.push({ ...d, source: 'document' });
        });
        (session.state.free_inputs || []).forEach(f => inputs.push({ ...f, source: 'text' }));
        (session.state.manual_inputs || []).forEach(m => inputs.push({ ...m, source: 'additional' }));
        session.state.inputs = inputs;
        delete session.state.documents;
        delete session.state.free_inputs;
        delete session.state.manual_inputs;
      }
      Object.assign(state, session.state);
      Object.assign(providerStates[provider], session.state);
    }
    if (session.docCounter)    docCounter    = session.docCounter;

    const log = session.messageLog;
    if (log && log.length > 0) {
      // Remove empty-state placeholder before rendering messages
      const emptyEl = document.getElementById('empty-state');
      if (emptyEl) emptyEl.remove();

      _restoring = true;
      try {
        log.forEach((msg, i) => {
          const isLast = i === log.length - 1;
          if (msg.type === 'user') {
            addUserMessage(msg.parts);
          } else if (msg.type === 'assistant') {
            addAssistantMessage(msg.text, isLast ? msg.nextActions : null, msg.action);
          } else if (msg.type === 'error') {
            addErrorMessage(msg.message);
          } else if (msg.type === 'builder') {
            renderBuilderCard(msg.data);
          }
        });
      } finally {
        _restoring = false;
      }
      _messageLog = log;

      // If last message was a builder card, show builder NA commands
      const lastMsg = log[log.length - 1];
      if (lastMsg?.type === 'builder') {
        const allMods = [
          ...((lastMsg.data.structure || lastMsg.data).sections || []).flatMap(s => s.modules || []),
          ...((lastMsg.data.structure || lastMsg.data).modules || []),
          ...((lastMsg.data.structure || lastMsg.data).pages || []),
        ];
        const assumptionCount = [...new Set(allMods.flatMap(m => [
          ...(m.assumptions || []),
          ...(m.features || []).flatMap(f => f.assumptions || []),
        ]).filter(Boolean))].length;
        const na = resolveNextActions(`[NA:BUILDER_CARD|ASSUMPTIONS:${assumptionCount}]`);
        renderNextActions(na);
      }

      // Restore context tag + input placeholder
      if (typeof updateContextTag === 'function') updateContextTag();

      scrollToBottom();
    }
  } catch(e) { console.error('[restoreChat] failed:', e); }
}

function updateStatePanel() {
  document.getElementById('st-provider').textContent = (PROVIDER_LABELS[provider] || provider) + ' · ' + getSelectedModel();

  const docs = getDocuments();
  const docsEl = document.getElementById('st-docs');
  if (docs.length === 0) {
    docsEl.innerHTML = '<div class="state-empty">—</div>';
  } else {
    docsEl.innerHTML = docs.map(d => `
      <div class="doc-item">
        <div class="doc-name">${d.id} — ${d.name}</div>
        <div class="doc-summary">${(d.summary || '').substring(0, 100)}...</div>
      </div>`).join('');
  }

  const texts = getFreeInputs();
  const textEl = document.getElementById('st-text');
  if (texts.length === 0) {
    textEl.innerHTML = '<div class="state-empty">—</div>';
  } else {
    textEl.innerHTML = texts.map(t => `
      <div class="doc-item">
        <div class="doc-name">${t.id}</div>
        <div class="doc-summary">${(t.summary || '').substring(0, 100)}...</div>
      </div>`).join('');
  }

  const additionals = getAdditionalInputs();
  const addEl = document.getElementById('st-additional');
  if (additionals.length === 0) {
    addEl.innerHTML = '<div class="state-empty">—</div>';
  } else {
    addEl.innerHTML = additionals.map(m => `
      <div class="doc-item">
        <div class="doc-name">${m.topic}</div>
        <div class="doc-summary">${m.detail}</div>
      </div>`).join('');
  }

  const sumEl = document.getElementById('st-summary');
  sumEl.innerHTML = state.project_summary
      ? `<span style="font-size:11px;line-height:1.5;">${state.project_summary.substring(0, 200)}...</span>`
      : '<span class="state-empty">null</span>';

  document.getElementById('st-context').innerHTML = state.project_context
      ? `<span style="color:var(--green)">confidence: ${state.project_context.confidence}%</span>`
      : '<span class="state-empty">null</span>';

  document.getElementById('st-structure').innerHTML = state.existing_structure
      ? `<span style="color:var(--green)">${state.existing_structure.modules?.length || 0} modules</span>`
      : '<span class="state-empty">null</span>';

  persistChat();
}

// ─── CLEAR / SCROLL ──────────────────────────────────────────────────────────

function clearChat() {
  providerStates[provider] = freshState();
  state = providerStates[provider];
  docCounter = 0;
  _messageLog = [];
  document.getElementById('messages').innerHTML = `<div class="empty-state" id="empty-state">
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="1.5"/><path d="M13 20h14M20 13v14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    <div class="empty-title">Metastory AI Chat Agent</div>
    <div class="empty-sub">Upload a PDF or type a project description to start</div>
  </div>`;
  document.getElementById('io-empty').style.display = 'block';
  document.getElementById('io-content').style.display = 'none';
  tokenStats.totalInput = 0;
  tokenStats.totalOutput = 0;
  tokenStats.requests = 0;
  tokenStats.log = [];
  localStorage.removeItem(getStorageKey());
  updateTokenPanel();
  updateStatePanel();
}

function scrollToBottom() {
  const m = document.getElementById('messages-scroll');
  m.scrollTop = m.scrollHeight;
}
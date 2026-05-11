// ─── UI HELPERS ──────────────────────────────────────────────────────────────

// Message log for structured JSON persistence
let _messageLog = [];
let _restoring  = false;

function addUserMessage(parts) {
  if (!_restoring) _messageLog.push({ type: 'user', parts });
  // Auto-collapse any previous Builder cards when a new user message arrives.
  // The card stays visible (header + meta) and can be re-opened by click.
  document.querySelectorAll('.builder-card:not(.collapsed)').forEach(c => c.classList.add('collapsed'));
  // Auto-collapse any previous Context cards too — keeps chat history tidy,
  // user can re-expand via the chevron toggle to review.
  document.querySelectorAll('.context-card:not(.cc-collapsed)').forEach(c => c.classList.add('cc-collapsed'));
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

// Turn a document into a short group label.
// Prefers the LLM-provided `label` (2–4 word subject), falls back to "Doc N".
// Date (from content, else filename) is appended when found.
function shortenDocLabel(nameOrDoc, index) {
  if (!nameOrDoc) return '';
  const isObj = typeof nameOrDoc === 'object' && nameOrDoc !== null;
  const name = isObj ? String(nameOrDoc.name || '') : String(nameOrDoc);
  const label = isObj ? String(nameOrDoc.label || '').trim() : '';
  const textDate = isObj ? extractDateFromText(nameOrDoc.text) : null;
  const date = textDate || extractDateFromFilename(name);
  const dateSuffix = date ? ` · ${formatDate(date)}` : '';
  if (label) return `${label}${dateSuffix}`;
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
// Notes are grouped by `category` (closed enum from ANALYZE_ACTION_EXTRACT_DETAILS).
// Order follows natural project lifecycle. "other" is the catch-all for legacy
// entries without a category.
const NOTE_CATEGORY_ORDER = ['launch', 'migration', 'meeting', 'follow_up', 'documentation', 'training', 'other'];
const NOTE_CATEGORY_LABELS = {
  launch:        'Launch',
  migration:     'Migration',
  meeting:       'Meetings',
  follow_up:     'Follow-ups',
  documentation: 'Documentation',
  training:      'Training',
  other:         'Other',
};

function renderGroupedNotes(notes) {
  // Bucket notes by category. Unknown / missing → 'other'.
  const buckets = new Map();
  for (const n of notes) {
    const cat = (typeof n === 'object' && n !== null && n.category && NOTE_CATEGORY_LABELS[n.category])
        ? n.category
        : 'other';
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat).push(n);
  }
  // Walk in canonical order, render section title + flat rows for each non-empty bucket.
  let html = '';
  for (const cat of NOTE_CATEGORY_ORDER) {
    const items = buckets.get(cat);
    if (!items || items.length === 0) continue;
    html += `<div class="cc-note-section-title">${escHtml(NOTE_CATEGORY_LABELS[cat])}</div>`;
    html += renderFlatPoints(items, 'cc-note');
  }
  return html;
}

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

// Decision card — { title, quote, stakeholder, rationale }. Quote shown as a
// blockquote when present (verbatim source line); stakeholder rendered as a
// small chip; rationale is the body summary.
function renderFlatDecisions(items) {
  return (items || []).map(d => {
    if (typeof d !== 'object' || d === null) {
      return `<div class="cc-decision">${escHtml(d)}</div>`;
    }
    const title       = d.title || '';
    const quote       = d.quote || '';
    const stakeholder = d.stakeholder || '';
    const rationale   = d.rationale || d.summary || '';
    const tag         = (state._topicTags || {})[String(title).toLowerCase()] || '';
    const tagHtml = tag === 'NEW'     ? ' <span class="cc-topic-tag cc-tag-new">NEW</span>'
                  : tag === 'UPDATED' ? ' <span class="cc-topic-tag cc-tag-updated">UPDATED</span>'
                  : '';
    const stakeholderHtml = stakeholder
      ? `<span class="cc-decision-stakeholder">${escHtml(stakeholder)}</span>`
      : '';
    const quoteHtml = quote
      ? `<blockquote class="cc-decision-quote">${escHtml(quote)}</blockquote>`
      : '';
    return `<div class="cc-decision">
      <div class="cc-decision-content">
        <span class="cc-decision-title">${escHtml(title)}${tagHtml}${stakeholderHtml}</span>
        ${quoteHtml}
        ${rationale ? `<span class="cc-decision-rationale">${escHtml(rationale)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// Entities — { name, type, summary }. Grouped by `type` so the type label
// shows once as a section header and each entity sits beneath it as a flat row.
// Type chip on individual rows is dropped to avoid duplicating the section header.
const ENTITY_TYPE_LABELS = {
  person:  'Person',
  role:    'Role',
  system:  'System',
  tool:    'Tool',
  product: 'Product',
  org:     'Org',
  other:   'Other',
};
const ENTITY_TYPE_ORDER = ['person', 'role', 'system', 'tool', 'product', 'org', 'other'];

function renderGroupedEntities(items) {
  // Bucket entities by type. Unknown / missing → 'other'.
  const buckets = new Map();
  for (const e of (items || [])) {
    const t = (typeof e === 'object' && e !== null && e.type && ENTITY_TYPE_LABELS[e.type])
        ? e.type
        : 'other';
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t).push(e);
  }
  // Walk in canonical order; render a section title + flat entity rows for each non-empty bucket.
  let html = '';
  for (const t of ENTITY_TYPE_ORDER) {
    const list = buckets.get(t);
    if (!list || list.length === 0) continue;
    html += `<div class="cc-note-section-title">${escHtml(ENTITY_TYPE_LABELS[t])}</div>`;
    html += list.map(e => {
      if (typeof e !== 'object' || e === null) {
        return `<div class="cc-entity">${escHtml(e)}</div>`;
      }
      const name    = e.name || e.title || '';
      const summary = e.summary || '';
      const tag     = (state._topicTags || {})[String(name).toLowerCase()] || '';
      const tagHtml = tag === 'NEW'     ? ' <span class="cc-topic-tag cc-tag-new">NEW</span>'
                    : tag === 'UPDATED' ? ' <span class="cc-topic-tag cc-tag-updated">UPDATED</span>'
                    : '';
      return `<div class="cc-entity">
        <div class="cc-entity-content">
          <span class="cc-entity-title">${escHtml(name)}${tagHtml}</span>
          ${summary ? `<span class="cc-entity-summary">${escHtml(summary)}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  return html;
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

// Filter a list of source-tagged points to entries belonging to a single document.
// `source` may be a single name, multiple comma-separated names, or "Both".
// Special: docName='__added__' returns items with NO matching doc source
// (unsourced user additions, text inputs, manual entries).
function _filterPointsBySource(points, docName, knownDocNames) {
  if (!docName) return points;
  if (docName === '__added__') {
    const docSet = knownDocNames instanceof Set ? knownDocNames : new Set();
    return (points || []).filter(p => {
      const raw = typeof p === 'object' ? String(p.source || '').toLowerCase() : '';
      if (!raw)                return true;   // unsourced → user-added
      if (raw === '__generated__') return false; // builder-absorbed, separate bucket
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
      // "Added" shows items that don't match any current doc
      return !parts.some(p => docSet.has(p));
    });
  }
  const target = String(docName).toLowerCase();
  // Notes tagged since the stable-id migration carry the document input's `id`
  // as `source`, not the filename — also match that so items stay on their doc tab.
  const docInput = (state.inputs || []).find(i => i.source === 'document' && String(i.name || '').toLowerCase() === target);
  const targetId = docInput?.id?.toLowerCase();
  return (points || []).filter(p => {
    const raw = typeof p === 'object' ? String(p.source || '') : '';
    if (!raw || raw === '__generated__') return false;
    const parts = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return parts.includes(target) || (targetId && parts.includes(targetId)) || /^both$/.test(raw);
  });
}

// Replace a specific .context-card in place with freshly rendered HTML.
// The card's state-derived content is regenerated from current state.
function _rerenderContextCardInPlace(cardEl) {
  if (!cardEl) return;
  const html = buildContextCardHTML();
  if (!html) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const newCard = wrap.firstElementChild;
  if (newCard) cardEl.replaceWith(newCard);
}

function setActiveContextDoc(name, cardEl) {
  state._activeContextDoc = name;
  if (cardEl) {
    _rerenderContextCardInPlace(cardEl);
  } else if (typeof refreshContextCardInLastMessage === 'function') {
    refreshContextCardInLastMessage();
  }
}
window.setActiveContextDoc = setActiveContextDoc;

function setActiveContextTab(key, cardEl) {
  state._activeContextTab = key;
  if (cardEl) {
    _rerenderContextCardInPlace(cardEl);
  } else if (typeof refreshContextCardInLastMessage === 'function') {
    refreshContextCardInLastMessage();
  }
}
window.setActiveContextTab = setActiveContextTab;

// Rotating loading message below the inner tab bar while extract_details runs.
const _CC_LOADING_PHRASES = [
  'Reading document...',
  'Analyzing...',
  'Extracting details...',
  'Finalizing...',
];
if (!window._ccLoadingTickerStarted) {
  window._ccLoadingTickerStarted = true;
  setInterval(() => {
    const nodes = document.querySelectorAll('.cc-loading-msg[data-start]');
    if (nodes.length === 0) return;
    nodes.forEach(el => {
      const start = parseInt(el.dataset.start, 10);
      if (!Number.isFinite(start)) return;
      const elapsed = Date.now() - start;
      const idx = Math.floor(elapsed / 3500) % _CC_LOADING_PHRASES.length;
      if (el.dataset.idx === String(idx)) return;
      el.dataset.idx = String(idx);
      const textEl = el.querySelector('.cc-loading-msg-text');
      if (!textEl) return;
      textEl.style.opacity = '0';
      setTimeout(() => {
        textEl.textContent = _CC_LOADING_PHRASES[idx];
        textEl.style.opacity = '1';
      }, 180);
    });
  }, 500);
}

function buildContextCardHTML() {
  const docs           = (state.inputs || []).filter(i => i.source === 'document');
  const allTopics      = state._capturedTopics || [];
  const allOpenPoints  = state._openPoints     || [];
  const allProjectNotes= state._projectNotes   || [];
  const allDecisions   = state._decisions      || [];
  const allEntities    = state._entities       || [];
  const loadingNames   = state._docLoadingNames || new Set();
  const loadingCount   = state._openPointsLoadingCount || 0;

  // Nothing to show — render no card.
  if (docs.length === 0 && allTopics.length === 0 && allOpenPoints.length === 0 && allProjectNotes.length === 0 && allDecisions.length === 0 && allEntities.length === 0 && loadingCount === 0) {
    return '';
  }

  // Detect "Added" bucket — user-added topics/points whose source does NOT
  // belong to any uploaded document (free text, manual additions, unsourced).
  // Include both filenames AND input ids — notes may be tagged with either
  // (stable ids are the current convention; filenames are kept for back-compat).
  const docNames = new Set([
    ...docs.map(d => String(d.name || '').toLowerCase()),
    ...docs.map(d => String(d.id   || '').toLowerCase()),
  ].filter(Boolean));
  const _hasAdded = (list) => (list || []).some(p => {
    const raw = typeof p === 'object' ? String(p.source || '').toLowerCase() : '';
    if (raw === '__generated__') return false;
    if (!raw) return true;
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    return !parts.some(p => docNames.has(p));
  });
  const hasAdded = docs.length >= 1 && (
    _hasAdded(allTopics) || _hasAdded(allOpenPoints) || _hasAdded(allProjectNotes) ||
    _hasAdded(allDecisions) || _hasAdded(allEntities)
  );

  // Show the outer tab bar when there are >=2 buckets (doc + doc, or doc + added).
  const showDocTabs = (docs.length + (hasAdded ? 1 : 0)) >= 2;
  let activeName = state._activeContextDoc;
  if (showDocTabs) {
    const valid = new Set(docs.map(d => d.name));
    if (hasAdded) valid.add('__added__');
    if (!activeName || !valid.has(activeName)) {
      activeName = docs[docs.length - 1]?.name || '__added__';
      state._activeContextDoc = activeName;
    }
  } else {
    activeName = docs[0]?.name || null;
  }

  const useDocFilter   = !!activeName;
  const topics         = useDocFilter ? _filterPointsBySource(allTopics,       activeName, docNames) : allTopics;
  const openPoints     = useDocFilter ? _filterPointsBySource(allOpenPoints,   activeName, docNames) : allOpenPoints;
  const projectNotes   = useDocFilter ? _filterPointsBySource(allProjectNotes, activeName, docNames) : allProjectNotes;
  const decisions      = useDocFilter ? _filterPointsBySource(allDecisions,    activeName, docNames) : allDecisions;
  const entities       = useDocFilter ? _filterPointsBySource(allEntities,     activeName, docNames) : allEntities;
  const isExtractingActiveDoc = activeName && activeName !== '__added__' ? loadingNames.has(activeName) : false;

  // Inner tab selection — default covered-topics.
  let activeTab = state._activeContextTab || 'covered-topics';
  // Snap back to covered-topics if user is sitting on a tab that is currently loading.
  // (decisions/entities/open-points/project-notes all populate from extract_details.)
  if (isExtractingActiveDoc &&
      (activeTab === 'open-points' || activeTab === 'project-notes' ||
       activeTab === 'decisions'   || activeTab === 'entities')) {
    activeTab = 'covered-topics';
  }

  let html = '<div class="context-card cc-inline-card">';

  // Collapse toggle (top-right corner). Starts expanded; previous cards are auto-collapsed
  // when a new user message arrives (see addUserMessage).
  const chevronIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  html += `<button type="button" class="cc-collapse-btn" aria-label="Toggle context" title="Show / hide context">${chevronIcon}</button>`;

  // Outer tab bar: document tabs + optional "Added" bucket for user additions.
  if (showDocTabs) {
    html += '<div class="cc-doc-tabs">';
    docs.forEach((d, idx) => {
      const isActive  = d.name === activeName;
      const isLoading = loadingNames.has(d.name);
      const label     = shortenDocLabel(d, idx);
      const safeName  = escHtml(d.name);
      html += `<button type="button" class="cc-doc-tab${isActive ? ' active' : ''}" title="${safeName}" data-docname="${safeName}">
        <span class="cc-doc-tab-icon" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg></span>
        <span class="cc-doc-tab-label">${escHtml(label)}</span>
        ${isLoading ? `<span class="cc-doc-tab-spinner" aria-label="Analyzing"><span class="dot-anim"></span><span class="dot-anim"></span><span class="dot-anim"></span></span>` : ''}
      </button>`;
    });
    if (hasAdded) {
      const isActive = activeName === '__added__';
      const newBadge = state._addedTabHasNew ? `<span class="cc-doc-tab-new">New</span>` : '';
      html += `<button type="button" class="cc-doc-tab cc-doc-tab-added${isActive ? ' active' : ''}" title="User additions" data-docname="__added__">
        <span class="cc-doc-tab-label">Additions</span>
        ${newBadge}
      </button>`;
    }
    html += '</div>';
  }

  // Inner tab bar (3 tabs) — delegated via data-key. Loading status inline-right.
  const ctxLabel = activeName === '__added__' ? 'in your additions' : 'in this document';
  const tabDef = [
    { key: 'covered-topics', title: 'Covered Topics', count: topics.length,       loading: false,                 emptyText: `No covered topics ${ctxLabel}.`, rowClass: 'cc-topic-row', items: topics },
    { key: 'decisions',      title: 'Decisions',      count: decisions.length,    loading: isExtractingActiveDoc, emptyText: `No decisions ${ctxLabel}.`,      rowClass: 'cc-decision',  items: decisions },
    { key: 'open-points',    title: 'Open Points',    count: openPoints.length,   loading: isExtractingActiveDoc, emptyText: `No open points ${ctxLabel}.`,    rowClass: 'cc-point',     items: openPoints },
    { key: 'project-notes',  title: 'Notes',          count: projectNotes.length, loading: isExtractingActiveDoc, emptyText: `No notes ${ctxLabel}.`,          rowClass: 'cc-note',      items: projectNotes },
    { key: 'entities',       title: 'Entities',       count: entities.length,     loading: isExtractingActiveDoc, emptyText: `No entities ${ctxLabel}.`,       rowClass: 'cc-entity',    items: entities },
  ];

  // Hide empty non-essential tabs (Open Points, Notes) when their count is 0 and
  // nothing is loading — keeps the card clean for free-text-only projects where
  // those buckets never get populated. Covered Topics is always visible.
  const visibleTabs = tabDef.filter(t => t.key === 'covered-topics' || t.count > 0 || t.loading);

  // If the currently active tab was filtered out, snap back to Covered Topics.
  if (!visibleTabs.some(t => t.key === activeTab)) {
    activeTab = 'covered-topics';
  }

  html += '<div class="cc-inner-tabs-wrap">';
  html += '<div class="cc-inner-tabs">';
  visibleTabs.forEach(t => {
    const isActive = t.key === activeTab;
    const suffix   = t.loading
      ? `<span class="cc-inner-tab-loading cc-tab-dots" aria-label="Loading"><span></span><span></span><span></span></span>`
      : `<span class="cc-inner-tab-count">(${t.count})</span>`;
    html += `<button type="button" class="cc-inner-tab${isActive ? ' active' : ''}${t.loading ? ' loading' : ''}" data-key="${t.key}">
      <span class="cc-inner-tab-label">${escHtml(t.title)}</span>
      ${suffix}
    </button>`;
  });
  // Rotating loading message — lives at the tab-bar level (right-aligned).
  if (isExtractingActiveDoc) {
    const start = state._openPointsLoadingStart || Date.now();
    html += `<div class="cc-loading-msg" data-start="${start}" data-idx="0">
      <span class="cc-loading-msg-text">${_CC_LOADING_PHRASES[0]}</span>
    </div>`;
  }
  html += '</div>'; // close .cc-inner-tabs
  // Thin linear animated progress strip below the tab bar while loading.
  if (isExtractingActiveDoc) {
    html += '<div class="cc-loading-strip"><span></span></div>';
  }
  html += '</div>'; // close .cc-inner-tabs-wrap

  // Content pane — flat for topics / open-points; grouped-by-category for notes.
  html += '<div class="cc-content">';
  const active = tabDef.find(t => t.key === activeTab);
  if (active) {
    if (active.count === 0) {
      html += `<div class="cc-empty">${escHtml(active.emptyText)}</div>`;
    } else if (active.key === 'project-notes') {
      html += renderGroupedNotes(active.items);
    } else if (active.key === 'decisions') {
      html += renderFlatDecisions(active.items);
    } else if (active.key === 'entities') {
      html += renderGroupedEntities(active.items);
    } else {
      html += renderFlatPoints(active.items, active.rowClass);
    }
  }
  html += '</div>'; // close .cc-content

  html += '</div>'; // close .context-card
  return html;
}

// Delegated click for both doc-tabs and inner tabs — robust against special
// characters in filenames, and updates the CLICKED card in place (not just
// the last one — important for scrolling back through the chat history).
document.addEventListener('click', (e) => {
  const collapseBtn = e.target.closest('.cc-collapse-btn');
  if (collapseBtn) {
    const card = collapseBtn.closest('.context-card');
    if (card) card.classList.toggle('cc-collapsed');
    return;
  }
  const docTab = e.target.closest('.cc-doc-tab');
  if (docTab && docTab.dataset.docname !== undefined) {
    state._addedTabHasNew = false;
    const card = docTab.closest('.context-card');
    setActiveContextDoc(docTab.dataset.docname, card);
    return;
  }
  const innerTab = e.target.closest('.cc-inner-tab');
  if (innerTab && !innerTab.classList.contains('loading') && innerTab.dataset.key) {
    state._addedTabHasNew = false;
    const card = innerTab.closest('.context-card');
    setActiveContextTab(innerTab.dataset.key, card);
  }
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
    const disabledAttr = btn.disabled ? ' disabled aria-disabled="true"' : '';
    const disabledCls = btn.disabled ? ' na-btn-disabled' : '';
    const onclick = btn.disabled ? '' : ` onclick="handleButtonClick(this,${data})"`;
    return `<button class="na-btn${disabledCls}"${grp}${cmd}${disabledAttr}${onclick}>
      <span class="na-btn-cmd">${escHtml(cmdName)}</span>
      ${btn.subtext ? `<span class="na-btn-sub">${escHtml(btn.subtext)}</span>` : '<span class="na-btn-sub"></span>'}
      <span class="na-btn-key">${_enterSvg}</span>
    </button>`;
  }

  if (na.groups) {
    na.groups.forEach((g, gi) => {
      if (g.separator) { html += '<hr class="na-separator">'; return; }
      if (g.contextRow) {
        const pct = Number(state.project_context?.confidence) || 0;
        if (!pct) return;
        const { level, label } = confidenceLevel(pct);
        const subHtml = `<span class="na-btn-sub na-ctx-sub">
          <span class="na-ctx-label">${label}</span>
          <span class="na-ctx-track"><span class="na-ctx-fill level-${level}" style="width:${Math.min(100, pct)}%;"></span></span>
          <span class="na-ctx-percent">${pct}%</span>
        </span>`;
        const data = JSON.stringify({ id: 'open_context_details', name: 'Context Details', command: 'open_context_panel' }).replace(/"/g, '&quot;');
        html += `<button class="na-btn na-btn-context" data-cmd="open_context_panel" onclick="handleButtonClick(this,${data})">
          <span class="na-btn-cmd">/context-details</span>
          ${subHtml}
          <span class="na-btn-key">${_enterSvg}</span>
        </button>`;
        hasAny = true;
        return;
      }
      if (!g.buttons?.length) return;
      if (g.title) html += `<div class="na-group-title">${escHtml(g.title)}</div>`;
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

// Mark the first visible next-action button as active (keyboard-focused look),
// so arrow/Enter navigation continues from there instead of snapping back to the input.
function activateFirstNaBtn() {
  const bar = document.getElementById('next-actions-bar');
  if (!bar) return;
  bar.querySelectorAll('.na-btn.na-active').forEach(b => b.classList.remove('na-active'));
  const firstBtn = bar.querySelector('.na-btn:not(.na-hidden):not([disabled])');
  if (firstBtn) firstBtn.classList.add('na-active');
}

function removeAllNextActions() {
  if (_restoring) return;
  const bar = document.getElementById('next-actions-bar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  if (typeof updateNaPlaceholder === 'function') updateNaPlaceholder();
}

function handleButtonClick(el, btn) {
  const input = document.getElementById('user-input');

  // Discard — drop the pending input locally, no LLM call needed.
  // The conflicting file was never pushed to state.inputs (agent emitted clarify,
  // not analyze_document), so clearing _pendingConflict is sufficient.
  if (btn.id === 'discard_new_input') {
    state._pendingConflict = null;
    addUserMessage([{ type: 'text', text: 'Discard' }]);
    removeAllNextActions();

    // Restore next-actions bar based on current state so the user has a path forward.
    // Mirrors the fallback logic in response-handler.js::handleResponse.
    let tag = null;
    if (state.existing_structure?.inserted === true) {
      tag = buildBuilderInsertedTag();
    } else if ((state.inputs || []).some(i => i.source === 'text' || i.source === 'document')) {
      const conf = state.project_context?.confidence || 35;
      tag = `[NA:GENERATE|CONFIDENCE:${conf}]`;
    }
    const nextActions = tag ? resolveNextActions(tag) : null;

    addAssistantMessage({ text: '**Discarded.** Continuing with the current project.', hint: null }, nextActions);
    return;
  }

  // Proceed — dismiss the conflict warning and analyze the new input normally.
  // The agent will merge it into the existing project context.
  if (btn.id === 'proceed_with_new_input') {
    const conflict = state._pendingConflict;
    state._pendingConflict = null;
    addUserMessage([{ type: 'text', text: 'Proceed' }]);
    removeAllNextActions();

    // Restore the pending file so analyze receives the document text.
    if (conflict?.source === 'document' && conflict.fileText) {
      pendingFiles = [{
        file:  { name: conflict.fileName },
        text:  conflict.fileText,
        ready: Promise.resolve(),
        error: null,
      }];
      renderFilePreview();
    }
    // Router bypass: analyze with conflict_resolution=proceed tells the
    // agent to skip re-detection and process the input as a normal merge.
    resolveConflict('proceed');
    return;
  }

  if (btn.command === 'open_file_picker') {
    document.getElementById('file-input').click();
    return;
  }

  if (btn.command === 'open_context_panel') {
    if (typeof toggleProjectContextPanel === 'function') toggleProjectContextPanel();
    return;
  }

  if (btn.command === 'focus_chat_input') {
    // Hide the NA bar like ESC does — keep innerHTML intact so `/` can re-open it.
    const bar = document.getElementById('next-actions-bar');
    if (bar) bar.style.display = 'none';
    if (typeof _naHidden !== 'undefined') _naHidden = true;
    if (typeof updateNaPlaceholder === 'function') updateNaPlaceholder();
    input.focus();
    return;
  }

  // INTENT_PICKER buttons — emitted by CLARIFY when the router can't tell
  // whether the user wants to analyze a doc or ask about it.
  if (btn.command === 'intent_picker_analyze') {
    removeAllNextActions();
    // Direct dispatch — bypass the router (it already classified this turn
    // as unclear). chat.js owns the file/state plumbing.
    dispatchAnalyzeFromPicker();
    return;
  }
  if (btn.command === 'intent_picker_answer') {
    // Wipe the NA bar fully (innerHTML + display:none) so no stale button
    // can be clicked, and no keyboard handler can re-trigger it. The bar
    // re-opens later when the user types `/`. The pending file stays in
    // pendingFiles (with _retained=true from chat.js) so the user's next
    // free-text send automatically includes it.
    removeAllNextActions();
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
    // Post-insert "Generate Features" (modules already inserted, no features yet) —
    // use the explicit add_features mode so modules are locked and only features
    // get added. Without this, the auto-mode picks 'diff' and regenerates everything.
    const isAddFeaturesCase =
        btn.command === 'trigger_builder_modules_features'
        && state.existing_structure?.inserted === true
        && state.existing_structure?.generation_type !== 'modules_features';
    const handoff = { generation_type: BUILDER_GENERATION_TYPE[btn.command] };
    if (isAddFeaturesCase) handoff.mode = 'add_features';
    handleResponse({
      action: 'route_to_agent',
      agent:  'builder',
      handoff,
    }, null);
    return;
  }

  // Regenerate (diff mode) — routes to builder with existing_structure + all inputs.
  if (btn.command === 'trigger_builder_regenerate') {
    removeAllNextActions();
    const genType = state.existing_structure?.generation_type === 'modules_features'
        ? 'modules_features'
        : 'modules';
    const label = genType === 'modules_features' ? 'Regenerate Modules with Features' : 'Regenerate Modules';
    addUserMessage([{ type: 'text', text: label }]);
    handleResponse({
      action: 'route_to_agent',
      agent:  'builder',
      handoff: { generation_type: genType },
    }, null);
    return;
  }

  // Disabled / not-yet-implemented commands — click does nothing.
  if (btn.command === 'coming_soon') {
    return;
  }

  if (btn.command === 'trigger_enrich_context') {
    state._enrichDepthSource = 'chat';
    const na = resolveNextActions('[NA:ENRICH_DEPTH]');
    if (na) {
      renderNextActions(na);
      activateFirstNaBtn();
    }
    return;
  }

  if (btn.command === 'trigger_enrich_depth_quick' ||
      btn.command === 'trigger_enrich_depth_medium' ||
      btn.command === 'trigger_enrich_depth_deep') {
    const depth = btn.command.replace('trigger_enrich_depth_', '');
    const source = state._enrichDepthSource || 'chat';
    state._enrichDepthSource = null;
    removeAllNextActions();
    addUserMessage([{ type: 'text', text: 'Enrich Context' }]);
    setEnrichContextSource(source);
    handleResponse({
      action: 'route_to_agent',
      agent:  'interview',
      handoff: {
        mode:             'enrich_context',
        status:           'start',
        depth,
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

  if (btn.command === 'trigger_enrich_depth_back') {
    const source = state._enrichDepthSource || 'chat';
    state._enrichDepthSource = null;
    if (source === 'builder') {
      if (typeof showBuilderCardNA === 'function') showBuilderCardNA();
      return;
    }
    const conf = state.project_context?.confidence || 35;
    const na = resolveNextActions(`[NA:GENERATE|CONFIDENCE:${conf}]`);
    if (na) renderNextActions(na); else removeAllNextActions();
    return;
  }

  // Structure card commands
  if (btn.command === 'builder_insert')  { removeAllNextActions(); handleBuilderAction('insert');              return; }
  if (btn.command === 'builder_resolve') { removeAllNextActions(); handleBuilderAction('resolve_assumptions'); return; }
  if (btn.command === 'builder_discard') { removeAllNextActions(); handleBuilderAction('discard');             return; }
  if (btn.command === 'builder_enrich') {
    removeAllNextActions();
    handleBuilderAction('enrich_context');
    return;
  }
  // Builder: add features to existing modules (generation_type was `modules`)
  if (btn.command === 'builder_generate_features') {
    removeAllNextActions();
    addUserMessage([{ type: 'text', text: 'Generate Features' }]);
    handleResponse({
      action: 'route_to_agent',
      agent:  'builder',
      handoff: { generation_type: 'modules_features' },
    }, null);
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
  let display = { _agent: agentKey || 'intent_router', ...payload };
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

// Append a chained agent output to the debug panel without clobbering the
// previous one. Used by extract_details (and any other follow-up call)
// so the user can still see the upstream analyze response after the chain runs.
function appendDebugOutput(data, agentKey, label) {
  const display = agentKey ? { _agent: agentKey, ...data } : data;
  const sepLabel = (label || agentKey || 'CHAINED').toUpperCase();
  const sep = `\n\n// ───── ${sepLabel} ─────\n\n`;

  const out = document.getElementById('debug-output');
  if (out) {
    const prev = out.textContent || '';
    out.textContent = prev + sep + JSON.stringify(display, null, 2);
  }

  const inlineEl = document.getElementById('inline-output');
  if (inlineEl) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-top:1px solid var(--border,#2a2a2a);margin-top:8px;padding-top:8px;';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:10px;color:var(--text3);padding:4px 10px;letter-spacing:0.5px;';
    hdr.textContent = `── ${sepLabel} ──`;
    wrap.appendChild(hdr);
    const body = document.createElement('div');
    wrap.appendChild(body);
    inlineEl.appendChild(wrap);
    renderInline(body.id = `inline-output-chain-${Date.now()}`, display);
  }
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
    agent: agentKey || 'intent_router',
    provider: provider,
    model: getModelForAgent(agentKey || 'intent_router'),
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
        project_language:   state.project_language,
        _languageConfirmed: state._languageConfirmed,
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
      // Legacy structures had `summary` as plain strings — wrap into
      // history arrays so downstream renderers/mergers don't crash.
      if (typeof normalizeStructureSummaries === 'function') {
        normalizeStructureSummaries(state.existing_structure);
      }
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
            if (msg.variant === 'diff' || msg.data?.diff) {
              renderDiffCard(msg.data, []);
            } else {
              renderBuilderCard(msg.data);
            }
          }
        });
      } finally {
        _restoring = false;
      }
      _messageLog = log;

      // If last message was a builder card, show builder NA commands
      const lastMsg = log[log.length - 1];
      if (lastMsg?.type === 'builder') {
        const structSrc = lastMsg.data.structure || lastMsg.data;
        const allMods = [
          ...(structSrc.sections || []).flatMap(s => s.modules || []),
          ...(structSrc.modules || []),
          ...(structSrc.pages || []),
        ];
        const assumptionCount = [...new Set(allMods.flatMap(m => [
          ...(m.assumptions || []),
          ...(m.features || []).flatMap(f => f.assumptions || []),
        ]).filter(Boolean))].length;
        const genType = lastMsg.data?.generation_type || lastMsg.data?.structure?.generation_type || 'modules';
        const conf = state.project_context?.confidence || 0;
        const isDiff = !!(lastMsg.variant === 'diff' || lastMsg.data?.diff);
        // Restore the proposed-structure slot so insert/discard + NA behave as
        // they did pre-reload. Without this, /insert would see no proposal.
        state._proposedStructure = {
          pages:    structSrc.pages    || [],
          sections: structSrc.sections || [],
          modules:  structSrc.modules  || [],
          generation_type: genType,
          confidence: conf,
          diff: isDiff ? (lastMsg.data.diff || null) : null,
        };
        state._mode = 'builder';
        const na = resolveNextActions(`[NA:BUILDER_CARD|ASSUMPTIONS:${assumptionCount}|GENTYPE:${genType}|CONFIDENCE:${conf}|DIFF:${isDiff ? '1' : '0'}]`);
        renderNextActions(na);
      }

      // Restore context tag + input placeholder
      if (typeof updateContextTag === 'function') updateContextTag();

      // Fallback: if nothing ended up in the next-actions bar (e.g. session was
      // interrupted mid-widget or mid-depth-picker — those transient states
      // aren't persisted), render a sensible default so the user always has
      // at least one visible action.
      const naBar = document.getElementById('next-actions-bar');
      const naEmpty = !naBar || !naBar.innerHTML.trim();
      if (naEmpty) {
        let fallbackTag = null;
        if (state._proposedStructure) {
          if (typeof showBuilderCardNA === 'function') showBuilderCardNA();
        } else if (state.existing_structure?.inserted === true) {
          fallbackTag = (typeof buildBuilderInsertedTag === 'function')
            ? buildBuilderInsertedTag()
            : '[NA:GENERATE|CONFIDENCE:35]';
        } else if ((state.inputs || []).length > 0 || (state._capturedTopics || []).length > 0) {
          const conf = state.project_context?.confidence || 35;
          fallbackTag = `[NA:GENERATE|CONFIDENCE:${conf}]`;
        } else {
          fallbackTag = '[NA:EMPTY]';
        }
        if (fallbackTag) {
          const na = resolveNextActions(fallbackTag);
          if (na) renderNextActions(na);
        }
      }

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

  if (document.getElementById('project-context-panel')?.style.display === 'block') {
    renderProjectContextPanel();
  }
  renderLeftNavTree();
  if (state._selectedDetail && document.getElementById('detail-view')?.style.display !== 'none') {
    renderDetailView();
  }

  persistChat();
}

// ─── LEFT NAV TREE ──────────────────────────────────────────────────────────

function renderLeftNavTree() {
  const tree = document.getElementById('ln-tree');
  if (!tree) return;

  // The committed tree is the single source of truth — existing_structure is
  // never overwritten during diff preview. Simple gate: show when inserted.
  const s = state.existing_structure;
  if (!s?.inserted) {
    tree.style.display = 'none';
    tree.innerHTML = '';
    return;
  }

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pages    = s.pages    || [];
  const sections = s.sections || [];
  const flatMods = s.modules  || [];

  const renderModule = (m) => {
    const hasFeatures = Array.isArray(m.features) && m.features.length > 0;
    const swatch = m.color
      ? `<span class="ln-swatch" style="background:${paletteColor(m.color)};"></span>`
      : `<span class="ln-swatch ln-swatch-empty"></span>`;
    let out = `<div class="ln-row ln-module${hasFeatures ? '' : ' ln-module-leaf'}" data-type="module" data-id="${esc(m.id || '')}" title="${esc(m.name)}" onclick="onLeftNavRowClick(event, this)">`;
    out += `<span class="ln-chevron" onclick="event.stopPropagation(); this.closest('.ln-row').classList.toggle('open');">${hasFeatures ? '▶' : ''}</span>`;
    out += swatch;
    out += `<span class="ln-row-name">${esc(m.name)}</span>`;
    const dot = state._treeDots?.[m.id];
    if (dot === 'new')      out += `<span class="ln-dot ln-dot-new" aria-label="New"></span>`;
    else if (dot === 'updated') out += `<span class="ln-dot ln-dot-updated" aria-label="Updated"></span>`;
    out += `</div>`;
    if (hasFeatures) {
      out += `<div class="ln-features">`;
      m.features.forEach(f => {
        out += `<div class="ln-feature" data-type="feature" data-id="${esc(f.id || '')}" data-parent-id="${esc(m.id || '')}" title="${esc(f.name)}" onclick="onLeftNavRowClick(event, this)">${esc(f.name)}</div>`;
      });
      out += `</div>`;
    }
    return out;
  };

  let html = '';

  if (pages.length > 0) {
    html += `<div class="ln-section">Pages</div>`;
    pages.forEach(p => {
      html += `<div class="ln-row ln-page" data-type="page" data-id="${esc(p.id || '')}" title="${esc(p.name)}" onclick="onLeftNavRowClick(event, this)"><span class="ln-row-name">${esc(p.name)}</span></div>`;
    });
  }

  const hasStructure = sections.length > 0 || flatMods.length > 0;
  if (hasStructure) {
    html += `<div class="ln-section">Structure</div>`;

    if (sections.length > 0) {
      sections.forEach(sec => {
        const secMods = sec.modules || [];
        html += `<div class="ln-section-hint">${esc(sec.name)}</div>`;
        secMods.forEach(m => { html += renderModule(m); });
      });
    } else {
      flatMods.forEach(m => { html += renderModule(m); });
    }
  }

  if (!html) {
    html = `<div class="ln-empty">No structure inserted yet</div>`;
  }

  tree.innerHTML = html;
  tree.style.display = 'flex';

  // Restore active highlight if a detail is currently shown
  const sel = state._selectedDetail;
  if (sel) {
    const q = sel.type === 'feature'
      ? `.ln-feature[data-id="${CSS.escape(sel.id)}"]`
      : `.ln-row[data-type="${sel.type}"][data-id="${CSS.escape(sel.id)}"]`;
    tree.querySelector(q)?.classList.add('active');
  }
}

function onLeftNavRowClick(e, el) {
  e.stopPropagation();
  const type = el.dataset.type;
  const id   = el.dataset.id;
  if (!type || !id) return;
  // Clear the tree-dot for this module once the user has acknowledged it.
  if (type === 'module' && state._treeDots?.[id]) {
    delete state._treeDots[id];
    el.querySelector('.ln-dot')?.remove();
  }
  selectLeftNavItem(type, id);
}
window.onLeftNavRowClick = onLeftNavRowClick;

function selectLeftNavItem(type, id) {
  state._selectedDetail = { type, id };
  document.querySelectorAll('#ln-tree .active').forEach(a => a.classList.remove('active'));
  const q = type === 'feature'
    ? `.ln-feature[data-id="${CSS.escape(id)}"]`
    : `.ln-row[data-type="${type}"][data-id="${CSS.escape(id)}"]`;
  document.querySelector('#ln-tree ' + q)?.classList.add('active');
  // Mark Chat button inactive
  const chatBtn = document.getElementById('ln-chat-btn');
  if (chatBtn) { chatBtn.classList.remove('active'); chatBtn.dataset.inactive = '1'; }
  renderDetailView();
}

function showChatView() {
  state._selectedDetail = null;
  document.querySelectorAll('#ln-tree .active').forEach(a => a.classList.remove('active'));
  const chatBtn = document.getElementById('ln-chat-btn');
  if (chatBtn) { chatBtn.classList.add('active'); delete chatBtn.dataset.inactive; }
  document.getElementById('detail-view').style.display = 'none';
  document.getElementById('messages-scroll').style.display = '';
  const inputArea = document.getElementById('cb-widget-area');
  if (inputArea) inputArea.style.display = '';
}
window.showChatView = showChatView;

function findSelectedItem() {
  const sel = state._selectedDetail;
  if (!sel) return null;
  const s = state.existing_structure || {};
  if (sel.type === 'page') {
    return { kind: 'page', item: (s.pages || []).find(p => p.id === sel.id) };
  }
  const allModules = (s.sections?.flatMap(sec => sec.modules || []) || []).concat(s.modules || []);
  if (sel.type === 'module') {
    return { kind: 'module', item: allModules.find(m => m.id === sel.id) };
  }
  if (sel.type === 'feature') {
    for (const m of allModules) {
      const f = (m.features || []).find(f => f.id === sel.id);
      if (f) return { kind: 'feature', item: f, parent: m };
    }
  }
  return null;
}

// Toggles the summary-history drawer in the detail view. Works for both
// module-level summaries and per-feature summaries (via the closest
// .dv-summary-row / .dv-feature ancestor).
function toggleSummaryHistory(btn) {
  const anchor = btn.closest('.dv-feature') || btn.closest('.dv-summary-row')?.parentElement;
  if (!anchor) return;
  const drawer = anchor.querySelector(':scope > .dv-summary-history');
  if (!drawer) return;
  const hidden = drawer.style.display === 'none';
  drawer.style.display = hidden ? '' : 'none';
  btn.classList.toggle('active', hidden);
  btn.title = hidden ? 'Hide history' : 'Show history';
}
window.toggleSummaryHistory = toggleSummaryHistory;

function renderDetailView() {
  const view = document.getElementById('detail-view');
  if (!view) return;
  const found = findSelectedItem();
  if (!found?.item) {
    showChatView();
    return;
  }

  document.getElementById('messages-scroll').style.display = 'none';
  const inputArea = document.getElementById('cb-widget-area');
  if (inputArea) inputArea.style.display = 'none';
  view.style.display = '';

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const { kind, item } = found;
  const kicker = kind === 'page' ? 'Page' : kind === 'module' ? 'Module' : 'Feature';

  let html = `<div class="dv-kicker">${kicker}</div>`;
  html += `<div class="dv-title-row">`;
  if (kind === 'module' && item.color) {
    html += `<span class="dv-swatch" style="background:${paletteColor(item.color)};"></span>`;
  }
  html += `<div class="dv-title">${esc(item.name || '')}</div>`;
  html += `</div>`;

  // Summary — current text with optional history drawer (only when >=2 entries).
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const lang = (state.project_language || 'en').toLowerCase();
    try { return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(d); }
    catch (e) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(d); }
  };
  const historyIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 4v4l2.5 1.5M14 8a6 6 0 11-2.5-4.87M14 3v3h-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const summaryHistory = Array.isArray(item.summary)
      ? item.summary
      : (typeof item.summary === 'string' && item.summary.trim() ? [{ text: item.summary }] : []);
  const currentText = summaryHistory.length > 0 ? (summaryHistory[summaryHistory.length - 1].text || '') : '';
  const hasHistory = summaryHistory.length >= 2;

  if (currentText) {
    html += `<div class="dv-summary-row">
      <div class="dv-summary">${esc(currentText)}</div>
      ${hasHistory ? `<button class="dv-history-btn" onclick="toggleSummaryHistory(this)" title="Show history" aria-label="Show summary history">${historyIcon}</button>` : ''}
    </div>`;
    if (hasHistory) {
      html += `<div class="dv-summary-history" style="display:none;">`;
      html += `<div class="dv-history-label">History</div>`;
      for (let i = summaryHistory.length - 2; i >= 0; i--) {
        const e = summaryHistory[i];
        const date = e?.date ? fmtDate(e.date) : '';
        const src  = e?.source ? ` · ${esc(e.source)}` : '';
        html += `<div class="dv-history-entry">
          <div class="dv-history-entry-head">${esc(date)}${src}</div>
          <div class="dv-history-entry-text">${esc(e?.text || '')}</div>
        </div>`;
      }
      html += `</div>`;
    }
  }

  // Project-notes synthetic page → checklist
  if (item.synthetic === 'project_notes' && Array.isArray(item.checkbox_items)) {
    html += `<div class="dv-section"><div class="dv-section-label">Items</div><div class="dv-checklist">`;
    item.checkbox_items.forEach(it => {
      const title = esc(it.title || '');
      const summary = esc(it.summary || '');
      html += `<label class="dv-check-item">
        <input type="checkbox">
        <span class="dv-check-text"><strong>${title}</strong>${summary ? ` — ${summary}` : ''}</span>
      </label>`;
    });
    html += `</div></div>`;
  }

  // Open points (assumptions)
  const assumptions = item.assumptions || [];
  if (assumptions.length > 0) {
    html += `<div class="dv-section dv-open-points"><div class="dv-section-label">Open points</div>`;
    html += `<ul class="dv-list">${assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`;
    html += `</div>`;
  }

  // Features list for modules — per-feature summary history with same drawer UX.
  if (kind === 'module' && Array.isArray(item.features) && item.features.length > 0) {
    html += `<div class="dv-section"><div class="dv-section-label">Features</div>`;
    item.features.forEach(f => {
      const fHistory = Array.isArray(f.summary)
          ? f.summary
          : (typeof f.summary === 'string' && f.summary.trim() ? [{ text: f.summary }] : []);
      const fCurrent    = fHistory.length > 0 ? (fHistory[fHistory.length - 1].text || '') : '';
      const fHasHistory = fHistory.length >= 2;

      let fHistoryHtml = '';
      if (fHasHistory) {
        fHistoryHtml += `<div class="dv-summary-history" style="display:none;">`;
        fHistoryHtml += `<div class="dv-history-label">History</div>`;
        for (let i = fHistory.length - 2; i >= 0; i--) {
          const e = fHistory[i];
          const date = e?.date ? fmtDate(e.date) : '';
          const src  = e?.source ? ` · ${esc(e.source)}` : '';
          fHistoryHtml += `<div class="dv-history-entry">
            <div class="dv-history-entry-head">${esc(date)}${src}</div>
            <div class="dv-history-entry-text">${esc(e?.text || '')}</div>
          </div>`;
        }
        fHistoryHtml += `</div>`;
      }

      html += `<div class="dv-feature">
        <div class="dv-feature-head">
          <div class="dv-feature-name">${esc(f.name || '')}</div>
          ${fHasHistory ? `<button class="dv-history-btn dv-history-btn-inline" onclick="toggleSummaryHistory(this)" title="Show history" aria-label="Show feature history">${historyIcon}</button>` : ''}
        </div>
        <div class="dv-summary-row">
          ${fCurrent ? `<div class="dv-feature-summary">${esc(fCurrent)}</div>` : ''}
        </div>
        ${fHistoryHtml}
        ${(f.assumptions || []).length > 0 ? `<ul class="dv-list" style="margin-top:6px;">${(f.assumptions || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  view.innerHTML = html;
  view.scrollTop = 0;
}

// ─── CONTEXT CONFIDENCE BAR & PANEL ─────────────────────────────────────────

// Human-readable labels for topic_ids used in project_context.covered / gaps.
const TOPIC_LABELS = {
  product: 'Product', business_model: 'Business Model', payments: 'Payments',
  user_roles: 'User Roles', security: 'Security', core_features: 'Core Features',
  platform: 'Platform', integrations: 'Integrations', tech_stack: 'Tech Stack',
  infrastructure: 'Infrastructure', modules_entities: 'Modules & Entities',
  workflows: 'Workflows', reporting: 'Reporting', migration: 'Migration',
  pages_content: 'Pages & Content', target_audience: 'Target Audience',
  cms: 'CMS', seo: 'SEO', endpoints: 'Endpoints', auth: 'Authentication',
  data_model: 'Data Model', consumers: 'Consumers', rate_limiting: 'Rate Limiting',
  documentation: 'Documentation', commission_model: 'Commission Model',
  trust_safety: 'Trust & Safety', reviews_ratings: 'Reviews & Ratings',
  search: 'Search', dispute_resolution: 'Dispute Resolution',
  catalog: 'Catalog', checkout: 'Checkout', inventory: 'Inventory',
  shipping: 'Shipping', tax: 'Tax', returns: 'Returns',
  analytics: 'Analytics', monitoring: 'Monitoring', notifications: 'Notifications',
  i18n_l10n: 'i18n & l10n', accessibility: 'Accessibility',
  compliance: 'Compliance', support: 'Support', onboarding: 'Onboarding',
};

function topicLabel(id) {
  if (!id) return '';
  if (TOPIC_LABELS[id]) return TOPIC_LABELS[id];
  return String(id).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Display labels for platform_type and market_type values.
const PLATFORM_LABELS = {
  app: 'App',
  platform: 'Platform',
  website: 'Website',
  api_service: 'API Service',
  marketplace: 'Marketplace',
  ecommerce: 'eCommerce',
  saas_config: 'SaaS Config',
  automation: 'Automation',
};
const MARKET_LABELS = { b2c: 'B2C', b2b: 'B2B', internal: 'Internal' };

function platformLabel(v) {
  if (!v) return '';
  return PLATFORM_LABELS[v] || topicLabel(v);
}
function marketLabel(v) {
  if (!v) return '';
  return MARKET_LABELS[v] || String(v).toUpperCase();
}

function confidenceLevel(pct) {
  const n = Number(pct) || 0;
  if (n >= 90) return { level: 'complete',  label: 'Complete' };
  if (n >= 70) return { level: 'very-high', label: 'Detailed' };
  if (n >= 50) return { level: 'high',      label: 'Structured' };
  if (n >= 30) return { level: 'medium',    label: 'Basic' };
  return       { level: 'low',              label: 'Minimal' };
}

function updateConfidenceBar() {
  const bar = document.getElementById('context-confidence-bar');
  if (!bar) return;
  const pct = Number(state.project_context?.confidence) || 0;
  if (!state.project_context || !pct) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  const { level, label } = confidenceLevel(pct);
  const fill = document.getElementById('ccb-fill');
  fill.className = 'ccb-fill level-' + level;
  fill.style.width = Math.min(100, pct) + '%';
  document.getElementById('ccb-label').textContent = label;
  document.getElementById('ccb-percent').textContent = pct + '%';
}

function toggleProjectContextPanel() {
  const panel = document.getElementById('project-context-panel');
  const bar   = document.getElementById('context-confidence-bar');
  if (!panel) return;
  const isOpen = panel.style.display === 'block';
  if (isOpen) {
    panel.style.display = 'none';
    bar?.classList.remove('open');
  } else {
    renderProjectContextPanel();
    panel.style.display = 'block';
    bar?.classList.add('open');
  }
}

function closeProjectContextPanel() {
  document.getElementById('project-context-panel').style.display = 'none';
  document.getElementById('context-confidence-bar')?.classList.remove('open');
}

function renderProjectContextPanel() {
  const body = document.getElementById('pcp-body');
  if (!body) return;
  const ctx = state.project_context || {};
  const pct = Number(ctx.confidence) || 0;
  const { level, label } = confidenceLevel(pct);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tags = (arr, cls, transform) => {
    if (!Array.isArray(arr) || arr.length === 0) return '<div class="pcp-empty">—</div>';
    const fn = transform || (t => t);
    return `<div class="pcp-tag-row">${arr.map(t => `<span class="pcp-tag ${cls}">${esc(fn(t))}</span>`).join('')}</div>`;
  };

  const summary = ctx.summary || state.project_summary || '';

  const pmTags = [];
  if (ctx.platform_type) pmTags.push(platformLabel(ctx.platform_type));
  if (ctx.market_type)   pmTags.push(marketLabel(ctx.market_type));

  const langLabel = ctx.language
    ? ((typeof LANGUAGES !== 'undefined' ? (LANGUAGES.find(l => l.code === ctx.language)?.label) : null) || ctx.language)
    : null;
  const builtAt = ctx.built_at ? (() => { const d = new Date(ctx.built_at); return isNaN(d) ? null : d.toLocaleString(); })() : null;
  const footerParts = [];
  if (langLabel) footerParts.push(`Project Language: ${langLabel}`);
  if (builtAt)   footerParts.push(`Built at: ${builtAt}`);

  body.innerHTML = `
    <div class="pcp-conf-row">
      <span class="pcp-conf-left">Context confidence</span>
      <div class="pcp-conf-right">
        <span class="pcp-conf-label">${label}</span>
        <div class="pcp-conf-track"><div class="pcp-conf-fill level-${level}" style="width:${Math.min(100,pct)}%;background:var(--${level==='low'?'red':level==='complete'||level==='very-high'?'green':level==='high'?'amber':'amber'});"></div></div>
        <span class="pcp-conf-percent">${pct}%</span>
      </div>
    </div>

    ${summary ? `<div class="pcp-summary">${esc(summary)}</div>` : ''}

    ${(() => {
      const enrichedEmpty = !(ctx.entities?.length || ctx.covered?.length || ctx.covered_concepts?.length || ctx.gaps?.length);
      return enrichedEmpty ? `<div class="pcp-notice">Entities, covered topics, and gaps are populated once the Builder generates a structure.</div>` : '';
    })()}

    ${pmTags.length ? `
      <div class="pcp-section">
        <div class="pcp-section-label">Platform &amp; Market</div>
        ${tags(pmTags, 'meta')}
      </div>` : ''}

    <div class="pcp-section">
      <div class="pcp-section-label">Entities</div>
      ${tags(ctx.entities, 'entity')}
    </div>

    <div class="pcp-section">
      <div class="pcp-section-label">Covered</div>
      ${Array.isArray(ctx.covered_concepts) && ctx.covered_concepts.length
        ? tags(ctx.covered_concepts, 'covered')
        : tags(ctx.covered, 'covered', topicLabel)}
    </div>

    <div class="pcp-section">
      <div class="pcp-section-label">Gaps</div>
      ${tags(ctx.gaps, 'gap', topicLabel)}
    </div>

    ${footerParts.length ? `<div class="pcp-footer-hint">${footerParts.map(esc).join(' · ')}</div>` : ''}
  `;

  // Paint the inner confidence fill color using the level class (overrides inline fallback)
  const innerFill = body.querySelector('.pcp-conf-fill');
  if (innerFill) {
    innerFill.style.background = '';
    const map = { low:'var(--red)', medium:'#e08e2c', high:'#d8b82a', 'very-high':'var(--green)', complete:'var(--green)' };
    innerFill.style.background = map[level] || 'var(--accent)';
  }
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
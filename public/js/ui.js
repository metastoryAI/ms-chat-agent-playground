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
    if (p.type === 'text') html += `<div class="bubble">${escHtml(p.text)}</div>`;
  });
  el.innerHTML = html;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();
}

function addAssistantMessage(text, nextActions, action) {
  if (!_restoring) _messageLog.push({ type: 'assistant', text, nextActions: nextActions || null });
  removeAllNextActions();
  const el = document.createElement('div');
  el.className = 'msg assistant';
  let html = `<div class="bubble">${renderMarkdown(text)}</div>`;
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
  return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*<\/li>)/g, '<ul>$1</ul>')
      .replace(/<\/li>\n<li>/g, '</li><li>')
      .replace(/\n/g, '<br>');
}

function renderCtaBtn(btn) {
  const tt = btn.tooltip ? ` data-tip="${escHtml(btn.tooltip)}"` : '';
  const data = JSON.stringify(btn).replace(/"/g, '&quot;');
  return `<button class="cta-btn"${tt} onclick="handleButtonClick(this,${data})">
    <div class="btn-left">
      <span class="btn-name">${escHtml(btn.name)}</span>
      ${btn.subtext ? `<span class="btn-sub">${escHtml(btn.subtext)}</span>` : ''}
    </div>
  </button>`;
}

function renderNextActions(na) {
  if (!na) return '';
  let html = `<div class="next-actions">`;
  if (na.label) html += `<div class="next-label">${na.label}</div>`;

  if (na.buttons && na.buttons.length) {
    html += `<div class="btn-row">`;
    na.buttons.forEach(btn => { html += renderCtaBtn(btn); });
    html += `</div>`;
  }

  if (na.groups && na.groups.length) {
    na.groups.forEach(g => {
      html += `<div class="group-label">${g.label || ''}${g.subtext ? `<span class="group-sub">${escHtml(g.subtext)}</span>` : ''}</div>`;
      html += `<div class="btn-row">`;
      (g.buttons || []).forEach(btn => { html += renderCtaBtn(btn); });
      html += `</div>`;
    });
  }

  html += `</div>`;
  return html;
}

function removeAllNextActions() {
  if (_restoring) return;
  document.querySelectorAll('.next-actions').forEach(el => el.remove());
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
    state._pendingConflict = null;
    if (conflict?.source === 'document' && conflict.fileText) {
      state.free_inputs = [];
      state.documents = [];
      recomputeSummary();
      pendingFileText = conflict.fileText;
      pendingFile = { name: conflict.fileName };
      sendMessage();
    } else {
      state.free_inputs = [];
      state.documents = [];
      recomputeSummary();
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

  const STRUCTURE_GENERATION_TYPE = {
    trigger_structure_modules:          'modules',
    trigger_structure_modules_features: 'modules_features',
    trigger_structure_full:             'full',
  };
  if (btn.command in STRUCTURE_GENERATION_TYPE) {
    removeAllNextActions();
    addUserMessage([{ type: 'text', text: btn.name }]);
    handleResponse({
      action: 'route_to_agent',
      agent:  'structure_generator',
      handoff: { generation_type: STRUCTURE_GENERATION_TYPE[btn.command] },
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
  let display = { _agent: agentKey || 'chat_agent', ...payload };
  if (fileName) display._file_attached = fileName;
  _lastInput = display;
  _lastOutput = null;
  document.getElementById('debug-input').textContent = JSON.stringify(display, null, 2);
  document.getElementById('debug-output').innerHTML = '<span style="color:var(--text3)">Waiting for response...</span>';
  document.getElementById('inline-output').innerHTML = '<span style="color:var(--text3);font-size:11px;padding:8px 10px;display:block;">Waiting for response...</span>';
  renderInline('inline-input', display);
  document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-io').classList.add('active');
  document.querySelectorAll('.stab')[0].classList.add('active');
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
    agent: agentKey || 'chat_agent',
    provider: provider,
    model: getModelForAgent(agentKey || 'chat_agent'),
    input,
    output,
    total: input + output,
    time: new Date().toLocaleTimeString()
  });

  updateTokenPanel();
}

function updateTokenPanel() {
  const total = tokenStats.totalInput + tokenStats.totalOutput;

  document.getElementById('tk-total-input').textContent = tokenStats.totalInput.toLocaleString();
  document.getElementById('tk-total-output').textContent = tokenStats.totalOutput.toLocaleString();
  document.getElementById('tk-total').textContent = total.toLocaleString();
  document.getElementById('tk-requests').textContent = tokenStats.requests;

  const limit = getModelContextLimit();
  const pct = Math.min((total / limit) * 100, 100);
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
  document.getElementById('token-bar-legend').innerHTML =
      `<span>${total.toLocaleString()} tokens · <span style="color:${color};font-weight:600;">${label}</span></span><span>${limitStr}</span>`;

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

const STORAGE_KEY = 'ms_chat_session';
const STORAGE_VERSION = 3;

function persistChat() {
  try {
    if (_messageLog.length === 0) return;
    const session = {
      v: STORAGE_VERSION,
      state: {
        documents:          state.documents,
        manual_inputs:      state.manual_inputs,
        project_summary:    state.project_summary,
        project_context:    state.project_context,
        existing_structure: state.existing_structure,
        _capturedTopics:    state._capturedTopics,
      },
      docCounter,
      manualCounter,
      messageLog: _messageLog,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch(e) { /* storage full or unavailable */ }
}

function restoreChat() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);

    if (session.v !== STORAGE_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    if (session.state) {
      Object.assign(state, session.state);
      Object.assign(providerStates[provider], session.state);
    }
    if (session.docCounter)    docCounter    = session.docCounter;
    if (session.manualCounter) manualCounter = session.manualCounter;

    const log = session.messageLog;
    if (log && log.length > 0) {
      // Remove empty-state placeholder before rendering messages
      const emptyEl = document.getElementById('empty-state');
      if (emptyEl) emptyEl.remove();

      _restoring = true;
      log.forEach((msg, i) => {
        const isLast = i === log.length - 1;
        if (msg.type === 'user') {
          addUserMessage(msg.parts);
        } else if (msg.type === 'assistant') {
          // Only restore nextActions for the last message
          addAssistantMessage(msg.text, isLast ? msg.nextActions : null);
        } else if (msg.type === 'error') {
          addErrorMessage(msg.message);
        } else if (msg.type === 'structure') {
          renderStructureCard(msg.data);
        }
      });
      _restoring = false;
      _messageLog = log;
      scrollToBottom();
    }
  } catch(e) { localStorage.removeItem(STORAGE_KEY); }
}

function updateStatePanel() {
  document.getElementById('st-provider').textContent = (providerLabels[provider] || provider) + ' · ' + getSelectedModel();

  const docsEl = document.getElementById('st-docs');
  if (state.documents.length === 0) {
    docsEl.innerHTML = '<div class="state-empty">No documents yet</div>';
  } else {
    docsEl.innerHTML = state.documents.map(d => `
      <div class="doc-item">
        <div class="doc-name">${d.id} — ${d.name}</div>
        <div class="doc-summary">${(d.original_summary || '').substring(0, 100)}...</div>
      </div>`).join('');
  }

  const miEl = document.getElementById('st-manual');
  if (state.manual_inputs.length === 0) {
    miEl.innerHTML = '<div class="state-empty">No manual inputs yet</div>';
  } else {
    miEl.innerHTML = state.manual_inputs.map(m => `
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
  docCounter = 0; manualCounter = 0;
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
  localStorage.removeItem(STORAGE_KEY);
  updateTokenPanel();
  updateStatePanel();
}

function scrollToBottom() {
  const m = document.getElementById('messages-scroll');
  m.scrollTop = m.scrollHeight;
}

function escHtml(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
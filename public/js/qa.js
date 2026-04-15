// ─── Q&A WIDGET ──────────────────────────────────────────────────────────────

let _cbQuestions    = [];
let _cbCurrentIdx   = 0;
let _cbBatchAnswers = [];
let _cbResolveMode       = false; // routes submitCBBatch to submitResolvedAssumptions
let _cbEnrichMode        = false; // last question is the enrich topics picker
let _cbEnrichContextMode = false; // routes submitCBBatch to submitEnrichContext
let _cbEnrichContextSource = 'chat'; // 'chat' or 'builder'
let _cbLanguageMode      = false; // startup single-select language picker
function setEnrichContextSource(src) { _cbEnrichContextSource = src; }

// ── Dynamic padding so messages stay visible above the widget ─────────────────
(function initCBPaddingObserver() {
  window.addEventListener('DOMContentLoaded', () => {
    const area = document.getElementById('cb-widget-area');
    if (!area) return;
    const observer = new ResizeObserver(() => {
      const msgs = document.getElementById('messages');
      if (msgs) msgs.style.paddingBottom = (area.offsetHeight + 24) + 'px';
    });
    observer.observe(area);
  });
})();

// ── Enter widget mode ─────────────────────────────────────────────────────────
function showCBWidget(questions, source) {
  _cbQuestions    = questions;
  _cbCurrentIdx   = 0;
  _cbBatchAnswers = [];
  if (source) _cbEnrichContextSource = source;
  document.getElementById('chat-input-area').style.display = 'none';
  document.getElementById('cb-widget').style.display = 'block';
  renderCBQuestion();
}

// ── Render the current question ───────────────────────────────────────────────
let _cbActiveOptIdx = -1;

function renderCBQuestion() {
  const q       = _cbQuestions[_cbCurrentIdx];
  const widget  = document.getElementById('cb-widget');
  const isMulti = q.type === 'multi_select' || q.type === 'multiple_select';
  const isLast  = _cbCurrentIdx >= _cbQuestions.length - 1;
  const isEnrich = q.id === 'enrich_topics';
  const totalRows = q.options.length; // action rows added after options

  const modeLabel = _cbEnrichContextMode ? 'DISCOVERY' : _cbResolveMode ? 'RESOLVE' : '';
  const closeHandler = _cbEnrichContextMode ? 'enrichContextClose()' : 'exitContextBuilder()';

  let html = `<div class="cb-question" data-question-id="${escHtml(q.id)}" data-type="${q.type}">`;

  // Header: question + breadcrumb + tag + X
  const breadcrumb = _cbQuestions.length > 1 ? `<span class="cb-breadcrumb">${_cbCurrentIdx + 1} of ${_cbQuestions.length}</span>` : '';
  html += `<div class="cb-header-row">
    <span class="cb-question-text">${escHtml(q.text)}</span>
    <div class="cb-header-right">
      ${breadcrumb}
      ${modeLabel ? `<span class="cb-mode-tag">${modeLabel}</span>` : ''}
      <button class="cb-close-btn" onclick="${closeHandler}" title="Close">✕</button>
    </div>
  </div>`;

  // Options (filter out "something_else" from LLM options — we add our own input row)
  html += `<div class="cb-options">`;
  const filteredOpts = q.options.filter(opt => opt.id !== 'something_else' && opt.command !== 'something_else');
  let idx = 0;
  filteredOpts.forEach((opt) => {
    const check = isMulti ? `<span class="cb-opt-check"></span>` : `<span class="cb-opt-num">${idx + 1}</span>`;
    html += `<button class="cb-opt-row" data-idx="${idx}" data-value="${escHtml(opt.id)}" onclick="onCBOptClick(this, ${isMulti})">
      ${check}<span class="cb-opt-label">${escHtml(opt.label)}</span>
      <span class="cb-opt-enter">${_enterSvg}</span>
    </button>`;
    idx++;
  });

  // Always add free text input row
  const check = isMulti ? `<span class="cb-opt-check"></span>` : '';
  html += `<div class="cb-opt-row cb-opt-something" data-idx="${idx}" data-value="something_else" onclick="cbFocusSomethingElse(this)">
    ${check}<input type="text" class="cb-something-inline" placeholder="Something else..." oninput="cbOnSomethingInput(this, ${isMulti})">
    <span class="cb-opt-enter">${_enterSvg}</span>
  </div>`;
  idx++;

  // Action rows: Skip + Continue side by side
  html += `<div class="cb-action-pair">`;
  if (isEnrich) {
    html += `<div class="cb-opt-row cb-opt-action" data-idx="${idx}" data-action="skip" onclick="skipEnrich()">
      <span class="cb-opt-label cb-opt-right">Skip</span><span class="cb-opt-enter">${_enterSvg}</span>
    </div>`;
    idx++;
    html += `<div class="cb-opt-row cb-opt-action cb-opt-action-primary" data-idx="${idx}" data-action="continue" id="cb-continue-btn" onclick="continueEnrich()">
      <span class="cb-opt-label cb-opt-right">Continue →</span><span class="cb-opt-enter">${_enterSvg}</span>
    </div>`;
  } else {
    html += `<div class="cb-opt-row cb-opt-action" data-idx="${idx}" data-action="skip" onclick="cbSkipQuestion()">
      <span class="cb-opt-label cb-opt-right">Skip</span><span class="cb-opt-enter">${_enterSvg}</span>
    </div>`;
    idx++;
    html += `<div class="cb-opt-row cb-opt-action cb-opt-action-primary" data-idx="${idx}" data-action="next" onclick="advanceCBQuestion()">
      <span class="cb-opt-label cb-opt-right">Continue →</span><span class="cb-opt-enter">${_enterSvg}</span>
    </div>`;
  }
  html += `</div>`;

  html += `</div></div>`;
  widget.innerHTML = html;
  _cbActiveOptIdx = -1;

  // Restore previous answer if navigating back
  const prevAnswer = _cbBatchAnswers[_cbCurrentIdx];
  if (prevAnswer && prevAnswer.a !== 'Skipped') {
    const selectedLabels = prevAnswer.a.split(', ');
    widget.querySelectorAll('.cb-opt-row:not(.cb-opt-action):not(.cb-opt-something)').forEach(row => {
      const label = row.querySelector('.cb-opt-label')?.textContent.trim();
      if (label && selectedLabels.includes(label)) {
        row.classList.add('cb-opt-selected');
      }
    });
    // Restore inline input
    const inlineInput = widget.querySelector('.cb-something-inline');
    if (inlineInput) {
      const knownLabels = [...widget.querySelectorAll('.cb-opt-row:not(.cb-opt-action):not(.cb-opt-something) .cb-opt-label')].map(l => l.textContent.trim());
      const customAnswer = selectedLabels.find(l => !knownLabels.includes(l));
      if (customAnswer) {
        inlineInput.value = customAnswer;
        inlineInput.closest('.cb-opt-row')?.classList.add('cb-opt-selected');
      }
    }
  }

  widget.setAttribute('tabindex', '0');
  widget.focus();
  widget.onkeydown = onCBKeyDown;
  scrollToBottom();
}

function onCBOptClick(el, isMulti) {
  if (isMulti) {
    el.classList.toggle('cb-opt-selected');
    onCBOptionChange();
  } else {
    // Single-select: clear any other selected row first
    const siblings = el.parentElement?.querySelectorAll('.cb-opt-row.cb-opt-selected') || [];
    siblings.forEach(r => { if (r !== el) r.classList.remove('cb-opt-selected'); });
    el.classList.add('cb-opt-selected');
    advanceCBQuestion();
  }
}

function cbFocusSomethingElse(el) {
  const input = el.querySelector('.cb-something-inline');
  if (input) input.focus();
}

function cbOnSomethingInput(input, isMulti) {
  const row = input.closest('.cb-opt-row');
  if (isMulti) {
    row.classList.toggle('cb-opt-selected', input.value.trim().length > 0);
    onCBOptionChange();
  }
}

function cbSkipQuestion() {
  _cbBatchAnswers[_cbCurrentIdx] = { q: _cbQuestions[_cbCurrentIdx].text, a: 'Skipped' };
  _cbCurrentIdx++;
  if (_cbCurrentIdx < _cbQuestions.length) {
    renderCBQuestion();
  } else {
    submitCBBatch();
  }
}

function onCBKeyDown(e) {
  const widget = document.getElementById('cb-widget');
  const rows = [...widget.querySelectorAll('.cb-opt-row')];
  if (!rows.length) return;

  const q = _cbQuestions[_cbCurrentIdx];
  const isMulti = q.type === 'multi_select' || q.type === 'multiple_select';

  // Arrow Down/Up — navigate options + action rows
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _cbActiveOptIdx = Math.min(_cbActiveOptIdx + 1, rows.length - 1);
    rows.forEach((r, i) => r.classList.toggle('cb-opt-active', i === _cbActiveOptIdx));
    const inline = rows[_cbActiveOptIdx]?.querySelector('.cb-something-inline');
    if (inline) inline.focus(); else widget.focus();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    _cbActiveOptIdx = Math.max(_cbActiveOptIdx - 1, -1);
    rows.forEach((r, i) => r.classList.toggle('cb-opt-active', i === _cbActiveOptIdx));
    widget.focus();
    return;
  }

  // Arrow Right — next question (only if not on last)
  if (e.key === 'ArrowRight' && _cbCurrentIdx < _cbQuestions.length - 1) {
    e.preventDefault();
    // Save current answer if any, or skip
    const qEl = document.querySelector('.cb-question');
    const entry = collectQuestionAnswer(qEl);
    _cbBatchAnswers[_cbCurrentIdx] = entry || { q: q.text, a: 'Skipped' };
    _cbCurrentIdx++;
    renderCBQuestion();
    return;
  }
  // Arrow Left — prev question (only if not on first)
  if (e.key === 'ArrowLeft' && _cbCurrentIdx > 0) {
    e.preventDefault();
    _cbCurrentIdx--;
    renderCBQuestion();
    return;
  }

  // Enter
  if (e.key === 'Enter') {
    e.preventDefault();

    // Check if user is typing in the inline input
    const focusedInline = document.activeElement?.classList.contains('cb-something-inline') ? document.activeElement : null;
    if (focusedInline && focusedInline.value.trim()) {
      const row = focusedInline.closest('.cb-opt-row');
      if (isMulti) {
        row.classList.add('cb-opt-selected');
        onCBOptionChange();
      } else {
        advanceCBQuestion();
      }
      return;
    }

    // If active row exists, handle it
    if (_cbActiveOptIdx >= 0 && _cbActiveOptIdx < rows.length) {
      const row = rows[_cbActiveOptIdx];

      if (row.dataset.action) { row.click(); return; }

      const inline = row.querySelector('.cb-something-inline');
      if (inline && inline.value.trim()) {
        if (isMulti) {
          row.classList.add('cb-opt-selected');
          onCBOptionChange();
        } else {
          advanceCBQuestion();
        }
        return;
      }

      if (isMulti) {
        row.classList.toggle('cb-opt-selected');
        onCBOptionChange();
      } else {
        row.classList.add('cb-opt-selected');
        advanceCBQuestion();
      }
      return;
    }

    // No active row — check if inline input has text
    const inlineInput = widget.querySelector('.cb-something-inline');
    if (inlineInput?.value.trim()) {
      if (isMulti) {
        inlineInput.closest('.cb-opt-row').classList.add('cb-opt-selected');
        onCBOptionChange();
      } else {
        advanceCBQuestion();
      }
      return;
    }
    return;
  }

  // Escape
  if (e.key === 'Escape') {
    e.preventDefault();
    (_cbEnrichContextMode ? enrichContextClose : exitContextBuilder)();
    return;
  }
}

// ── Option change handler — enables Continue on enrich question ───────────────
function onCBOptionChange() {
  const continueBtn = document.getElementById('cb-continue-btn');
  if (!continueBtn) return;
  const anySelected = document.querySelectorAll('.cb-opt-row.cb-opt-selected').length > 0;
  continueBtn.disabled = !anySelected;
}

// ── Skip enrich — go straight to regenerate ───────────────────────────────────
function skipEnrich() {
  // No enrich topics selected — just submit what we have
  submitCBBatch();
}

// ── Continue enrich — collect selected topics, generate follow-up questions ───
async function continueEnrich() {
  const qEl = document.querySelector('.cb-question');
  const entry = collectQuestionAnswer(qEl);

  // Store enrich answer
  if (entry) _cbBatchAnswers.push(entry);

  // Get selected topic IDs
  const selectedIds = Array.from(
      document.querySelectorAll('.cb-question input[type=checkbox]:checked')
  ).map(inp => inp.value);

  if (selectedIds.length === 0) {
    submitCBBatch();
    return;
  }

  // Show loading
  const widget = document.getElementById('cb-widget');
  widget.innerHTML = `<div class="cb-loading">Generating follow-up questions...</div>`;

  // Generate enrich questions via LLM
  try {
    const payload = {
      to_agent:        'agent_interviewer',
      mode:            'enrich_context',
      enrich_topics:   selectedIds,
      project_summary: state.project_summary,
      project_context: state.project_context,
      existing_structure: state.existing_structure,
    };

    const response = await callAgent('agent_interviewer', payload, { showLoading: false });

    if (response.status === 'enrich_questions_ready' && response.enrich_questions?.length > 0) {
      // Inject enrich questions into the current flow
      const remaining = _cbQuestions.slice(_cbCurrentIdx + 1);
      _cbQuestions = [
        ..._cbQuestions.slice(0, _cbCurrentIdx + 1),
        ...response.enrich_questions,
        ...remaining
      ];
      _cbCurrentIdx++;
      renderCBQuestion();
    } else {
      submitCBBatch();
    }
  } catch (err) {
    if (err.name !== 'AbortError') addErrorMessage(err.message);
    submitCBBatch();
  }
}

// ── Collect & advance ─────────────────────────────────────────────────────────
function advanceCBQuestion() {
  const qEl = document.querySelector('.cb-question');
  if (!qEl) return;

  // Always collect inline input if it has a value
  const inlineInput = qEl.querySelector('.cb-something-inline');
  if (inlineInput?.value.trim()) {
    const row = inlineInput.closest('.cb-opt-row');
    if (row && !row.classList.contains('cb-opt-selected')) {
      row.classList.add('cb-opt-selected');
    }
  }

  const entry = collectQuestionAnswer(qEl);
  _cbBatchAnswers[_cbCurrentIdx] = entry || { q: _cbQuestions[_cbCurrentIdx]?.text || '', a: 'Skipped' };

  _cbCurrentIdx++;
  if (_cbCurrentIdx < _cbQuestions.length) {
    renderCBQuestion();
  } else {
    submitCBBatch();
  }
}

function collectQuestionAnswer(qEl) {
  const questionText = qEl.querySelector('.cb-question-text').textContent.trim();
  const type         = qEl.dataset.type;
  const labels       = [];

  // Collect selected options (exclude action rows and something-else row)
  qEl.querySelectorAll('.cb-opt-row.cb-opt-selected:not(.cb-opt-action):not(.cb-opt-something)').forEach(row => {
    const label = row.querySelector('.cb-opt-label');
    if (label) labels.push(label.textContent.trim());
  });

  // Collect "something else" inline input
  const inlineInput = qEl.querySelector('.cb-something-inline');
  if (inlineInput?.value.trim()) {
    labels.push(inlineInput.value.trim());
  }

  // Fallback: old checkbox/radio style
  if (labels.length === 0) {
    qEl.querySelectorAll('input[type=checkbox]:checked, input[type=radio]:checked').forEach(inp => {
      const label = inp.closest('label')?.querySelector('.cb-opt-label');
      if (label) labels.push(label.textContent.trim());
    });
  }

  return labels.length > 0 ? { q: questionText, a: labels.join(', ') } : null;
}

// ── Submit batch ──────────────────────────────────────────────────────────────
async function submitCBBatch() {
  if (_cbLanguageMode) {
    _cbLanguageMode = false;
    const entry = _cbBatchAnswers[0];
    const selectedRow = document.querySelector('.cb-opt-row.cb-opt-selected');
    const code = (selectedRow?.dataset.value) || (entry?.a?.toLowerCase?.()) || 'en';
    state.project_language = code;
    state._languageConfirmed = true;
    _cbQuestions    = [];
    _cbBatchAnswers = [];
    const widget = document.getElementById('cb-widget');
    widget.classList.remove('cb-widget-language');
    widget.style.display                                     = 'none';
    document.getElementById('chat-input-area').style.display = 'contents';
    updateStatePanel?.();
    if (state._pendingSendArgs) {
      const args = state._pendingSendArgs;
      state._pendingSendArgs = null;
      sendMessage(args);
    }
    return;
  }

  if (_cbResolveMode) {
    _cbResolveMode       = false;
    _cbEnrichMode        = false;
    _resolveQuestions    = _cbQuestions.slice();
    _resolveBatchAnswers = _cbBatchAnswers.slice();
    _cbBatchAnswers      = [];
    document.getElementById('cb-widget').style.display       = 'none';
    document.getElementById('chat-input-area').style.display = 'contents';
    await submitResolvedAssumptions();
    return;
  }

  if (_cbEnrichContextMode) {
    const answers = _cbBatchAnswers.slice();
    _cbEnrichContextMode = false;
    _cbEnrichMode        = false;
    _cbBatchAnswers      = [];
    document.getElementById('cb-widget').style.display       = 'none';
    document.getElementById('chat-input-area').style.display = 'contents';
    // Show Q&A summary as user bubble
    if (answers.length > 0) {
      const qaText = answers.map(a => `Q: ${a.q}\nA: ${a.a}`).join('\n\n');
      addUserMessage([{ type: 'text', text: qaText }]);
    }
    await submitEnrichContext(answers, 'enrich_completed');
    return;
  }
}

// ── Submit Enrich Context answers ─────────────────────────────────────────────
async function submitEnrichContext(answers, status) {
  if (status === 'discard') {
    await window.handleAgentResponse('agent_interviewer', { status: 'discard' });
    return;
  }
  // If no answers and closing — handle locally without LLM
  if (answers.length === 0) {
    await window.handleAgentResponse('agent_interviewer', { status: 'discard' });
    return;
  }

  const loadingEl = addLoading();
  try {
    const payload = {
      to_agent:        'agent_interviewer',
      mode:            'enrich_context',
      status:          status,
      answers:         answers,
      platform_type:   state.project_context?.platform_type || null,
      project_summary: state.project_summary,
      project_context: state.project_context,
      captured_topics: state._capturedTopics || [],
    };

    const response = await callAgent('agent_interviewer', payload, { showLoading: false });
    removeLoading(loadingEl);
    await window.handleAgentResponse('agent_interviewer', response);
  } catch (err) {
    removeLoading(loadingEl);
    if (err.name !== 'AbortError') addErrorMessage(err.message);
  }
}

// ── Exit widget ───────────────────────────────────────────────────────────────
function exitContextBuilder() {
  _cbQuestions           = [];
  _cbBatchAnswers        = [];
  _cbResolveMode         = false;
  _cbEnrichMode          = false;
  _cbEnrichContextMode   = false;
  _cbEnrichContextSource = 'chat';
  _cbLanguageMode        = false;
  state._pendingSendArgs = null;
  const cbWidget         = document.getElementById('cb-widget');
  cbWidget.classList.remove('cb-widget-language');
  cbWidget.style.display                                   = 'none';
  document.getElementById('chat-input-area').style.display = 'contents';

  // Re-show correct NA based on mode
  if (state._mode === 'builder' && state.existing_structure) {
    showStructureCardNA();
  }
}

// ── Back to chat from Enrich Context widget ───────────────────────────────────
async function enrichContextBackToChat() {
  const answers = _cbBatchAnswers.slice();
  _cbEnrichContextMode   = false;
  _cbEnrichMode          = false;
  _cbEnrichContextSource = 'chat';
  _cbBatchAnswers        = [];
  document.getElementById('cb-widget').style.display       = 'none';
  document.getElementById('chat-input-area').style.display = 'contents';
  if (answers.length > 0) {
    const qaText = answers.map(a => `Q: ${a.q}\nA: ${a.a}`).join('\n\n');
    addUserMessage([{ type: 'text', text: qaText }]);
  }
  await submitEnrichContext(answers, 'enrich_completed');
}

// ── Close (X) button — delegates to response-handler ────────────────────────
function enrichContextClose() {
  const source = _cbEnrichContextSource;
  const answers = _cbBatchAnswers.slice();
  exitContextBuilder();
  // Delegate to response-handler — qa.js should not call agent functions directly
  onEnrichContextClose(source, answers);
}
// ─── Q&A WIDGET ──────────────────────────────────────────────────────────────

let _cbQuestions    = [];
let _cbCurrentIdx   = 0;
let _cbBatchAnswers = [];
let _cbResolveMode  = false; // routes submitCBBatch to submitResolvedAssumptions
let _cbEnrichMode   = false; // last question is the enrich topics picker

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
function showCBWidget(questions) {
  _cbQuestions    = questions;
  _cbCurrentIdx   = 0;
  _cbBatchAnswers = [];
  document.getElementById('chat-input-area').style.display = 'none';
  document.getElementById('cb-widget').style.display = 'block';
  renderCBQuestion();
}

// ── Render the current question ───────────────────────────────────────────────
function renderCBQuestion() {
  const q       = _cbQuestions[_cbCurrentIdx];
  const widget  = document.getElementById('cb-widget');
  const isMulti = q.type === 'multi_select' || q.type === 'multiple_select';
  const isLast  = _cbCurrentIdx >= _cbQuestions.length - 1;
  const isEnrich = q.id === 'enrich_topics'; // special enrich picker question

  const breadcrumb = q.total_questions > 1
      ? `<span class="cb-breadcrumb">${q.question_index} of ${q.total_questions}</span>`
      : '';

  let html = `<div class="cb-question" data-question-id="${escHtml(q.id)}" data-type="${q.type}">
    <div class="cb-question-header">
      <span class="cb-question-text">${escHtml(q.text)}</span>
      ${breadcrumb}
    </div>
    <div class="cb-options">`;

  q.options.forEach(opt => {
    const inputType = isMulti ? 'checkbox' : 'radio';
    const onChange  = isMulti ? ` onchange="onCBOptionChange()"` : ' onchange="advanceCBQuestion()"';
    html += `<label class="cb-option">
      <input type="${inputType}" name="${escHtml(q.id)}" value="${escHtml(opt.id)}"${onChange}>
      <div class="cb-opt-body">
        <span class="cb-opt-label">${escHtml(opt.label)}</span>
      </div>
    </label>`;
  });

  html += `</div>`;

  // ── Enrich question: Skip + Continue buttons ──────────────────────────────
  if (isEnrich) {
    html += `<div class="cb-enrich-actions">
      <button class="cb-skip-btn" onclick="skipEnrich()">Skip — Regenerate</button>
      <button class="cb-continue-btn" id="cb-continue-btn" disabled onclick="continueEnrich()">Continue →</button>
    </div>`;
  } else if (isMulti) {
    // Regular multi_select: single Next/Continue button
    html += `<button class="cb-submit-btn" onclick="advanceCBQuestion()">${isLast ? 'Continue →' : 'Next →'}</button>`;
  }

  html += `</div>`;
  widget.innerHTML = html;
  scrollToBottom();
}

// ── Option change handler — enables Continue on enrich question ───────────────
function onCBOptionChange() {
  const continueBtn = document.getElementById('cb-continue-btn');
  if (!continueBtn) return;
  const anyChecked = document.querySelectorAll('.cb-question input[type=checkbox]:checked').length > 0;
  continueBtn.disabled = !anyChecked;
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
    const key = getActiveKey();
    const payload = {
      to_agent:        'structure_generator',
      mode:            'generate_enrich_questions',
      enrich_topics:   selectedIds,
      project_summary: state.project_summary,
      project_context: state.project_context,
      existing_structure: state.existing_structure,
    };

    showDebugInput(payload, null, 'structure_generator');
    const msg = JSON.stringify(payload, null, 2);

    let response;
    if      (provider === 'anthropic') response = await callAnthropic(key, msg, 'structure_generator');
    else if (provider === 'openai')    response = await callOpenAI(key, msg, 'structure_generator');
    else if (provider === 'gemini')    response = await callGemini(key, msg, 'structure_generator');
    else if (provider === 'kimi')      response = await callKimi(key, msg, 'structure_generator');

    showDebugOutput(response, 'structure_generator');

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
    addErrorMessage(err.message);
    submitCBBatch();
  }
}

// ── Collect & advance ─────────────────────────────────────────────────────────
function advanceCBQuestion() {
  const qEl   = document.querySelector('.cb-question');
  const entry = collectQuestionAnswer(qEl);

  if (entry) _cbBatchAnswers.push(entry);

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

  if (type === 'multi_select' || type === 'multiple_select') {
    qEl.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
      labels.push(cb.closest('label').querySelector('.cb-opt-label').textContent.trim());
    });
  } else {
    const checked = qEl.querySelector('input[type=radio]:checked');
    if (checked) {
      labels.push(checked.closest('label').querySelector('.cb-opt-label').textContent.trim());
    }
  }

  return labels.length > 0 ? { q: questionText, a: labels.join(', ') } : null;
}

// ── Submit batch ──────────────────────────────────────────────────────────────
async function submitCBBatch() {
  if (_cbResolveMode) {
    _cbResolveMode       = false;
    _cbEnrichMode        = false;
    _resolveQuestions    = _cbQuestions.slice();
    _resolveBatchAnswers = _cbBatchAnswers.slice();
    _cbBatchAnswers      = [];
    document.getElementById('cb-widget').style.display       = 'none';
    document.getElementById('chat-input-area').style.display = 'contents';
    await submitResolvedAssumptions();
  }
}

// ── Exit widget ───────────────────────────────────────────────────────────────
function exitContextBuilder() {
  _cbQuestions    = [];
  _cbBatchAnswers = [];
  _cbResolveMode  = false;
  _cbEnrichMode   = false;
  document.getElementById('cb-widget').style.display       = 'none';
  document.getElementById('chat-input-area').style.display = 'contents';
}
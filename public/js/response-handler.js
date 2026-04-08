// ─── RESPONSE HANDLING ───────────────────────────────────────────────────────

// Converts "palette-blue-light" → CSS variable value via computed style
function paletteColor(key) {
  if (!key) return 'transparent';
  // key format: palette-{name}-{light|dark}
  const parts = key.split('-'); // ['palette','blue','light']
  if (parts.length < 3) return 'transparent';
  const shade = parts[parts.length - 1];            // 'light' or 'dark'
  const name  = parts.slice(1, -1).join('-');       // 'blue' or 'grey' etc.
  const cssVar = `--palette-${name}-color-${shade}`;
  return `var(${cssVar})`;
}

function recomputeSummary() {
  state.project_summary = [
    ...state.documents.map(d => d.original_summary),
    ...state.free_inputs.map(f => f.summary),
    ...state.manual_inputs.map(m => m.detail)
  ].filter(Boolean).join(' ') || null;
}

async function handleResponse(r, userText) {

  // ── State mutations ───────────────────────────────────────────────────────

  if (r.action === 'analyze_document' && r.document) {
    docCounter++;
    const doc = { ...r.document, id: `doc_${docCounter}`, uploaded_at: new Date().toISOString() };
    state.documents.push(doc);
    recomputeSummary();
    // Store captured topics from first analyze — never overwrite after that
    if (!state._capturedTopics && r.captured_topics) {
      state._capturedTopics = r.captured_topics;
    }
  }

  if (r.action === 'analyze_input' && r.free_input) {
    const fi = { ...r.free_input, id: `fi_${Date.now()}`, added_at: new Date().toISOString() };
    state.free_inputs.push(fi);
    recomputeSummary();
    // Store captured topics from first analyze — never overwrite after that
    if (!state._capturedTopics && r.captured_topics) {
      state._capturedTopics = r.captured_topics;
    }
  }

  if (r.action === 'clarify' && r.pending_free_input) {
    state._pendingConflict = {
      source:   r.pending_free_input.source || 'text',
      summary:  r.pending_free_input.summary || '',
      fileText: pendingFileText || null,
      fileName: (pendingFile?.name) || r.pending_free_input.document_name || null,
    };
  }

  if (r.action === 'add_to_manual_input' && r.manual_input) {
    manualCounter++;
    const mi = { ...r.manual_input, id: `mi_${manualCounter}`, added_at: new Date().toISOString() };
    state.manual_inputs.push(mi);
    recomputeSummary();
  }

  if (r.action === 'modify_manual_input' && r.manual_input_modification) {
    const idx = state.manual_inputs.findIndex(
        m => m.id === r.manual_input_modification.target_id || m.topic === r.manual_input_modification.topic
    );
    if (idx !== -1) state.manual_inputs[idx].detail = r.manual_input_modification.new_detail;
    recomputeSummary();
  }

  // ── Chat response + next actions ──────────────────────────────────────────

  if (r.chat_response) {
    let nextActions = resolveNextActions(r.next_actions);

    // Fallback: if LLM omitted next_actions tag, derive from state
    if (!nextActions) {
      if (state.existing_structure) {
        nextActions = resolveNextActions('[NA:STRUCTURE_INSERTED]');
      } else if (state.free_inputs?.length > 0 || state.documents?.length > 0) {
        nextActions = resolveNextActions('[NA:GENERATE|CONFIDENCE:35]');
      }
    }

    addAssistantMessage(r.chat_response, nextActions, r.action);
  }

  // ── Route to agent ────────────────────────────────────────────────────────

  if (r.action === 'route_to_agent' && r.agent) {
    const agentKey = r.agent;
    const handoff  = r.handoff || {};

    const loadingEl = addLoading();
    try {
      const key = getActiveKey();

      const agentPayload = {
        to_agent:           agentKey,
        generation_type:    handoff.generation_type    || null,
        mode:               handoff.mode               || 'generate',
        resolve_questions:  handoff.resolve_questions  || [],
        documents:          state.documents,
        free_inputs:        state.free_inputs,
        manual_inputs:      state.manual_inputs,
        project_summary:    state.project_summary,
        project_context:    state.project_context,
        existing_structure: state.existing_structure,
      };

      showDebugInput(agentPayload, null, agentKey);
      const agentMsg = JSON.stringify(agentPayload, null, 2);

      let agentResponse;
      if      (provider === 'anthropic') agentResponse = await callAnthropic(key, agentMsg, agentKey);
      else if (provider === 'openai')    agentResponse = await callOpenAI(key, agentMsg, agentKey);
      else if (provider === 'gemini')    agentResponse = await callGemini(key, agentMsg, agentKey);
      else if (provider === 'kimi')      agentResponse = await callKimi(key, agentMsg, agentKey);

      removeLoading(loadingEl);
      showDebugOutput(agentResponse, agentKey);
      await handleAgentResponse(agentKey, agentResponse);

    } catch (err) {
      removeLoading(loadingEl);
      addErrorMessage(err.message);
      showDebugOutput({ error: err.message });
    }
  }

  updateStatePanel();
}

// ─── AGENT RESPONSE HANDLING ─────────────────────────────────────────────────

async function handleAgentResponse(agentKey, r) {

  // ── Structure Generator ───────────────────────────────────────────────────
  if (agentKey === 'structure_generator') {
    // GUARD: open_questions[] must never auto-trigger CB widget
    // They are only shown when user clicks "Resolve assumptions"
    if (r.open_questions) {
      _lastOpenQuestions = r.open_questions;
      delete r.questions; // prevent any accidental CB question handling
    }

    // Always save project_context if returned
    if (r.project_context) {
      state.project_context = r.project_context;
    }

    // completed — show structure card
    if (r.status === 'completed' || r.modules) {
      // Clear cached questions — new structure means new assumptions
      _lastOpenQuestions = [];

      state.existing_structure = {
        pages:              r.pages              || [],
        sections:           r.sections           || [],
        modules:            r.modules            || [],
        global_assumptions: r.global_assumptions || [],
        generation_type:    r.generation_type    || 'modules',
        inserted_at:        new Date().toISOString()
      };
      renderStructureCard(r);
      return; // IMPORTANT: never fall through to CB handling
    }

    // diff_completed — re-render with updated modules
    if (r.status === 'diff_completed') {
      if (r.updated_modules?.length) {
        const existing = state.existing_structure || { pages: [], modules: [] };
        const updatedIds = new Set(r.updated_modules.map(m => m.id));
        const merged = [
          ...existing.modules.filter(m => !updatedIds.has(m.id)),
          ...r.updated_modules
        ];
        state.existing_structure = { ...existing, modules: merged, inserted_at: new Date().toISOString() };
        renderStructureCard({ ...r, modules: state.existing_structure.modules, pages: state.existing_structure.pages, status: 'completed' });
      }
      return;
    }
  }

  updateStatePanel();
}

// ─── STRUCTURE CARD RENDERER ─────────────────────────────────────────────────

// ─── STRUCTURE CARD RENDERER ─────────────────────────────────────────────────

// Stores open_questions from last structure response — used by resolve card
let _lastOpenQuestions = [];

function renderStructureCard(r) {
  const pages           = r.pages            || [];
  const sections        = r.sections         || [];
  const flatModules     = r.modules          || [];
  const confidence      = r.confidence       || '?';
  const label           = r.assumption_label || '';
  const globalAssumps   = r.global_assumptions || [];
  const openQuestions   = r.open_questions   || [];

  // Store open questions for resolve card
  _lastOpenQuestions = openQuestions;

  // Count total modules across sections or flat
  const totalModules = sections.length > 0
      ? sections.reduce((sum, s) => sum + (s.modules?.length || 0), 0)
      : flatModules.length;

  // ── Header ────────────────────────────────────────────────────────────────
  let html = `<div class="structure-card" id="structure-card">`;
  html += `<div class="structure-card-header">
    <span class="structure-card-title">Generated modules</span>
    <span class="structure-card-meta">${totalModules} modules · ${confidence}% confidence</span>
  </div>`;

  // ── PAGES block (fixed header, no sections) ─────────────────────────────
  if (pages.length > 0) {
    html += `<div class="structure-block-header">Pages</div>`;
    pages.forEach(page => {
      html += renderModuleRow(page, 'structure-page');
    });
  }

  // ── MODULES block (fixed header, then sections inside) ───────────────────
  const hasModules = sections.length > 0 || flatModules.length > 0;
  if (hasModules) {
    html += `<div class="structure-block-header">Modules</div>`;

    if (sections.length > 0) {
      // sections = functional categories (single app) or app names (multi app)
      sections.forEach(sec => {
        html += `<div class="structure-section-label">${escHtml(sec.name)}</div>`;
        (sec.modules || []).forEach(mod => {
          html += renderModuleRow(mod, 'structure-module');
        });
      });
    } else {
      // flat modules — no sections from LLM, render directly
      flatModules.forEach(mod => {
        html += renderModuleRow(mod, 'structure-module');
      });
    }
  }

  // ── Global assumptions footer ─────────────────────────────────────────────
  if (globalAssumps.length > 0) {
    html += `<div class="structure-assumptions">
      <span class="structure-confidence-badge">${confidence}% confidence · ${label}</span>
      <ul class="assumption-list">
        ${globalAssumps.map(a => `<li>${escHtml(a)}</li>`).join('')}
      </ul>
    </div>`;
  }

  // ── Action buttons ────────────────────────────────────────────────────────
  // Resolve is enabled when global_assumptions exist — questions are generated on-demand
  const hasAssumptions = globalAssumps.length > 0;
  html += `<div class="structure-actions">
    <button class="structure-action-btn${!hasAssumptions ? ' structure-action-disabled' : ''}"
      ${hasAssumptions ? `onclick="handleStructureAction('resolve_assumptions')"` : 'disabled'}
      title="${hasAssumptions ? 'Resolve open assumptions to improve accuracy' : 'No open assumptions'}">
      Resolve assumptions${hasAssumptions ? ` (${globalAssumps.length})` : ''}
    </button>
    <button class="structure-action-btn" onclick="handleStructureAction('refine')">
      Refine modules
    </button>
    <button class="structure-action-btn structure-action-primary" onclick="handleStructureAction('insert')">
      Insert selected
    </button>
  </div>`;

  // resolve-card removed — resolve flow now uses cb-widget as chat message

  html += `</div>`;

  // Log for JSON persistence
  if (!_restoring) _messageLog.push({ type: 'structure', data: r });

  // Append as assistant message
  removeAllNextActions();
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = html;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();
}

// renderModulesByLabel removed — sections now come directly from LLM output

function renderModuleRow(item, cssClass) {
  const hasAssumptions = item.assumptions?.length > 0;

  // ── Expanded content ──────────────────────────────────────────────────────
  let detail = '';

  if (item.summary) {
    detail += `<div class="structure-detail-summary">${escHtml(item.summary)}</div>`;
  }

  if (hasAssumptions) {
    const items = item.assumptions.map(a => `<li>${escHtml(a)}</li>`).join('');
    detail += `<div class="structure-detail-section">
      <div class="structure-detail-label">Assumptions</div>
      <ul class="structure-detail-list">${items}</ul>
    </div>`;
  }

  const swatch = item.color ? `<span class="palette-swatch" style="background:${paletteColor(item.color)};"></span>` : '';

  return `<div class="structure-row ${cssClass}" onclick="this.classList.toggle('open')">
    <div class="structure-row-header">
      <div class="structure-row-left">
        <span class="structure-row-chevron">&#9658;</span>
        ${swatch}
        <span class="structure-row-name">${escHtml(item.name)}</span>
      </div>
      ${hasAssumptions ? `<span class="assumption-tag">assumptions</span>` : ''}
    </div>
    <div class="structure-row-summary">${detail}</div>
  </div>`;
}

// ─── STRUCTURE ACTION HANDLER ─────────────────────────────────────────────────

async function handleStructureAction(action) {

  if (action === 'insert') {
    state.existing_structure = {
      pages:       (state.existing_structure?.pages   || []),
      sections:    (state.existing_structure?.sections || []),
      modules:     (state.existing_structure?.modules  || []),
      inserted_at: new Date().toISOString()
    };
    addAssistantMessage('Structure inserted.', resolveNextActions('[NA:STRUCTURE_INSERTED]'), 'insert');
    updateStatePanel();
    return;
  }

  if (action === 'refine') {
    const input = document.getElementById('user-input');
    input.value = '';
    input.placeholder = 'What would you like to change?';
    input.focus();
    return;
  }

  if (action === 'resolve_assumptions') {
    // If we already have questions cached — show immediately (e.g. after re-render)
    if (_lastOpenQuestions.length > 0) {
      showResolveWidget(_lastOpenQuestions);
      return;
    }

    // No questions cached — make LLM call to generate them on-demand
    const globalAssumptions = state.existing_structure?.global_assumptions || [];
    if (globalAssumptions.length === 0) return;

    const loadingEl = addLoading();
    try {
      const key = getActiveKey();
      const payload = {
        to_agent:           'structure_generator',
        generation_type:    state.existing_structure?.generation_type || 'modules',
        mode:               'generate_questions',
        global_assumptions: globalAssumptions,
        project_summary:    state.project_summary,
        project_context:    state.project_context,
        existing_structure: state.existing_structure,
      };
      showDebugInput(payload, null, 'structure_generator');
      const msg = JSON.stringify(payload, null, 2);

      let response;
      if      (provider === 'anthropic') response = await callAnthropic(key, msg, 'structure_generator');
      else if (provider === 'openai')    response = await callOpenAI(key, msg, 'structure_generator');
      else if (provider === 'gemini')    response = await callGemini(key, msg, 'structure_generator');
      else if (provider === 'kimi')      response = await callKimi(key, msg, 'structure_generator');

      removeLoading(loadingEl);
      showDebugOutput(response, 'structure_generator');

      if (response.status === 'questions_ready' && response.open_questions?.length > 0) {
        _lastOpenQuestions = response.open_questions;
        showResolveWidget(_lastOpenQuestions);
      }
    } catch (err) {
      removeLoading(loadingEl);
      addErrorMessage(err.message);
    }
  }
}

// ─── RESOLVE WIDGET (reuses CB widget + renderCBQuestion) ───────────────────

// State for resolve widget
let _resolveQuestions    = [];
let _resolveCurrentIdx   = 0;
let _resolveBatchAnswers = [];

function showResolveWidget(questions) {
  // open_questions[] uses same format as CB questions[] — use showCBWidget directly
  // but override the submit to call submitResolvedAssumptions instead of submitCBBatch
  _resolveQuestions    = questions;
  _resolveCurrentIdx   = 0;
  _resolveBatchAnswers = [];

  // Patch: override advanceCBQuestion's final step to submit resolve answers
  _cbResolveMode = true;

  showCBWidget(questions);
}

// ─── RESOLVE ASSUMPTIONS CARD (legacy inline — kept for compat) ──────────────

function renderResolveCard(container, questions) {
  let html = `<div class="resolve-card-inner">
    <div class="resolve-card-header">Resolve open assumptions</div>
    <div class="resolve-card-sub">Answer to regenerate modules with more accuracy</div>`;

  questions.forEach((q, i) => {
    const isMulti = q.type === 'multi_select';
    const inputType = isMulti ? 'checkbox' : 'radio';

    html += `<div class="resolve-question" data-qid="${escHtml(q.id)}">
      <div class="resolve-question-meta">
        <span class="resolve-module-name">${escHtml(q.element_name)}</span>
      </div>
      <div class="resolve-question-text">${escHtml(q.question)}</div>
      <div class="resolve-options">`;

    (q.options || []).forEach(opt => {
      html += `<label class="resolve-option">
        <input type="${inputType}" name="rq_${escHtml(q.id)}" value="${escHtml(opt.id)}">
        <span class="resolve-option-label">${escHtml(opt.label)}</span>
      </label>`;
    });

    html += `</div>
      <input type="hidden" class="resolve-q-meta"
        data-qid="${escHtml(q.id)}"
        data-element-id="${escHtml(q.element_id)}"
        data-assumption="${escHtml(q.assumption)}">
    </div>`;
  });

  html += `<div class="resolve-card-actions">
    <button class="resolve-submit-btn" onclick="submitResolvedAssumptions()">
      Regenerate modules →
    </button>
  </div></div>`;

  container.innerHTML = html;
}

async function submitResolvedAssumptions() {
  // _resolveBatchAnswers comes from CB widget in resolve mode
  // CB stores {q: questionText, a: answerLabel} — map to resolve format using _resolveQuestions
  const answers = _resolveBatchAnswers.map((batch, i) => {
    const q = _resolveQuestions[i] || {};
    return {
      id:         q.id         || `oq_${i}`,
      element_id: q.element_id || '',
      assumption: q.assumption || batch.q,
      answer:     batch.a,
    };
  }).filter(a => a.answer);

  // Reset resolve state
  _resolveQuestions    = [];
  _resolveCurrentIdx   = 0;
  _resolveBatchAnswers = [];

  if (answers.length === 0) return;

  // Show as user message
  const text = answers.map(a => `${a.assumption} → ${a.answer}`).join('\n');
  addUserMessage([{ type: 'text', text: text }]);

  // Determine generation_type from existing structure
  const genType = state.existing_structure?.generation_type || 'modules';

  const loadingEl = addLoading();
  try {
    const key = getActiveKey();
    // Separate resolve answers from enrich answers
    const resolveAnswers = answers.filter(a => !a.id?.startsWith('eq_') && a.id !== 'enrich_topics');
    const enrichAnswers  = answers.filter(a => a.id?.startsWith('eq_'));

    const payload = {
      to_agent:           'structure_generator',
      generation_type:    genType,
      mode:               'resolve',
      resolve_questions:  resolveAnswers,
      enrich_answers:     enrichAnswers.length > 0 ? enrichAnswers : [],
      documents:          state.documents,
      free_inputs:        state.free_inputs,
      manual_inputs:      state.manual_inputs,
      project_summary:    state.project_summary,
      project_context:    state.project_context,
      existing_structure: state.existing_structure,
    };

    showDebugInput(payload, null, 'structure_generator');
    const msg = JSON.stringify(payload, null, 2);

    let response;
    if      (provider === 'anthropic') response = await callAnthropic(key, msg, 'structure_generator');
    else if (provider === 'openai')    response = await callOpenAI(key, msg, 'structure_generator');
    else if (provider === 'gemini')    response = await callGemini(key, msg, 'structure_generator');
    else if (provider === 'kimi')      response = await callKimi(key, msg, 'structure_generator');

    removeLoading(loadingEl);
    showDebugOutput(response, 'structure_generator');
    await handleAgentResponse('structure_generator', response);
  } catch (err) {
    removeLoading(loadingEl);
    addErrorMessage(err.message);
  }
}
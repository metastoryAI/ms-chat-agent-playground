// ─── RESPONSE HANDLING ───────────────────────────────────────────────────────

// Hide action buttons on all previous builder cards so they can't be reused
function disablePreviousStructureCards() {
  removeAllNextActions();
}

// Module color palette — assigned by frontend (deterministic, token-free).
// Order matches the CSS variables in styles.css.
const MODULE_COLORS = [
  'palette-purple-light',
  'palette-blue-light',
  'palette-green-light',
  'palette-teal-light',
  'palette-yellow-light',
  'palette-red-light',
  'palette-grey-light',
  'palette-purple-dark',
  'palette-blue-dark',
  'palette-green-dark',
  'palette-teal-dark',
  'palette-yellow-dark',
  'palette-red-dark',
  'palette-grey-dark',
];

// Assign sequential colors to all modules across sections.
// Preserves colors of modules that already existed in `existingStructure` (by id),
// assigns the next unused index to new modules. Pages do not get a color.
function assignModuleColors(sections, flatModules, existingStructure) {
  const existingColors = new Map();
  if (existingStructure) {
    const prevMods = [
      ...(existingStructure.sections?.flatMap(s => s.modules || []) || []),
      ...(existingStructure.modules || []),
    ];
    for (const m of prevMods) {
      if (m?.id && m.color) existingColors.set(m.id, m.color);
    }
  }

  let maxUsedIndex = -1;
  existingColors.forEach(c => {
    const idx = MODULE_COLORS.indexOf(c);
    if (idx > maxUsedIndex) maxUsedIndex = idx;
  });
  let nextIndex = maxUsedIndex + 1;

  const assign = (m) => {
    if (!m) return;
    if (m.id && existingColors.has(m.id)) {
      m.color = existingColors.get(m.id);
    } else {
      m.color = MODULE_COLORS[nextIndex % MODULE_COLORS.length];
      nextIndex++;
    }
  };

  (sections || []).forEach(sec => (sec.modules || []).forEach(assign));
  (flatModules || []).forEach(assign);
}

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
  // Fallback only — used when LLM does not return project_summary
  state.project_summary = state.inputs.map(i => i.summary || i.detail).filter(Boolean).join(' ') || null;
}

function applyProjectSummary(r) {
  // Option A: use LLM-synthesized summary if present, else fallback to recompute
  if (r.project_summary) {
    state.project_summary = r.project_summary;
  } else {
    recomputeSummary();
  }
}

function topicTitle(t) {
  if (typeof t === 'object' && t !== null) return String(t.title || t.text || '').trim();
  return String(t || '').trim();
}
function topicSummary(t) {
  if (typeof t === 'object' && t !== null) return String(t.summary || '').trim();
  return '';
}
function topicStatus(t) {
  if (typeof t === 'object' && t !== null) return t.status || null;
  return null;
}
function topicKey(t) {
  return topicTitle(t).toLowerCase();
}
function normalizeTopic(t) {
  if (typeof t === 'object' && t !== null) {
    const out = { title: topicTitle(t), summary: topicSummary(t) };
    if (t.status) out.status = t.status;
    if (t.source) out.source = t.source;
    return out;
  }
  return { title: String(t || '').trim(), summary: '' };
}
// When an action (modify/remove) returns a full replacement captured_topics list,
// the LLM usually drops the `source` field. Re-attach each source from the
// previous state by lowercased-title match so grouping stays intact.
function preserveTopicSource(incoming, existing) {
  const sourceByTitle = new Map();
  for (const t of (existing || [])) {
    if (typeof t === 'object' && t && t.source) sourceByTitle.set(topicKey(t), t.source);
  }
  return (incoming || []).map(t => {
    const norm = normalizeTopic(t);
    if (!norm.source) {
      const src = sourceByTitle.get(topicKey(norm));
      if (src) norm.source = src;
    }
    return norm;
  });
}

function mergeTopics(existing, incoming) {
  const map = new Map();
  for (const t of existing) {
    const k = topicKey(t);
    if (k) map.set(k, normalizeTopic(t));
  }
  for (const t of incoming) {
    const k = topicKey(t);
    if (!k) continue;
    if (!map.has(k)) map.set(k, normalizeTopic(t));
  }
  return Array.from(map.values());
}

async function handleResponse(r, userText) {

  // ── Hoist inputs[*].X lists to top-level for the existing flat-state code.
  // The new prompt envelope nests captured_topics / decisions / open_points /
  // project_notes / entities inside each inputs[] entry. Aggregate across
  // entries when the top-level slot is empty, so legacy parsing keeps working.
  if (Array.isArray(r?.inputs) && r.inputs.length > 0) {
    const _aggField = (field) => {
      const out = [];
      for (const entry of r.inputs) {
        if (Array.isArray(entry?.[field])) out.push(...entry[field]);
      }
      return out;
    };
    for (const f of ['captured_topics', 'decisions', 'open_points', 'project_notes', 'entities']) {
      if (!Array.isArray(r[f]) || r[f].length === 0) {
        const agg = _aggField(f);
        if (agg.length) r[f] = agg;
      }
    }
  }

  // ── Language change — replace lists instead of merging ─────────────────
  const _isLanguageChange = typeof userText === 'string' && userText.startsWith('Language changed to');
  if (_isLanguageChange) {
    state._capturedTopics = [];
    state._openPoints     = [];
    state._projectNotes   = [];
    state._decisions      = [];
    state._entities       = [];
  }

  // ── NEW/UPDATED tags (ephemeral — rebuilt every turn so tags fade) ───────
  // Covers captured_topics, open_points, project_notes in one map keyed by title.
  // Also strip any stale `status` from existing state items so the badge never
  // persists across turns — the map alone decides which badge shows this turn.
  const _stripStatus = (arr) => (arr || []).map(t => {
    if (typeof t !== 'object' || t === null || !t.status) return t;
    const { status, ...rest } = t;
    return rest;
  });
  state._capturedTopics = _stripStatus(state._capturedTopics);
  state._openPoints     = _stripStatus(state._openPoints);
  state._projectNotes   = _stripStatus(state._projectNotes);
  state._decisions      = _stripStatus(state._decisions);
  state._entities       = _stripStatus(state._entities);

  state._topicTags = {};
  const _collectTags = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const t of arr) {
      const status = topicStatus(t);
      if (status) state._topicTags[topicKey(t)] = status.toUpperCase();
    }
  };
  _collectTags(r.captured_topics);
  _collectTags(r.open_points);
  _collectTags(r.project_notes);

  // ── State mutations ───────────────────────────────────────────────────────

  if (r.action === 'analyze_document') {
    // Accept both r.inputs[] (new multi-file shape) and legacy r.input (single)
    const docs = Array.isArray(r.inputs) ? r.inputs : (r.input ? [r.input] : []);
    // Match uploads to LLM-returned entries. Prefer name-match (LLM should echo
    // the exact filename); fall back to index (LLM returns docs in upload order).
    const uploads = (pendingFileTexts || []);
    const textByName = new Map();
    for (const f of uploads) if (f.name) textByName.set(f.name, f.text);
    for (let i = 0; i < docs.length; i++) {
      const inp = docs[i];
      docCounter++;
      const text = textByName.get(inp.name) || uploads[i]?.text || null;
      // If LLM renamed the doc, use the real filename from the upload
      const name = textByName.has(inp.name) ? inp.name : (uploads[i]?.name || inp.name);
      const doc = {
        ...inp,
        name,
        source: 'document',
        id: `doc_${docCounter}`,
        added_at: new Date().toISOString(),
        text,
      };
      state.inputs.push(doc);
    }
    if (docs.length > 0) {
      applyProjectSummary(r);
      if (r.captured_topics?.length) {
        // Tag topics from this turn with the uploaded doc as source, so the
        // context card can group them per document when there are multiple.
        // Single-upload turn → all topics from that one doc. Multi-upload →
        // comma-join the filenames uploaded in this turn (LLM can't disambiguate).
        const turnSource = uploads.map(u => u.name).filter(Boolean).join(', ');
        const tagged = r.captured_topics.map(t => {
          if (typeof t !== 'object' || t === null) return t;
          if (t.source) return t;
          return turnSource ? { ...t, source: turnSource } : t;
        });
        state._capturedTopics = mergeTopics(state._capturedTopics || [], tagged);
      }
    }
  }

  if (r.action === 'analyze_input') {
    // New ANALYZE prompt emits `inputs[]` (array, size 1). Legacy shape was `input` (singular).
    const fiInput = r.input || (Array.isArray(r.inputs) ? r.inputs[0] : null);
    if (fiInput) {
      const fi = { ...fiInput, source: 'text', id: `fi_${Date.now()}`, added_at: new Date().toISOString() };
      state.inputs.push(fi);
      applyProjectSummary(r);
      if (r.captured_topics?.length) {
        state._capturedTopics = mergeTopics(state._capturedTopics || [], r.captured_topics);
      }
    }
  }

  if (r.action === 'clarify' && r.pending_free_input) {
    const _conflictDocName = r.pending_free_input.document_name || null;
    const _conflictFile = _conflictDocName
        ? (pendingFileTexts || []).find(f => f.name === _conflictDocName)
        : (pendingFileTexts || [])[0];
    state._pendingConflict = {
      source:   r.pending_free_input.source || 'text',
      summary:  r.pending_free_input.summary || '',
      fileText: _conflictFile?.text || null,
      fileName: _conflictFile?.name || _conflictDocName,
    };
  }

  // ADD_INPUT — the new ANALYZE_ACTION_ADD_INPUT prompt always emits exactly
  // ONE new entry in `inputs[]`, with the relevant nested list populated
  // (chosen by `target`). The shape is identical regardless of target:
  //   target=input          → captured_topics filled
  //   target=captured_topic → captured_topics filled
  //   target=decision       → decisions filled
  //   target=open_point     → open_points filled
  //   target=project_note   → project_notes filled
  //   target=entity         → entities filled
  // So we run ONE merge path for any target — the hoister already lifted
  // inputs[0].X to top-level r.X, and we just fan that out to the flat state.
  if (r.action === 'add_input') {
    const miInput = r.input || (Array.isArray(r.inputs) ? r.inputs[0] : null);
    if (miInput) {
      const miId = `mi_${Date.now()}`;
      const mi = { ...miInput, source: 'additional', id: miId, added_at: new Date().toISOString() };
      state.inputs.push(mi);
      applyProjectSummary(r);

      // Tag each merged item with the new input's id as `source`. Without this
      // the right-rail Doc-tab filter hides the item (an unsourced item is
      // treated as "not in this document"), and the user only sees it after
      // manually switching to the Additions tab.
      const _tagWithSource = (list) => (list || []).map(t => (
        typeof t === 'object' && t !== null && !t.source ? { ...t, source: miId } : t
      ));

      if (r.captured_topics?.length) {
        state._capturedTopics = mergeTopics(state._capturedTopics || [], _tagWithSource(r.captured_topics));
      } else if (miInput.topic) {
        // Legacy r.input shape (singular, no nested captured_topics) — synthesize a topic
        const fallback = { title: miInput.topic, summary: String(miInput.detail || '').split(' ').slice(0, 8).join(' '), source: miId };
        state._capturedTopics = mergeTopics(state._capturedTopics || [], [fallback]);
      }
      if (r.decisions?.length)     state._decisions    = mergeTopics(state._decisions    || [], _tagWithSource(r.decisions));
      if (r.open_points?.length)   state._openPoints   = mergeTopics(state._openPoints   || [], _tagWithSource(r.open_points));
      if (r.project_notes?.length) state._projectNotes = mergeTopics(state._projectNotes || [], _tagWithSource(r.project_notes));
      if (r.entities?.length)      state._entities     = [...(state._entities || []), ..._tagWithSource(r.entities)];

      // Mark every freshly added item as NEW so the badge shows next to its title.
      const _markNew = (list) => (list || []).forEach(t => {
        const key = String(typeof t === 'object' ? (t.title || t.name) : t || '').toLowerCase();
        if (key) state._topicTags[key] = 'NEW';
      });
      _markNew(r.captured_topics);
      _markNew(r.decisions);
      _markNew(r.open_points);
      _markNew(r.project_notes);
      _markNew(r.entities);

      // Switch the right-rail to the Additions tab so the user sees the new
      // content immediately. The badge stays until the user clicks any tab.
      state._activeContextDoc = '__added__';
      state._addedTabHasNew   = true;
    }
  }

  if (r.action === 'modify_input') {
    const target = r.target || 'input';
    const titleKey = String(r.target_title || '').toLowerCase();
    const applyEdit = (list) => (list || []).map(p => {
      if (typeof p !== 'object' || p === null) return p;
      if (String(p.title || '').toLowerCase() !== titleKey) return p;
      const nextTitle = r.new_title ? String(r.new_title).trim() : p.title;
      const nextSummary = r.new_summary != null ? String(r.new_summary).trim() : p.summary;
      return { ...p, title: nextTitle, summary: nextSummary };
    });
    if (target === 'open_point') {
      state._openPoints = applyEdit(state._openPoints);
      const newKey = String(r.new_title || r.target_title || '').toLowerCase();
      if (titleKey) state._topicTags[titleKey] = 'UPDATED';
      if (newKey && newKey !== titleKey) state._topicTags[newKey] = 'UPDATED';
    } else if (target === 'project_note') {
      state._projectNotes = applyEdit(state._projectNotes);
      const newKey = String(r.new_title || r.target_title || '').toLowerCase();
      if (titleKey) state._topicTags[titleKey] = 'UPDATED';
      if (newKey && newKey !== titleKey) state._topicTags[newKey] = 'UPDATED';
    } else if (target === 'captured_topic') {
      state._capturedTopics = applyEdit(state._capturedTopics);
      const newKey = String(r.new_title || r.target_title || '').toLowerCase();
      if (titleKey) state._topicTags[titleKey] = 'UPDATED';
      if (newKey && newKey !== titleKey) state._topicTags[newKey] = 'UPDATED';
    } else if (r.input_modification) {
      const im = r.input_modification;
      const idx = state.inputs.findIndex(
          i => i.source === 'additional' && (i.id === im.target_id || i.topic === im.topic)
      );
      if (idx !== -1) state.inputs[idx].detail = im.new_detail;
      applyProjectSummary(r);
      if (Array.isArray(r.captured_topics)) {
        state._capturedTopics = preserveTopicSource(r.captured_topics, state._capturedTopics);
      }
    }
  }

  if (r.action === 'remove_input') {
    const target = r.target || 'input';
    const titleKey = String(r.target_title || r.removed_topic || '').toLowerCase();
    const byTitle = (p) => typeof p === 'object' && p !== null && String(p.title || '').toLowerCase() === titleKey;
    if (target === 'open_point') {
      state._openPoints = (state._openPoints || []).filter(p => !byTitle(p));
    } else if (target === 'project_note') {
      state._projectNotes = (state._projectNotes || []).filter(p => !byTitle(p));
    } else if (target === 'captured_topic') {
      state._capturedTopics = (state._capturedTopics || []).filter(p => !byTitle(p));
    } else {
      if (r.target_id) {
        state.inputs = state.inputs.filter(i => i.id !== r.target_id);
      } else if (titleKey) {
        state.inputs = state.inputs.filter(
            i => !(i.source === 'additional' && i.topic?.toLowerCase() === titleKey)
        );
      }
      applyProjectSummary(r);
      if (Array.isArray(r.captured_topics)) {
        state._capturedTopics = preserveTopicSource(r.captured_topics, state._capturedTopics);
      }
    }
  }

  // ── Chat response + next actions ──────────────────────────────────────────

  // Helper: merge two lists of `{ title, summary }` objects by lowercased title
  const _dedupeMerge = (existing, incoming) => {
    const normalize = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const getKey = (p) => normalize(typeof p === 'object' ? (p.title || '') : p);
    const seen = new Set();
    const merged = [];
    for (const p of [...(existing || []), ...(incoming || [])]) {
      const k = getKey(p);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(p);
    }
    return merged;
  };

  // Apply echoed derived lists from the chat agent.
  // For remove_input, the action branch already did the explicit removal —
  // skip the merge here to avoid re-adding items via the LLM's echoed list.
  if (r.open_points !== undefined && r.action !== 'remove_input') {
    state._openPoints = _dedupeMerge(state._openPoints, r.open_points);
  }
  if (r.project_notes !== undefined && r.action !== 'remove_input') {
    state._projectNotes = _dedupeMerge(state._projectNotes, r.project_notes);
  }
  // Decisions: keyed by `title`; same dedupe contract as open_points.
  if (r.decisions !== undefined && r.action !== 'remove_input') {
    state._decisions = _dedupeMerge(state._decisions, r.decisions);
  }
  // Entities: dedupeMerge keys off `title`; entities use `name` instead.
  // Pre-map name → title for the dedupe pass, then strip the synthetic title back.
  if (r.entities !== undefined && r.action !== 'remove_input') {
    const _withTitle = (arr) => (arr || []).map(e => (
      e && typeof e === 'object' && e.name && !e.title ? { ...e, title: e.name } : e
    ));
    const merged = _dedupeMerge(_withTitle(state._entities), _withTitle(r.entities));
    state._entities = merged.map(e => {
      if (e && typeof e === 'object' && e.name && e.title === e.name) {
        const { title, ...rest } = e;
        return rest;
      }
      return e;
    });
  }

  // Store project_context from chat agent (confidence, platform_type, market_type)
  if (r.project_context) {
    if (!state.project_context) {
      state.project_context = r.project_context;
    } else {
      // Merge — keep existing rich fields, update confidence and types
      state.project_context = { ...state.project_context, ...r.project_context };
    }
    // Auto-detect language from first response
    if (r.project_context.language) {
      applyDetectedLanguage(r.project_context.language);
    }
  }

  const _hasChat = r.chat_response && (typeof r.chat_response === 'string' ? r.chat_response : r.chat_response.text);
  if (_hasChat) {
    // Override: once a structure is inserted, REFINE is the source of
    // truth for next-actions — regardless of whatever GENERATE/etc. tag the chat
    // agent returned (it doesn't know about the inserted tree). /regenerate
    // appears automatically inside REFINE when new input was added
    // after inserted_at.
    let nextActions;
    if (state.existing_structure?.inserted === true && r.action !== 'answer') {
      nextActions = resolveNextActions(buildBuilderInsertedTag());
    } else {
      nextActions = resolveNextActions(r.next_actions);
    }

    // `answer` action normally hides the next-actions bar — the hint points the user to `/`.
    // EXCEPTION: onboarding variant (no inputs yet). Show the EMPTY NA so the user
    // can directly click "Upload Document" / "Describe Your Project".
    if (r.action === 'answer') {
      const hasInputs = (state.inputs || []).some(i => i.source === 'document' || i.source === 'text');
      nextActions = (!hasInputs && !state.project_summary)
          ? resolveNextActions('[NA:EMPTY]')
          : null;
    } else if (!nextActions) {
      // Fallback: if LLM omitted next_actions tag for any non-answer action, derive from state.
      if (state.existing_structure?.inserted === true) {
        nextActions = resolveNextActions(buildBuilderInsertedTag());
      } else if (state.inputs.some(i => i.source === 'text' || i.source === 'document')) {
        nextActions = resolveNextActions('[NA:GENERATE|CONFIDENCE:35]');
      }
    }

    // Per-doc open-point extraction — each doc extracts independently in parallel.
    // New uploads only: extract just the docs attached to this turn, not the ones
    // already analyzed in previous turns.
    const newDocs = (state.inputs || [])
        .filter(i => i.source === 'document' && i.text)
        .slice(-(pendingFileTexts?.length || 0));
    const willExtractOpenPoints = r.action === 'analyze_document' && newDocs.length > 0;
    if (willExtractOpenPoints) {
      if ((state._openPointsLoadingCount || 0) === 0) state._openPointsLoadingStart = Date.now();
      state._openPointsLoadingCount = (state._openPointsLoadingCount || 0) + newDocs.length;
      // Per-doc loading set so the multi-doc tab bar can show a spinner per doc.
      if (!state._docLoadingNames) state._docLoadingNames = new Set();
      newDocs.forEach(d => state._docLoadingNames.add(d.name));
      // Default the active context doc to the newest one being analyzed.
      state._activeContextDoc = newDocs[newDocs.length - 1].name;
    }

    // While extraction is pending, defer the NA bar and hint text — they reappear
    // once all extractions complete (see the .finally chain below).
    let _passNextActions = nextActions;
    let _passText        = r.chat_response;
    if (willExtractOpenPoints) {
      state._pendingPostExtractNA = nextActions;
      _passNextActions = null;
      if (typeof r.chat_response === 'object' && r.chat_response && r.chat_response.hint) {
        state._pendingPostExtractHint = r.chat_response.hint;
        _passText = { text: r.chat_response.text, hint: null };
      }
    }

    addAssistantMessage(_passText, _passNextActions, r.action);

    // For answer mode: if we didn't already render a visible NA (onboarding EMPTY),
    // populate the bar with state-derived commands but keep it hidden — typing `/`
    // reveals it. Skip when nextActions was already shown above.
    if (r.action === 'answer' && !nextActions) {
      populateHiddenNextActions();
    }

    // ── Per-doc detail extraction (parallel) ─────────────────────────────
    if (willExtractOpenPoints) {
      for (const d of newDocs) {
        extractDetailsForDoc({ name: d.name, text: d.text }).finally(() => {
          state._openPointsLoadingCount = Math.max(0, (state._openPointsLoadingCount || 1) - 1);
          if (state._docLoadingNames) state._docLoadingNames.delete(d.name);
          if (state._openPointsLoadingCount === 0) {
            state._openPointsLoadingStart = null;
            finalizePostExtraction();
          }
          refreshContextCardInLastMessage();
        });
      }
    }
  }

  // ── Route to agent ────────────────────────────────────────────────────────

  if (r.action === 'route_to_agent' && r.agent) {
    const agentKey = r.agent;
    const handoff  = r.handoff || {};

    // Auto-set mode based on existing_structure.inserted and generation_type
    const _autoMode = (() => {
      if (handoff.mode) return handoff.mode;
      if (agentKey === 'builder') {
        if (state.existing_structure?.inserted === true) return 'diff';
        if (handoff.generation_type === 'modules_features') return 'generate_modules_features';
        return 'generate_modules';
      }
      if (agentKey === 'interview') {
        return 'enrich_context';
      }
      return 'generate_modules';
    })();

    // Route-to-agent dispatches go to builder or interview. Each agent receives
    // only what its prompt INPUT spec demands.
    const agentPayload = agentKey === 'interview'
      ? payloadForInterview({
          mode:  _autoMode,
          phase: handoff.phase || 'questions',
          depth: handoff.depth || null,
        })
      : payloadForBuilder({
          mode:              _autoMode,
          generation_type:   handoff.generation_type
                              || state.existing_structure?.generation_type
                              || 'modules',
          resolve_questions: handoff.resolve_questions || null,
          user_input:        handoff.user_input || null,
        });

    try {
      // Single bundled call — mode-prompts map for `generate_modules` / `generate_modules_features`
      // concatenates pages + modules + a merge footer so the LLM returns both slots at once.
      const agentResponse = await callAgent(agentKey, agentPayload, { setModelLabel: true });

      // add_features: merge the returned features into the existing inserted tree.
      // Modules are locked — only `features[]` per module is updated. No new builder
      // card is rendered; the tree view refreshes in place.
      if (agentKey === 'builder' && _autoMode === 'add_features') {
        const resp = agentResponse || {};
        const respSections = resp.sections
            || resp.structure?.sections
            || [];
        const respFlatMods = resp.modules
            || resp.structure?.modules
            || [];

        // Build a flat lookup of returned features by module id.
        const featuresById = new Map();
        for (const sec of respSections) {
          for (const m of (sec.modules || [])) {
            if (m && m.id) featuresById.set(m.id, m.features || []);
          }
        }
        for (const m of respFlatMods) {
          if (m && m.id) featuresById.set(m.id, m.features || []);
        }

        // Apply to existing_structure (in place) across sections, flat modules, and pages.
        const applyFeaturesTo = (mod) => {
          if (featuresById.has(mod.id)) mod.features = featuresById.get(mod.id);
        };
        (state.existing_structure?.sections || []).forEach(sec =>
          (sec.modules || []).forEach(applyFeaturesTo)
        );
        (state.existing_structure?.modules || []).forEach(applyFeaturesTo);

        // Promote generation_type so the REFINE NA reflects the new shape.
        if (state.existing_structure) {
          state.existing_structure.generation_type = 'modules_features';
        }
        state._mode = 'chat';
        updateContextTag();

        // Count modules/features for the confirmation message.
        const allMods = [
          ...((state.existing_structure?.sections || []).flatMap(s => s.modules || [])),
          ...(state.existing_structure?.modules || []),
        ];
        const modulesWithFeaturesCount = allMods.filter(m => (m.features?.length || 0) > 0).length;
        const totalFeatureCount = allMods.reduce((sum, m) => sum + (m.features?.length || 0), 0);

        const headline = `✅ Features added to ${modulesWithFeaturesCount} module${modulesWithFeaturesCount !== 1 ? 's' : ''} (${totalFeatureCount} feature${totalFeatureCount !== 1 ? 's' : ''} total).`;
        const bullets = [
          '• Upload more documents or meeting transcripts',
          '• Enrich your context with discovery questions',
          '• Generate descriptions, user stories, or estimations',
        ].join('\n');
        const msg = `**${headline}**\n\n**🚀 What's next?**\n\n${bullets}`;
        addAssistantMessage(
          { text: msg, hint: null },
          resolveNextActions(buildBuilderInsertedTag()),
          'insert'
        );
        if (typeof renderLeftNavTree === 'function') renderLeftNavTree();
        updateStatePanel();
        return;
      }

      if (agentKey === 'builder' && (_autoMode === 'generate_modules' || _autoMode === 'generate_modules_features')) {
        // Normalize top-level pages/sections into the envelope the handler expects.
        // Builder's atomic/bundled output doesn't carry project_context or confidence —
        // inherit those from the current state (set by chat agent during analyze_*).
        const normalized = {
          ...agentResponse,
          status:          agentResponse.status || 'completed',
          generation_type: handoff.generation_type || (_autoMode === 'generate_modules_features' ? 'modules_features' : 'modules'),
          confidence:      agentResponse.confidence ?? state.project_context?.confidence ?? 0,
          project_context: agentResponse.project_context || state.project_context,
          structure: agentResponse.structure || {
            pages:    agentResponse.pages    || [],
            sections: agentResponse.sections || [],
            modules:  agentResponse.modules  || [],
          },
        };
        await handleAgentResponse(agentKey, normalized);
      } else {
        await handleAgentResponse(agentKey, agentResponse);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        addErrorMessage(err.message);
        showDebugOutput({ error: err.message });
      }
    }
  }

  updateStatePanel();
}

// ─── DETAIL EXTRACTION (separate call per document, parallel) ──────────────
// Mines decisions, open_points, project_notes, and entities from each input.
// Runs alongside analyze_document/analyze_input on the same input id.

// Once all extract_details calls have completed, restore the deferred NA
// bar + hint text and unlock the chat input.
function finalizePostExtraction() {
  // Restore NA bar
  const deferredNA = state._pendingPostExtractNA;
  if (deferredNA) {
    renderNextActions(deferredNA);
    state._pendingPostExtractNA = null;
  }
  // Append the deferred hint text to the last assistant message
  const deferredHint = state._pendingPostExtractHint;
  if (deferredHint) {
    const msgs = document.querySelectorAll('.msg.assistant');
    const last = msgs[msgs.length - 1];
    if (last && !last.querySelector('.chat-hint')) {
      const hint = document.createElement('div');
      hint.className = 'chat-hint';
      hint.innerHTML = renderMarkdown(deferredHint);
      last.appendChild(hint);
    }
    state._pendingPostExtractHint = null;
  }
  // Patch the last assistant entry in _messageLog so a session reload restores
  // both the NA bar and hint correctly.
  if (typeof _messageLog !== 'undefined' && _messageLog.length > 0) {
    for (let i = _messageLog.length - 1; i >= 0; i--) {
      const e = _messageLog[i];
      if (e && e.type === 'assistant') {
        if (deferredNA && !e.nextActions) e.nextActions = deferredNA;
        if (deferredHint) {
          const cur = e.text;
          if (typeof cur === 'object' && cur !== null) e.text = { ...cur, hint: deferredHint };
          else e.text = { text: cur || '', hint: deferredHint };
        }
        break;
      }
    }
  }
  // Unlock chat input
  isLoading = false;
  document.getElementById('send-btn').style.display = 'flex';
  document.getElementById('stop-btn').style.display = 'none';
  if (typeof updateNaPlaceholder === 'function') updateNaPlaceholder();
  if (typeof persistChat === 'function') persistChat();
}

// Re-render the context card inside the last assistant message using current state.
function refreshContextCardInLastMessage() {
  const msgs = document.querySelectorAll('.msg.assistant');
  const lastMsg = msgs[msgs.length - 1];
  if (!lastMsg) return;
  const html = buildContextCardHTML();
  // Remove any existing tabbed card in this message and re-append a fresh one.
  lastMsg.querySelectorAll('.context-card').forEach(el => el.remove());
  if (html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const bubble = lastMsg.querySelector('.bubble');
    const anchor = bubble || lastMsg.firstChild;
    // Insert after the bubble (or at end)
    while (wrap.firstChild) {
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(wrap.firstChild, anchor.nextSibling);
      } else {
        lastMsg.appendChild(wrap.firstChild);
      }
    }
  }
  updateStatePanel?.();
}

async function extractDetailsForDoc({ name, text }) {
  if (!text) return;
  // Send ONLY the extract action file — NOT composed with the analyze base / rules.
  // The base prompt's "always emit chat_response / project_context / captured_topics"
  // rules dominate when bundled, and the LLM ends up returning a full
  // analyze_document response with empty extraction lists. The action file is
  // self-contained (OUTPUT + RULES + BUCKETS) and works standalone.
  const composedKeys = ['analyze_action_extract_details'];
  const prompt = composedKeys.map(k => prompts[k]).filter(Boolean).join('\n\n');
  if (typeof recordPromptComposition === 'function') {
    recordPromptComposition('analyze', 'extract_details', composedKeys);
  }
  if (!prompt) { console.warn('[ExtractDetails] prompt failed to compose'); return; }

  const docBlock = `[DOCUMENT: ${name}]\n\n${text}`;
  const payload = { document_text: docBlock, project_language: state.project_language || null };

  try {
    const key = getActiveKey();
    if (!key) return;
    const userMsg = JSON.stringify(payload, null, 2);
    const content = docBlock + '\n\n' + userMsg;
    const model = getModelForAgent('analyze');

    let response;
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: 4096, system: prompt, messages: [{ role: 'user', content }] })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      response = parseJSON(data.content[0].text);
    } else if (provider === 'openai') {
      const res = await fetch('/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, payload: { model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }, { role: 'user', content }] } })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      response = parseJSON(data.choices[0].message.content);
    } else if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ system_instruction: { parts: [{ text: prompt }] }, contents: [{ role: 'user', parts: [{ text: content }] }], generationConfig: { response_mime_type: 'application/json' } })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      response = parseJSON(data.candidates[0].content.parts[0].text);
    }

    // The new extract_details prompt returns its lists nested under inputs[*]
    // (one entry per input id, merge-by-id on the backend). The frontend
    // playground reads both shapes — nested under inputs[*] (current contract)
    // and flat top-level (legacy) — so prompt edits don't break extraction.
    const docInput = (state.inputs || []).find(i => i.source === 'document' && i.name === name);
    const docSrcKey = docInput?.id || name;
    const tag = (p) => ({ ...p, source: p.source || docSrcKey });

    const collectFromInputs = (field) => {
      const out = [];
      const inputs = Array.isArray(response?.inputs) ? response.inputs : [];
      for (const entry of inputs) {
        if (Array.isArray(entry?.[field])) out.push(...entry[field]);
      }
      // Legacy top-level fallback if the model emitted flat lists.
      if (out.length === 0 && Array.isArray(response?.[field])) {
        out.push(...response[field]);
      }
      return out.map(tag);
    };

    const newOpen      = collectFromInputs('open_points');
    const newNotes     = collectFromInputs('project_notes');
    const newDecisions = collectFromInputs('decisions');
    const newEntities  = collectFromInputs('entities');

    if (newOpen.length      > 0) state._openPoints   = [...(state._openPoints   || []), ...newOpen];
    if (newNotes.length     > 0) state._projectNotes = [...(state._projectNotes || []), ...newNotes];
    if (newDecisions.length > 0) state._decisions    = [...(state._decisions    || []), ...newDecisions];
    if (newEntities.length  > 0) state._entities     = [...(state._entities     || []), ...newEntities];

    // Append (don't overwrite) so the upstream analyze_document output stays visible.
    if (typeof appendDebugOutput === 'function') {
      appendDebugOutput(response, 'extract_details', `extract_details · ${name}`);
    }
    console.log(
      `[ExtractDetails] ${name}: ${newOpen.length} open_points, ${newNotes.length} notes, ${newDecisions.length} decisions, ${newEntities.length} entities`
    );
    if (newOpen.length === 0 && newNotes.length === 0 && newDecisions.length === 0 && newEntities.length === 0) {
      console.log('[ExtractDetails] Empty extraction — raw response:', response);
    }
  } catch (err) {
    console.warn('[ExtractDetails] failed for', name, '—', err.message);
  }
}


// ─── AGENT RESPONSE HANDLING ─────────────────────────────────────────────────

async function handleAgentResponse(agentKey, r) {

  // ── Structure Generator ───────────────────────────────────────────────────
  if (agentKey === 'builder') {
    // GUARD: open_questions[] must never auto-trigger CB widget
    // They are only shown when user clicks "Resolve assumptions"
    if (r.open_questions) {
      _lastOpenQuestions = r.open_questions;
      delete r.questions; // prevent any accidental CB question handling
    }

    // Always save project_context if returned. Merge so enriched fields
    // (summary/entities/covered/gaps/built_at) from the Builder don't drop
    // confidence/platform_type/market_type set earlier by the Chat agent.
    if (r.project_context) {
      if (r.project_context.built_at === 'auto') {
        r.project_context.built_at = new Date().toISOString();
      }
      state.project_context = { ...(state.project_context || {}), ...r.project_context };
    }

    // Move resolved answers to _resolvedPoints (shown separately, not in captured topics)
    if (state._resolvedAnswers?.length > 0) {
      state._resolvedPoints = [...(state._resolvedPoints || []), ...state._resolvedAnswers];
      state._resolvedAnswers = [];
    }

    // completed — show builder card
    if (r.status === 'completed' || r.structure || r.modules || r.sections) {
      // Clear cached questions — new builder output means new assumptions
      _lastOpenQuestions = [];

      // Atomic mode responses (resolve/diff/etc.) return only the slots they touched —
      // preserve the rest from the current proposed structure (if we're iterating on
      // it) or fall back to existing_structure. Raw responses from resolve/diff may
      // include empty pages/modules as LLM filler — only treat non-empty arrays or
      // explicit r.structure slots as intentional.
      const hasPages    = (r.structure?.pages    !== undefined) || (r.pages?.length    > 0);
      const hasSections = (r.structure?.sections !== undefined) || (r.sections?.length > 0);
      const hasModules  = (r.structure?.modules  !== undefined) || (r.modules?.length  > 0);

      const struct = r.structure || { pages: r.pages, sections: r.sections, modules: r.modules };

      // Normalize new-prompt schema → frontend schema:
      // The Builder prompts emit `open_points: ["..."]` on modules/features/pages.
      // The card-render code reads `assumptions`. Mirror open_points → assumptions
      // (only when assumptions isn't already populated) so existing renderers work.
      const _mirrorOpenPoints = (item) => {
        if (!item || typeof item !== 'object') return;
        if ((!item.assumptions || item.assumptions.length === 0) && Array.isArray(item.open_points)) {
          item.assumptions = item.open_points.map(p => (typeof p === 'string' ? p : (p?.title || p?.text || ''))).filter(Boolean);
        }
        (item.features || []).forEach(_mirrorOpenPoints);
      };
      (struct.pages    || []).forEach(_mirrorOpenPoints);
      (struct.modules  || []).forEach(_mirrorOpenPoints);
      (struct.sections || []).forEach(sec => (sec.modules || []).forEach(_mirrorOpenPoints));

      // Prefer the in-flight proposed tree (mid-iteration) over the committed
      // tree as the fallback source — resolve responses often only touch the
      // slot they edited and expect the proposal to carry through.
      const fillBase = state._proposedStructure || state.existing_structure || {};
      let pages    = hasPages    ? (struct.pages    || []) : (fillBase.pages    || []);
      let sections = hasSections ? (struct.sections || []) : (fillBase.sections || []);
      let modules  = hasModules  ? (struct.modules  || []) : (fillBase.modules  || []);
      if (r.diff) {
        const prevModules = [
          ...(state.existing_structure?.pages    || []),
          ...(state.existing_structure?.sections?.flatMap(s => s.modules || []) || []),
          ...(state.existing_structure?.modules  || []),
        ];
        const prevAssumpMap = new Map(prevModules.map(m => [m.id, m.assumptions || []]));
        const mergeA = (mods) => (mods || []).map(m => ({
          ...m,
          assumptions: (m.assumptions?.length > 0) ? m.assumptions : (prevAssumpMap.get(m.id) || []),
        }));
        pages    = mergeA(pages);
        modules  = mergeA(modules);
        sections = sections.map(sec => ({ ...sec, modules: mergeA(sec.modules) }));
      }

      // Append synthetic "Notes" pages (one per doc) from state._projectNotes.
      // Frontend-only — the Builder LLM never sees these. Strip any prior
      // synthetic pages first (from state fallback or LLM echo) so resolve/diff
      // re-renders don't accumulate duplicates.
      pages = (pages || []).filter(p => p?.synthetic !== 'project_notes');
      const synthPages = buildProjectNotePages();
      if (synthPages.length > 0) pages = [...pages, ...synthPages];

      // Assign module colors on the frontend — deterministic, token-free.
      // Preserves colors of committed modules across regenerate / resolve / diff.
      assignModuleColors(sections, modules, state.existing_structure);

      // Normalize every summary field to the history-array shape. The LLM's
      // OUTPUT schema uses arrays, but this guards against partial/legacy shapes.
      if (typeof normalizeStructureSummaries === 'function') {
        normalizeStructureSummaries({ pages, sections, modules });
      }

      // Snapshot previous committed modules — needed for diff comparison.
      const prevSnapshot = snapshotModules();

      // Write to _proposedStructure (temporary). existing_structure is ONLY
      // changed on Insert/Merge — this preserves the committed tree for the
      // sidebar and guarantees discard is always safe.
      state._proposedStructure = {
        pages,
        sections,
        modules,
        generation_type: r.generation_type || state.existing_structure?.generation_type || 'modules',
        confidence:      r.confidence || state.existing_structure?.confidence || state.project_context?.confidence || 0,
        diff:            r.diff || null,
      };
      state._mode = 'builder';
      updateContextTag();
      // Build a patched response with the preserved/merged slots for rendering
      const rPatched = { ...r, structure: { pages, sections, modules } };
      if (r.diff) {
        renderDiffCard(rPatched, prevSnapshot);
      } else {
        renderBuilderCard(rPatched);
      }
      updateStatePanel();
      return; // IMPORTANT: never fall through to CB handling
    }

    // answered — builder answered a question without changing modules
    if (r.status === 'answered') {
      if (r.chat_response) {
        addAssistantMessage(r.chat_response, null, 'builder');
      }
      updateStatePanel();
      return;
    }

    // diff_completed — LLM returned a DELTA (new_modules[] + updated_modules[]).
    // The frontend builds the proposed tree by overlaying the delta on the
    // committed tree and computes `unchanged` itself.
    if (r.status === 'diff_completed') {
      const newMods = Array.isArray(r.new_modules)     ? r.new_modules     : [];
      const updMods = Array.isArray(r.updated_modules) ? r.updated_modules : [];

      // Deep clone the committed tree as the proposed-tree base.
      const committed = state.existing_structure || { pages: [], sections: [], modules: [] };
      const proposed = JSON.parse(JSON.stringify(committed));
      proposed.pages    = proposed.pages    || [];
      proposed.sections = proposed.sections || [];
      proposed.modules  = proposed.modules  || [];

      // History-aware merge for a single module. The LLM returns `summary` as
      // an array with ONE entry (the new version) — the client appends that to
      // the existing history. If `summary` is absent, keep the prior history.
      const nowIso = new Date().toISOString();
      const mergeUpdatedModule = (prev, upd) => {
        const out = { ...prev, ...upd };
        // Summary — only append when the LLM actually returned one.
        if (Object.prototype.hasOwnProperty.call(upd, 'summary') && Array.isArray(upd.summary) && upd.summary.length > 0) {
          const entry = upd.summary[0];
          out.summary = appendSummaryEntry(prev.summary, { ...entry, date: entry?.date || nowIso });
        } else {
          out.summary = normalizeSummary(prev.summary, nowIso);
        }
        // Features — history-aware per feature. If upd.features is absent, keep prev.features.
        if (Array.isArray(upd.features)) {
          const prevFById = new Map((prev.features || []).map(f => [f.id, f]));
          out.features = upd.features.map(nf => {
            const pf = prevFById.get(nf.id);
            if (!pf) {
              // New feature — normalize its single-entry summary, stamp date.
              const hist = normalizeSummary(nf.summary, nowIso);
              return { ...nf, summary: hist };
            }
            const mergedF = { ...pf, ...nf };
            if (Object.prototype.hasOwnProperty.call(nf, 'summary') && Array.isArray(nf.summary) && nf.summary.length > 0) {
              const fe = nf.summary[0];
              mergedF.summary = appendSummaryEntry(pf.summary, { ...fe, date: fe?.date || nowIso });
            } else {
              mergedF.summary = normalizeSummary(pf.summary, nowIso);
            }
            return mergedF;
          });
        }
        return out;
      };

      // Apply updated modules — find by id across sections and flat modules.
      for (const upd of updMods) {
        let applied = false;
        for (const sec of proposed.sections) {
          const idx = (sec.modules || []).findIndex(m => m.id === upd.id);
          if (idx >= 0) {
            sec.modules[idx] = mergeUpdatedModule(sec.modules[idx], upd);
            applied = true;
            break;
          }
        }
        if (!applied) {
          const idx = proposed.modules.findIndex(m => m.id === upd.id);
          if (idx >= 0) proposed.modules[idx] = mergeUpdatedModule(proposed.modules[idx], upd);
        }
      }

      // Apply new modules — target section by `section_id`, else first section,
      // else the flat module list. Normalize their single-entry summary + stamp date.
      const stampNewModule = (m) => ({
        ...m,
        summary: normalizeSummary(m.summary, nowIso),
        features: Array.isArray(m.features)
          ? m.features.map(f => ({ ...f, summary: normalizeSummary(f.summary, nowIso) }))
          : m.features,
      });
      for (const raw of newMods) {
        const newMod = stampNewModule(raw);
        const sec = proposed.sections.find(s => s.id === newMod.section_id);
        if (sec) {
          sec.modules = sec.modules || [];
          sec.modules.push(newMod);
        } else if (proposed.sections.length > 0) {
          proposed.sections[0].modules = proposed.sections[0].modules || [];
          proposed.sections[0].modules.push(newMod);
        } else {
          proposed.modules.push(newMod);
        }
      }

      // Refresh synthetic Notes pages from current state (handles new uploaded docs).
      proposed.pages = proposed.pages.filter(p => p?.synthetic !== 'project_notes');
      const synthPages = buildProjectNotePages();
      if (synthPages.length > 0) proposed.pages.push(...synthPages);

      // Assign colors — preserve committed module colors, assign new ones fresh.
      assignModuleColors(proposed.sections, proposed.modules, state.existing_structure);

      // Build the diff object from the delta.
      const newIds = new Set(newMods.map(m => m.id));
      const updIds = new Set(updMods.map(m => m.id));
      const diff = {
        new:       newMods.map(m => ({ id: m.id, name: m.name, type: 'module' })),
        updated:   updMods.map(m => ({ id: m.id, name: m.name, type: 'module' })),
        unchanged: [],
      };

      // Calculate unchanged modules from the committed tree.
      const committedModules = [
        ...(committed.sections || []).flatMap(s => s.modules || []),
        ...(committed.modules  || []),
      ];
      for (const m of committedModules) {
        if (!newIds.has(m.id) && !updIds.has(m.id)) {
          diff.unchanged.push({ id: m.id, name: m.name, type: 'module' });
        }
      }

      // Page diff — synthetic Notes pages only exist frontend-side. Compare
      // committed vs proposed page lists.
      const committedPages = committed.pages || [];
      const committedPageById = new Map(committedPages.map(p => [p.id, p]));
      for (const p of proposed.pages) {
        const oldPage = committedPageById.get(p.id);
        if (!oldPage) {
          diff.new.push({ id: p.id, name: p.name, type: 'page' });
          continue;
        }
        const oldItemCount = Array.isArray(oldPage.checkbox_items) ? oldPage.checkbox_items.length : 0;
        const newItemCount = Array.isArray(p.checkbox_items)        ? p.checkbox_items.length        : 0;
        // Summary may be either a history array (non-synthetic pages) or a
        // string (synthetic Notes pages) — compare the current text either way.
        const oldSummaryText = currentSummaryText(oldPage.summary);
        const newSummaryText = currentSummaryText(p.summary);
        if (oldPage.name !== p.name || oldSummaryText !== newSummaryText || oldItemCount !== newItemCount) {
          diff.updated.push({
            id: p.id, name: p.name, type: 'page',
            changes: oldItemCount !== newItemCount
              ? `${newItemCount} item${newItemCount !== 1 ? 's' : ''} (was ${oldItemCount})`
              : 'Content updated',
          });
        } else {
          diff.unchanged.push({ id: p.id, name: p.name, type: 'page' });
        }
      }

      // Snapshot committed modules — used by renderDiffCard for renamed detection.
      const prevSnapshot = snapshotModules();

      // Commit to _proposedStructure. state.existing_structure stays untouched.
      state._proposedStructure = {
        pages:           proposed.pages,
        sections:        proposed.sections,
        modules:         proposed.modules,
        generation_type: r.generation_type || state.existing_structure?.generation_type || 'modules',
        confidence:      r.confidence || state.project_context?.confidence || 0,
        diff,
      };
      state._mode = 'builder';
      updateContextTag();
      renderDiffCard({
        structure: {
          pages:    proposed.pages,
          sections: proposed.sections,
          modules:  proposed.modules,
        },
        diff,
        confidence:      state._proposedStructure.confidence,
        generation_type: state._proposedStructure.generation_type,
      }, prevSnapshot);
      if (typeof renderLeftNavTree === 'function') renderLeftNavTree();
      updateStatePanel();
      return;
    }
  }

  // ── Interviewer Agent (enrich flow) ──────────────────────────────────────
  if (agentKey === 'interview') {
    if (r.status === 'questions_ready' && r.questions?.length > 0) {
      _cbEnrichContextMode = true;
      showCBWidget(r.questions, _cbEnrichContextSource);
      return;
    }

    if (r.status === 'discard') {
      if (state._mode === 'builder') {
        addAssistantMessage("No problem — your project context is unchanged.", null, 'enrich_discard');
        showBuilderCardNA();
      } else {
        const conf = state.project_context?.confidence || 35;
        const nextActions = resolveNextActions(`[NA:GENERATE|CONFIDENCE:${conf}]`);
        addAssistantMessage("No problem — your project context is unchanged. You can generate or add more details.", nextActions, 'enrich_discard');
      }
      updateStatePanel();
      return;
    }

    if (r.status === 'enrich_completed') {
      if (r.enrich_inputs && r.enrich_inputs.length > 0) {
        r.enrich_inputs.forEach(ei => {
          state.inputs.push({ source: 'additional', id: `mi_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, topic: ei.topic, detail: ei.detail, added_at: new Date().toISOString() });
        });
        applyProjectSummary(r);
        const newTopics = r.enrich_inputs.map(ei => ({
          title: ei.topic,
          summary: String(ei.detail || '').split(' ').slice(0, 8).join(' '),
        }));
        state._capturedTopics = mergeTopics(state._capturedTopics || [], newTopics);
        // Open the Added tab and mark it with a "New" badge until the user clicks a tab.
        state._activeContextDoc = '__added__';
        state._addedTabHasNew = true;
        // Tag each new topic title as NEW so it shows the green pill next to the title
        // (used when there's no Added tab — e.g. no documents uploaded yet).
        state._topicTags = state._topicTags || {};
        newTopics.forEach(t => {
          if (t.title) state._topicTags[String(t.title).toLowerCase()] = 'NEW';
        });
      }
      if (r.project_context) {
        state.project_context = { ...(state.project_context || {}), ...r.project_context };
      }
      if (state._mode === 'builder') {
        // Close the Builder card and return to Chat — same as /discard
        state.existing_structure = null;
        state._mode = 'chat';
        state._resolvedAnswers = [];
        updateContextTag();
      }
      const conf = state.project_context?.confidence || 35;
      const nextActions = resolveNextActions(`[NA:GENERATE|CONFIDENCE:${conf}]`);
      if (r.chat_response) {
        addAssistantMessage(r.chat_response, nextActions, 'enrich_context');
      } else {
        // Fallback — send through chat agent for a clean project recap
        const input = document.getElementById('user-input');
        if (input) {
          input.value = 'Context closed';
          sendMessage();
        }
      }
      updateStatePanel();
      return;
    }
  }

  updateStatePanel();
}

// ─── ENRICH CONTEXT CLOSE CALLBACK ──────────────────────────────────────────

async function onEnrichContextClose(source, answers) {
  if (source === 'builder') {
    // From builder → re-show builder card NA
    showBuilderCardNA();
  } else {
    // From chat → show Q&A bubble if answers exist, then submit as completed
    if (answers.length > 0) {
      const qaText = answers.map(a => `Q: ${a.q}\nA: ${a.a}`).join('\n\n');
      addUserMessage([{ type: 'text', text: qaText }]);
      await submitEnrichContext(answers, 'enrich_completed');
    } else {
      // No answers — handle locally (no LLM call). submitEnrichContext short-circuits
      // to the discard path which renders a recap with current captured topics + NA.
      await submitEnrichContext(answers, 'discard');
    }
  }
  updateStatePanel();
}

// Helper: build the REFINE tag from current state (encodes genType +
// whether a fresh input arrived after the last insert, which unlocks /regenerate).
// Emitted post-insert per the prompts' next_actions contract.
function buildBuilderInsertedTag() {
  const es = state.existing_structure || {};
  const genType = es.generation_type === 'modules_features' ? 'modules_features' : 'modules';
  const insertedAt = es.inserted_at ? Date.parse(es.inserted_at) : 0;
  const hasNewInput = (state.inputs || []).some(i => {
    const t = i.added_at ? Date.parse(i.added_at) : 0;
    return t && t > insertedAt;
  });
  const conf = state.project_context?.confidence || 0;
  return `[NA:REFINE|GENTYPE:${genType}|NEW_INPUT:${hasNewInput ? '1' : '0'}|CONFIDENCE:${conf}]`;
}

// Helper: populate the NA bar with state-derived commands and immediately hide it.
// Used in answer mode so that typing `/` in the chat input can still reveal commands.
function populateHiddenNextActions() {
  let tag = null;
  if (state._proposedStructure) {
    // Iterating on a builder/diff card — surface card-level commands.
    const allMods = [
      ...(state._proposedStructure.sections?.flatMap(s => s.modules || []) || []),
      ...(state._proposedStructure.modules || []),
      ...(state._proposedStructure.pages || []),
    ];
    const assumptionCount = [...new Set(allMods.flatMap(m => [
      ...(m.assumptions || []),
      ...(m.features || []).flatMap(f => f.assumptions || []),
    ]).filter(Boolean))].length;
    const genType = state._proposedStructure.generation_type || 'modules';
    const conf = state.project_context?.confidence || 0;
    const isDiff = !!state._proposedStructure.diff;
    tag = `[NA:BUILDER_CARD|ASSUMPTIONS:${assumptionCount}|GENTYPE:${genType}|CONFIDENCE:${conf}|DIFF:${isDiff ? '1' : '0'}]`;
  } else if (state.existing_structure?.inserted) {
    tag = buildBuilderInsertedTag();
  } else if (state.inputs.some(i => i.source === 'text' || i.source === 'document')) {
    const conf = state.project_context?.confidence || 35;
    tag = `[NA:GENERATE|CONFIDENCE:${conf}]`;
  } else {
    tag = '[NA:EMPTY]';
  }
  const na = resolveNextActions(tag);
  if (!na) return;
  renderNextActions(na);
  const bar = document.getElementById('next-actions-bar');
  if (bar) {
    bar.style.display = 'none';
    if (typeof _naHidden !== 'undefined') _naHidden = true;
  }
  if (typeof updateNaPlaceholder === 'function') updateNaPlaceholder();
}

// Helper: show builder card NA commands based on the card currently shown —
// this is the PROPOSED structure when iterating on a builder/diff card, or
// the committed existing_structure as a fallback.
function showBuilderCardNA() {
  const src = state._proposedStructure || state.existing_structure;
  if (!src) return;
  const allMods = [
    ...(src.sections?.flatMap(s => s.modules || []) || []),
    ...(src.modules || []),
    ...(src.pages || []),
  ];
  const assumptionCount = [...new Set(allMods.flatMap(m => [
    ...(m.assumptions || []),
    ...(m.features || []).flatMap(f => f.assumptions || []),
  ]).filter(Boolean))].length;
  const genType = state._proposedStructure?.generation_type || state.existing_structure?.generation_type || 'modules';
  const conf = state.project_context?.confidence || 0;
  const isDiff = !!state._proposedStructure?.diff;
  const na = resolveNextActions(`[NA:BUILDER_CARD|ASSUMPTIONS:${assumptionCount}|GENTYPE:${genType}|CONFIDENCE:${conf}|DIFF:${isDiff ? '1' : '0'}]`);
  renderNextActions(na);
}

// ─── CONTEXT TAG ─────────────────────────────────────────────────────────────

function closeContextMode() {
  state._mode = 'chat';
  updateContextTag();
  removeAllNextActions();

  // Send project overview through chat agent as normal user_input
  const input = document.getElementById('user-input');
  if (input) {
    input.value = 'Context closed';
    sendMessage();
  }
}

function updateContextTag() {
  const bar   = document.getElementById('context-tag-bar');
  const label = document.getElementById('context-tag-label');
  const input = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const isBuilder = state._mode === 'builder';
  // Toggle a body-level flag so CSS can hide the send button / restyle the input
  // while Builder mode is active (slash-only filter, no free-text submit).
  document.body.classList.toggle('mode-builder', isBuilder);
  // Leaving Builder mode also clears any collapsed-filter state from ESC.
  if (!isBuilder) document.body.classList.remove('mode-builder-collapsed');
  if (!bar || !label) return;
  if (isBuilder) {
    const textEl = label.querySelector('.context-tag-text');
    if (textEl) textEl.textContent = 'Builder';
    bar.style.display = 'flex';
    if (input) input.placeholder = 'Filter';
    // Only force-hide when not already loading — stop button owns the slot then.
    if (sendBtn && !isLoading) sendBtn.style.display = 'none';
  } else {
    bar.style.display = 'none';
    if (input) input.placeholder = 'Type a message...';
    if (sendBtn && !isLoading) sendBtn.style.display = 'flex';
  }
}

// ─── DIFF CARD RENDERER ──────────────────────────────────────────────────────

// Snapshot all modules from current state — call BEFORE updating state
function snapshotModules() {
  return [
    ...(state.existing_structure?.pages    || []),
    ...(state.existing_structure?.sections?.flatMap(s => s.modules || []) || []),
    ...(state.existing_structure?.modules  || []),
  ];
}

function renderDiffCard(r, prevModules) {
  const diff    = r.diff || { new: [], updated: [], unchanged: [] };
  const struct  = r.structure || {};
  prevModules   = prevModules || [];

  // Build id-indexed lookup over the proposed tree so diff entries
  // (which carry only id + name + changes) can be resolved to full item data.
  const itemsById = new Map();
  const pageIds   = new Set();
  for (const p of (struct.pages || [])) { itemsById.set(p.id, p); pageIds.add(p.id); }
  for (const sec of (struct.sections || [])) {
    for (const m of (sec.modules || [])) itemsById.set(m.id, m);
  }
  for (const m of (struct.modules || [])) itemsById.set(m.id, m);

  // Diff-opts for renderModuleRow — drive the tiny top-right changes label.
  const newIds     = new Set((diff.new || []).map(m => m.id));
  const updMap     = new Map();
  const renamedMap = new Map();
  const prevNameById = new Map(prevModules.map(m => [m.id, m.name?.toLowerCase()]));
  for (const m of (diff.updated || [])) {
    const oldName  = prevNameById.get(m.id);
    const newName  = m.name?.toLowerCase();
    const prevName = prevModules.find(p => p.id === m.id)?.name || oldName || '';
    if (oldName && newName && oldName !== newName && !m.changes) {
      renamedMap.set(m.id, `Renamed from ${prevName}`);
    } else {
      updMap.set(m.id, 'Updated');
    }
  }
  // Per-module feature diff (only for UPDATED modules) — compares the proposed
  // module's features against its committed counterpart so the expanded view
  // shows only NEW / UPDATED features + an unchanged count.
  const committedModulesById = new Map();
  for (const s of (state.existing_structure?.sections || [])) {
    for (const m of (s.modules || [])) committedModulesById.set(m.id, m);
  }
  for (const m of (state.existing_structure?.modules || [])) committedModulesById.set(m.id, m);

  const featureDiffById = new Map();
  for (const u of (diff.updated || [])) {
    if (u.type === 'page') continue;
    const proposed  = itemsById.get(u.id);
    const committed = committedModulesById.get(u.id);
    if (!proposed || !committed) continue;
    const oldMap = new Map((committed.features || []).map(f => [f.id, f]));
    const newFeatures     = [];
    const updatedFeatures = [];
    let unchangedCount    = 0;
    for (const f of (proposed.features || [])) {
      const old = oldMap.get(f.id);
      if (!old) {
        newFeatures.push({ ...f, _diffStatus: 'new' });
      } else if (old.name !== f.name) {
        updatedFeatures.push({ ...f, _diffStatus: 'updated', _changes: `Renamed from ${old.name}` });
      } else if (currentSummaryText(old.summary) !== currentSummaryText(f.summary)) {
        updatedFeatures.push({ ...f, _diffStatus: 'updated', _changes: 'Summary refined' });
      } else if (JSON.stringify(old.assumptions || []) !== JSON.stringify(f.assumptions || [])) {
        updatedFeatures.push({ ...f, _diffStatus: 'updated', _changes: 'Assumptions updated' });
      } else {
        unchangedCount++;
      }
    }
    featureDiffById.set(u.id, { newFeatures, updatedFeatures, unchangedCount });
  }

  const diffOpts = { newIds, updMap, renamedMap, featureDiffById };

  // Header meta — count everything in the proposed tree.
  const allMods = [
    ...(struct.sections || []).flatMap(s => s.modules || []),
    ...(struct.modules || []),
  ];
  const totalModules  = allMods.length;
  const totalFeatures = allMods.reduce((sum, m) => sum + (m.features?.length || 0), 0);
  const confidenceNum = (typeof r.confidence === 'number' && r.confidence > 0)
      ? r.confidence
      : (state.existing_structure?.confidence || state.project_context?.confidence || 0);
  const confidence    = confidenceNum || '?';
  const hasFeatures   = (r.generation_type === 'modules_features') || totalFeatures > 0;
  const metaParts = [`${totalModules} module${totalModules !== 1 ? 's' : ''}`];
  if (hasFeatures) metaParts.push(`${totalFeatures} feature${totalFeatures !== 1 ? 's' : ''}`);
  metaParts.push(`${confidence}% confidence`);

  let html = `<div class="builder-card" id="builder-card">`;
  html += `<div class="builder-card-header" onclick="toggleBuilderCard(this)">
    <span class="builder-card-title">Structure Diff</span>
    <span class="builder-card-meta">${metaParts.join(' · ')}</span>
    <span class="builder-card-chevron" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
  </div>
  <div class="builder-card-body">`;

  // Render one diff section (NEW or UPDATED) — splits into PAGES + MODULES subsections.
  // Uses entry.type ('page' | 'module') when present; falls back to pageIds lookup
  // for older/loose responses that don't carry the type field.
  const isPageEntry = (e) => e.type === 'page' || (!e.type && pageIds.has(e.id));
  const renderSection = (sectionClass, dotClass, labelText, entries, emptyText) => {
    const pages   = (entries || []).filter(e =>  isPageEntry(e)).map(e => itemsById.get(e.id)).filter(Boolean);
    const modules = (entries || []).filter(e => !isPageEntry(e)).map(e => itemsById.get(e.id)).filter(Boolean);
    let out = `<div class="builder-diff-section ${sectionClass}">
      <div class="builder-diff-section-header"><span class="builder-diff-dot ${dotClass}"></span>${labelText}</div>`;
    if (pages.length === 0 && modules.length === 0) {
      out += `<div class="builder-diff-empty">${escHtml(emptyText)}</div>`;
    } else {
      if (pages.length > 0) {
        out += `<div class="builder-diff-subsection-label">PAGES</div>`;
        for (const p of pages) out += renderModuleRow(p, 'builder-page', diffOpts);
      }
      if (modules.length > 0) {
        out += `<div class="builder-diff-subsection-label">MODULES</div>`;
        for (const m of modules) out += renderModuleRow(m, 'builder-module', diffOpts);
      }
    }
    out += `</div>`;
    return out;
  };

  const newEntries = diff.new || [];
  const updEntries = diff.updated || [];
  const unchanged  = diff.unchanged || [];

  if (newEntries.length === 0 && updEntries.length === 0) {
    // Nothing changed — render a single friendly placeholder instead of empty sections.
    html += `<div class="builder-diff-noop">
      No differences found. Your structure is up to date.
    </div>`;
  } else {
    html += renderSection('builder-diff-new',     'builder-diff-dot-new',     'NEW',     newEntries, 'No new modules or pages.');
    html += renderSection('builder-diff-updated', 'builder-diff-dot-updated', 'UPDATED', updEntries, 'No changes to existing modules.');
  }

  if (unchanged.length > 0) {
    const names = unchanged.map(m => escHtml(m.name || '')).filter(Boolean).join(', ');
    html += `<div class="builder-diff-section builder-diff-unchanged">
      <div class="builder-diff-section-header"><span class="builder-diff-dot builder-diff-dot-unchanged"></span>UNCHANGED</div>
      <div class="builder-diff-unchanged-list">${names}</div>
    </div>`;
  }

  // Global assumptions footer (same shape as builder card).
  const allItems = [
    ...(struct.pages || []),
    ...allMods,
  ];
  const globalAssumps = [
    ...new Set(
      allItems
        .flatMap(m => [
          ...(m.assumptions || []),
          ...(m.features || []).flatMap(f => f.assumptions || []),
        ])
        .filter(Boolean)
    )
  ];
  _lastOpenQuestions = r.open_questions || [];
  const hasOpenPoints = allItems.some(m =>
      (m.assumptions?.length > 0) ||
      (m.features || []).some(f => f.assumptions?.length > 0)
  );
  const confidenceLabel = hasOpenPoints
      ? (confidenceNum >= 75 ? 'minor open points' : 'with open points')
      : '';
  if (globalAssumps.length > 0) {
    const GA_VISIBLE   = 6;
    const visibleItems = globalAssumps.slice(0, GA_VISIBLE).map(a => `<li>${escHtml(a)}</li>`).join('');
    const hiddenItems  = globalAssumps.slice(GA_VISIBLE).map(a => `<li>${escHtml(a)}</li>`).join('');
    const overflow     = globalAssumps.length - GA_VISIBLE;
    html += `<div class="builder-assumptions">
      <span class="builder-confidence-badge">${confidence}% confidence${confidenceLabel ? ' · ' + confidenceLabel : ''}</span>
      <ul class="assumption-list">
        ${visibleItems}
        ${hiddenItems ? `<span class="assumption-hidden" style="display:none;">${hiddenItems}</span>` : ''}
      </ul>
      ${overflow > 0 ? `<button class="assumption-toggle" onclick="toggleAssumptions(this)" data-more="${overflow}">Show ${overflow} more</button>` : ''}
    </div>`;
  }

  html += `</div>`; // close .builder-card-body
  html += `</div>`; // close .builder-card

  if (!_restoring) _messageLog.push({ type: 'builder', data: r, variant: 'diff' });

  removeAllNextActions();
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = html;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();

  if (!_restoring) {
    const genType = r.generation_type || state.existing_structure?.generation_type || 'modules';
    const conf = state.project_context?.confidence || r.confidence || 0;
    const na = resolveNextActions(`[NA:BUILDER_CARD|ASSUMPTIONS:${globalAssumps.length}|GENTYPE:${genType}|CONFIDENCE:${conf}|DIFF:1]`);
    renderNextActions(na);
  }
}

// ─── STRUCTURE CARD RENDERER ─────────────────────────────────────────────────

// Stores open_questions from last builder response — used by resolve card
let _lastOpenQuestions = [];

function renderBuilderCard(r, diffOpts) {
  const struct          = r.structure || r; // support both new {structure:{}} and old flat format
  const pages           = struct.pages    || [];
  const sections        = struct.sections || [];
  const flatModules     = struct.modules  || [];
  // Regenerate / resolve responses often omit top-level `confidence` — fall back
  // to the structure snapshot first, then the chat-agent's project_context.
  const confidenceNum = (typeof r.confidence === 'number' && r.confidence > 0)
      ? r.confidence
      : (state.existing_structure?.confidence || state.project_context?.confidence || 0);
  const confidence    = confidenceNum || '?';
  // Derive label from confidence + open points — don't rely on LLM
  const _hasOpenPoints = (() => {
    const allMods = [...pages, ...sections.flatMap(s=>s.modules||[]), ...flatModules];
    return allMods.some(m =>
        (m.assumptions?.length > 0) ||
        (m.features || []).some(f => f.assumptions?.length > 0)
    );
  })();
  const label = _hasOpenPoints
      ? (confidenceNum >= 75 ? 'minor open points' : 'with open points')
      : (r.assumption_label || '');
  const openQuestions   = r.open_questions   || [];

  // Collect global_assumptions from module + feature + page assumptions
  const allModules = [
    ...pages,
    ...sections.flatMap(s => s.modules || []),
    ...flatModules
  ];
  const globalAssumps = [
    ...new Set(
        allModules
            .flatMap(m => [
              ...(m.assumptions || []),
              ...(m.features || []).flatMap(f => f.assumptions || []),
            ])
            .filter(Boolean)
    )
  ];

  // Store open questions for resolve card
  _lastOpenQuestions = openQuestions;

  // Count total modules and features across sections or flat
  const allMods2 = sections.length > 0
      ? sections.flatMap(s => s.modules || [])
      : flatModules;
  const totalModules  = allMods2.length;
  const totalFeatures = allMods2.reduce((sum, m) => sum + (m.features?.length || 0), 0);
  const genType       = r.generation_type || 'modules';
  const hasFeatures   = genType === 'modules_features' || totalFeatures > 0;

  // ── Header ────────────────────────────────────────────────────────────────
  const cardTitle = hasFeatures ? 'Generated modules &amp; features' : 'Generated modules';
  let metaParts = [`${totalModules} modules`];
  if (hasFeatures) metaParts.push(`${totalFeatures} features`);
  metaParts.push(`${confidence}% confidence`);

  let html = `<div class="builder-card" id="builder-card">`;
  html += `<div class="builder-card-header" onclick="toggleBuilderCard(this)">
    <span class="builder-card-title">${cardTitle}</span>
    <span class="builder-card-meta">${metaParts.join(' · ')}</span>
    <span class="builder-card-chevron" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
  </div>
  <div class="builder-card-body">`;

  // ── PAGES block (fixed header, no sections) ─────────────────────────────
  if (pages.length > 0) {
    html += `<div class="builder-block-header">Pages</div>`;
    pages.forEach(page => {
      html += renderModuleRow(page, 'builder-page');
    });
  }

  // ── MODULES block (fixed header, then sections inside) ───────────────────
  const hasModules = sections.length > 0 || flatModules.length > 0;
  if (hasModules) {
    html += `<div class="builder-block-header">Modules</div>`;

    if (sections.length > 0) {
      // sections = functional categories (single app) or app names (multi app)
      sections.forEach(sec => {
        html += `<div class="builder-section-label">${escHtml(sec.name)}</div>`;
        (sec.modules || []).forEach(mod => {
          html += renderModuleRow(mod, 'builder-module', diffOpts);
        });
      });
    } else {
      // flat modules — no sections from LLM, render directly
      flatModules.forEach(mod => {
        html += renderModuleRow(mod, 'builder-module', diffOpts);
      });
    }
  }

  // ── Global assumptions footer ─────────────────────────────────────────────
  const hasAssumptions = globalAssumps.length > 0;
  if (globalAssumps.length > 0) {
    const GA_VISIBLE = 6;
    const visibleItems = globalAssumps.slice(0, GA_VISIBLE)
      .map(a => `<li>${escHtml(a)}</li>`).join('');
    const hiddenItems = globalAssumps.slice(GA_VISIBLE)
      .map(a => `<li>${escHtml(a)}</li>`).join('');
    const overflow = globalAssumps.length - GA_VISIBLE;
    html += `<div class="builder-assumptions">
      <span class="builder-confidence-badge">${confidence}% confidence · ${label}</span>
      <ul class="assumption-list">
        ${visibleItems}
        ${hiddenItems ? `<span class="assumption-hidden" style="display:none;">${hiddenItems}</span>` : ''}
      </ul>
      ${overflow > 0 ? `<button class="assumption-toggle" onclick="toggleAssumptions(this)" data-more="${overflow}">Show ${overflow} more</button>` : ''}
    </div>`;
  }

  // resolve-card removed — resolve flow now uses cb-widget as chat message

  html += `</div>`; // close .builder-card-body
  html += `</div>`; // close .builder-card

  // Log for JSON persistence
  if (!_restoring) _messageLog.push({ type: 'builder', data: r });

  // Append as assistant message
  removeAllNextActions();
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = html;
  document.getElementById('messages').appendChild(el);
  scrollToBottom();

  // Show builder actions as NA commands
  if (!_restoring) {
    const genType = r.generation_type || state._proposedStructure?.generation_type || state.existing_structure?.generation_type || 'modules';
    const conf = state.project_context?.confidence || r.confidence || 0;
    const isDiff = !!state._proposedStructure?.diff;
    const na = resolveNextActions(`[NA:BUILDER_CARD|ASSUMPTIONS:${globalAssumps.length}|GENTYPE:${genType}|CONFIDENCE:${conf}|DIFF:${isDiff ? '1' : '0'}]`);
    renderNextActions(na);
  }
}

// renderModulesByLabel removed — sections now come directly from LLM output

// Build a page per uploaded document from state._projectNotes, grouped by source.
// Each page = top-level (no section), named "Notes (DD.MM.YYYY)".
function buildProjectNotePages() {
  const notes = state._projectNotes || [];
  if (notes.length === 0) return [];
  const docs = (state.inputs || []).filter(i => i.source === 'document');

  // Group notes by lowercased source.
  const groups = new Map();
  for (const n of notes) {
    if (typeof n !== 'object' || n === null) continue;
    const src = String(n.source || '').toLowerCase() || '__unsourced__';
    if (!groups.has(src)) groups.set(src, []);
    groups.get(src).push(n);
  }

  const pages = [];
  // IDs must be stable across calls — using Date.now() would make every diff
  // see the pages as "new" and the additive merge would duplicate them.
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'doc';
  docs.forEach((d, idx) => {
    // Prefer matching by the document input's stable id, fall back to filename
    // for notes that were tagged before this migration.
    const items = groups.get(String(d.id   || '').toLowerCase())
               || groups.get(String(d.name || '').toLowerCase());
    if (!items || items.length === 0) return;
    const date = (typeof extractDateFromText === 'function' ? extractDateFromText(d.text) : null)
              || (typeof extractDateFromFilename === 'function' ? extractDateFromFilename(d.name) : null);
    const dateLabel = date && typeof formatDate === 'function' ? formatDate(date) : null;
    const name = dateLabel ? `Notes (${dateLabel})` : `Notes (Doc ${idx + 1})`;
    pages.push({
      id: `synth_pn_${slugify(d.id || d.name || `doc_${idx}`)}`,
      name,
      summary: `${items.length} planning / organizational item${items.length > 1 ? 's' : ''}`,
      checkbox_items: items.map(it => ({ title: it.title || '', summary: it.summary || '' })),
      synthetic: 'project_notes',
    });
  });

  const unsourced = groups.get('__unsourced__');
  if (unsourced && unsourced.length > 0) {
    pages.push({
      id: `synth_pn_misc`,
      name: 'Notes',
      summary: `${unsourced.length} item${unsourced.length > 1 ? 's' : ''}`,
      checkbox_items: unsourced.map(it => ({ title: it.title || '', summary: it.summary || '' })),
      synthetic: 'project_notes',
    });
  }
  return pages;
}

// Short date formatter — "Apr 18" style. Honors project_language when set.
function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const lang = (state.project_language || 'en').toLowerCase();
  try {
    return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(d);
  }
}

// Render one summary history entry as a .sh-box block.
//   entry: { text, date?, source? }
//   kind:  'prev' | 'next' | 'new' | 'initial'
//     - 'initial' = builder card first generate (no label, just date, grey)
//   scale: 'module' (default) | 'feature' — feature mode uses tighter padding
function renderSummaryBox(entry, kind, scale) {
  const date  = entry?.date ? formatShortDate(entry.date) : '';
  let head = '';
  if (kind === 'initial') {
    head = date; // no label word — section-label "Summary" above already names it
  } else {
    const label = kind === 'prev' ? 'Previous' : kind === 'next' ? 'Updated' : 'Added';
    head = date ? `${label} · ${date}` : label;
  }
  const scaleCls = scale === 'feature' ? ' sh-box-feature' : '';
  return `<div class="sh-box sh-box-${kind}${scaleCls}">
    ${head ? `<div class="sh-box-head">${escHtml(head)}</div>` : ''}
    <div class="sh-box-text">${escHtml(entry?.text || '')}</div>
  </div>`;
}

function renderModuleRow(item, cssClass, diffOpts) {
  // Synthetic project-notes page — renders a checkbox list instead of features/assumptions
  if (item?.synthetic === 'project_notes' && Array.isArray(item.checkbox_items)) {
    const count = item.checkbox_items.length;
    const pageId = item.id || '';
    const listHtml = item.checkbox_items.map((it, idx) => {
      const title   = escHtml(it.title || '');
      const summary = escHtml(it.summary || '');
      const noteId  = escHtml(it.id || `${pageId}_note_${idx}`);
      return `<label class="builder-checkbox-item" onclick="event.stopPropagation()">
        <input type="checkbox" class="builder-select-checkbox builder-select-note" data-id="${noteId}" data-parent-id="${escHtml(pageId)}" checked>
        <span class="builder-checkbox-text"><strong>${title}</strong>${summary ? `: ${summary}` : ''}</span>
      </label>`;
    }).join('');
    const pageCb = `<input type="checkbox" class="builder-select-checkbox builder-select-page" data-id="${escHtml(pageId)}" checked onclick="event.stopPropagation()" onchange="onBuilderSelectToggle(this)">`;
    return `<div class="builder-row ${cssClass} builder-row-project-notes" data-id="${escHtml(pageId)}" onclick="this.classList.toggle('open')">
      <div class="builder-row-header">
        <div class="builder-row-left">
          ${pageCb}
          <span class="builder-row-chevron">&#9658;</span>
          <span class="builder-row-name">${escHtml(item.name)}</span>
          <span class="feature-count-badge">${count} item${count > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="builder-row-summary">
        ${(() => {
          const s = currentSummaryText(item.summary);
          return s ? `<div class="builder-detail-summary">${escHtml(s)}</div>` : '';
        })()}
        <div class="builder-checkbox-list">${listHtml}</div>
      </div>
    </div>`;
  }

  const hasAssumptions = item.assumptions?.length > 0;
  const featureCount   = item.features?.length || 0;

  // Count total open points: module-level + feature-level
  const moduleOpenCount  = (item.assumptions || []).length;
  const featureOpenCount = (item.features || []).reduce((s, f) => s + (f.assumptions?.length || 0), 0);
  const totalOpenCount   = moduleOpenCount + featureOpenCount;

  // Diff context — drives whether we render a prev/next comparison or a fresh NEW box.
  const isNewInDiff  = !!diffOpts?.newIds?.has(item.id);
  const isUpdInDiff  = !!(diffOpts?.updMap?.has(item.id) || diffOpts?.renamedMap?.has(item.id));

  // ── SUMMARY section — history-aware via .sh-box blocks ────────────────────
  // For UPDATED modules in a diff, only render when the summary text actually
  // changed (= history grew to 2+ entries). If history is still length 1 the
  // module made it into updated_modules[] for assumption/feature reasons only —
  // skip the section so it doesn't show stale text under an "Updated" label.
  let summaryBoxes = '';
  const history = Array.isArray(item.summary) ? item.summary : (typeof item.summary === 'string' && item.summary.trim() ? [{ text: item.summary }] : []);
  if (history.length > 0) {
    if (isUpdInDiff && history.length >= 2) {
      summaryBoxes =
        renderSummaryBox(history[history.length - 2], 'prev') +
        renderSummaryBox(history[history.length - 1], 'next');
    } else if (isUpdInDiff) {
      // Updated module, summary text unchanged → no summary section in the diff card.
      summaryBoxes = '';
    } else if (isNewInDiff) {
      // NEW module in a diff — green "Added" box to stand out.
      summaryBoxes = renderSummaryBox(history[history.length - 1], 'new');
    } else {
      // Builder card (first generate, no diff context) — neutral grey box,
      // no "Added" label. The section-label "SUMMARY" above already names it.
      summaryBoxes = renderSummaryBox(history[history.length - 1], 'initial');
    }
  }

  // ── Expanded content ──────────────────────────────────────────────────────
  let detail = '';

  if (summaryBoxes) {
    detail += `<div class="sh-section"><div class="sh-section-label sh-section-label-first">Summary</div>${summaryBoxes}</div>`;
  }

  // Module-level open points AFTER summary
  if (hasAssumptions) {
    const items = item.assumptions.map(a => `<li>${escHtml(a)}</li>`).join('');
    detail += `<div class="sh-section">
      <div class="sh-section-label">Open points</div>
      <ul class="builder-detail-list">${items}</ul>
    </div>`;
  }

  // Helper — render a single feature row with a summary box and (optional) open points.
  const renderFeatureRow = (f, statusTag) => {
    const fHistory = Array.isArray(f.summary) ? f.summary : (typeof f.summary === 'string' && f.summary.trim() ? [{ text: f.summary }] : []);
    const fStatus  = f._diffStatus || null;
    let fSummaryBoxes = '';
    if (fHistory.length > 0) {
      if (fStatus === 'updated' && fHistory.length >= 2) {
        fSummaryBoxes =
          renderSummaryBox(fHistory[fHistory.length - 2], 'prev', 'feature') +
          renderSummaryBox(fHistory[fHistory.length - 1], 'next', 'feature');
      } else if (fStatus === 'updated') {
        // Updated feature without a real summary change — skip the box.
        fSummaryBoxes = '';
      } else if (fStatus === 'new') {
        // NEW feature inside an updated module — green "Added" to highlight.
        fSummaryBoxes = renderSummaryBox(fHistory[fHistory.length - 1], 'new', 'feature');
      } else {
        // Builder card (no diff) — neutral grey box, no "Added" label.
        fSummaryBoxes = renderSummaryBox(fHistory[fHistory.length - 1], 'initial', 'feature');
      }
    }

    const fAssumptions = f.assumptions || [];
    const fOpenCount   = fAssumptions.length;
    const fOpenHtml = fOpenCount > 0
        ? `<div class="sh-feature-opens">
            <ul class="builder-detail-list">${fAssumptions.map(a => `<li>${escHtml(a)}</li>`).join('')}</ul>
          </div>`
        : '';
    const fOpenBadge = fOpenCount > 0 ? `<span class="assumption-tag sh-open-badge">${fOpenCount}</span>` : '';

    const fBodyHtml = (fSummaryBoxes || fOpenHtml)
        ? `<div class="builder-feature-body">
            ${fSummaryBoxes}
            ${fOpenHtml}
          </div>`
        : '';
    const statusHtml = statusTag
        ? `<span class="sh-status-tag ${statusTag.kind === 'new' ? 'sh-status-new' : 'sh-status-upd'}">${escHtml(statusTag.text)}</span>`
        : '';
    return `<div class="builder-feature-row" onclick="event.stopPropagation();this.classList.toggle('open')">
      <div class="builder-feature-header">
        <input type="checkbox" class="builder-select-checkbox builder-select-feature" data-id="${escHtml(f.id || '')}" data-parent-id="${escHtml(item.id || '')}" checked onclick="event.stopPropagation()">
        <span class="builder-feature-chevron">&#9658;</span>
        <span class="builder-feature-name">${escHtml(f.name)}</span>
        <span class="builder-feature-spacer"></span>
        ${fOpenBadge}
        ${statusHtml}
      </div>
      ${fBodyHtml}
    </div>`;
  };

  const featureDiff = diffOpts?.featureDiffById?.get(item.id);
  if (featureDiff) {
    // Diff card — UPDATED module: show only NEW and UPDATED features + an
    // unchanged counter line.
    const { newFeatures, updatedFeatures, unchangedCount } = featureDiff;
    if (newFeatures.length > 0) {
      detail += `<div class="sh-section">
        <div class="sh-section-label">New features</div>
        <div class="builder-feature-list">${newFeatures.map(f => renderFeatureRow(f, { kind: 'new', text: 'New' })).join('')}</div>
      </div>`;
    }
    if (updatedFeatures.length > 0) {
      detail += `<div class="sh-section">
        <div class="sh-section-label">Updated features</div>
        <div class="builder-feature-list">${updatedFeatures.map(f => renderFeatureRow(f, { kind: 'upd', text: 'Updated' })).join('')}</div>
      </div>`;
    }
    if (unchangedCount > 0) {
      detail += `<div class="sh-unchanged-note">${unchangedCount} further feature${unchangedCount !== 1 ? 's' : ''} unchanged</div>`;
    }
  } else if (featureCount > 0) {
    // Builder card (non-diff) OR NEW module in diff — render all features.
    const featureItems = item.features.map(f => renderFeatureRow(f)).join('');
    detail += `<div class="sh-section">
      <div class="sh-section-label">Features</div>
      <div class="builder-feature-list">${featureItems}</div>
    </div>`;
  }

  const swatch = item.color ? `<span class="palette-swatch" style="background:${paletteColor(item.color)};"></span>` : '';

  // No per-row New/Updated/Renamed tag — the diff card's NEW / UPDATED section
  // headers already convey that grouping. Keeps the row header less noisy.
  const headerTag = '';

  const featureBadge = featureCount > 0
      ? `<span class="feature-count-badge">${featureCount} feature${featureCount > 1 ? 's' : ''}</span>`
      : '';

  const rowType = cssClass.includes('builder-page') ? 'page' : 'module';
  const selectCb = `<input type="checkbox" class="builder-select-checkbox builder-select-${rowType}" data-id="${escHtml(item.id || '')}" checked onclick="event.stopPropagation()" onchange="onBuilderSelectToggle(this)">`;

  return `<div class="builder-row ${cssClass}" data-id="${escHtml(item.id || '')}" onclick="this.classList.toggle('open')">
    <div class="builder-row-header">
      <div class="builder-row-left">
        ${selectCb}
        <span class="builder-row-chevron">&#9658;</span>
        ${swatch}
        <span class="builder-row-name">${escHtml(item.name)}</span>
        ${featureBadge}
      </div>
      <div class="builder-row-right">
        ${headerTag}
        ${totalOpenCount > 0 ? `<span class="assumption-tag">${totalOpenCount} open point${totalOpenCount > 1 ? 's' : ''}</span>` : ''}
      </div>
    </div>
    <div class="builder-row-summary">${detail}</div>
  </div>`;
}

// Cascade: toggling a module/page checkbox cascades to child features or notes.
function onBuilderSelectToggle(cb) {
  const row = cb.closest('.builder-row');
  if (!row) return;
  if (cb.classList.contains('builder-select-module')) {
    row.querySelectorAll('.builder-select-feature').forEach(f => { f.checked = cb.checked; });
  } else if (cb.classList.contains('builder-select-page')) {
    row.querySelectorAll('.builder-select-note').forEach(n => { n.checked = cb.checked; });
  }
}
window.onBuilderSelectToggle = onBuilderSelectToggle;

// ─── STRUCTURE ACTION HANDLER ─────────────────────────────────────────────────

async function handleBuilderAction(action) {
  disablePreviousStructureCards();

  if (action === 'insert') {
    // Collect unchecked ids from the most recent builder card (user-selected exclusions).
    const cards = document.querySelectorAll('.builder-card');
    const lastCard = cards[cards.length - 1];
    const excludedPages    = new Set();
    const excludedModules  = new Set();
    const excludedFeatures = new Set();
    const excludedNotes    = new Set();
    if (lastCard) {
      lastCard.querySelectorAll('.builder-select-page:not(:checked)').forEach(cb => excludedPages.add(cb.dataset.id));
      lastCard.querySelectorAll('.builder-select-module:not(:checked)').forEach(cb => excludedModules.add(cb.dataset.id));
      lastCard.querySelectorAll('.builder-select-feature:not(:checked)').forEach(cb => excludedFeatures.add(cb.dataset.id));
      lastCard.querySelectorAll('.builder-select-note:not(:checked)').forEach(cb => excludedNotes.add((cb.textContent || '') + '|' + cb.dataset.id));
    }

    // Drop unchecked project notes from state so the rebuilt synthetic page reflects selection.
    if (excludedNotes.size > 0 && Array.isArray(state._projectNotes)) {
      const uncheckedTitles = new Set();
      lastCard.querySelectorAll('.builder-select-note:not(:checked)').forEach(cb => {
        const label = cb.closest('.builder-checkbox-item');
        const titleEl = label?.querySelector('strong');
        if (titleEl) uncheckedTitles.add((titleEl.textContent || '').trim().toLowerCase());
      });
      state._projectNotes = state._projectNotes.filter(n => {
        const t = (typeof n === 'object' ? n.title : n) || '';
        return !uncheckedTitles.has(String(t).trim().toLowerCase());
      });
    }

    // The proposed tree came from the last generate/diff response.
    const proposed = state._proposedStructure || {};
    const isDiffMerge = !!proposed.diff;
    let newCount = 0;
    let updatedCount = 0;
    let finalIsDiffMerge  = isDiffMerge;
    let finalNewCount     = 0;
    let finalUpdatedCount = 0;

    let pages, sections, modules;

    if (isDiffMerge) {
      // ── Additive merge onto the committed tree. NEVER delete existing modules ──
      const committed   = state.existing_structure || { pages: [], sections: [], modules: [] };
      const diffNewIds     = new Set((proposed.diff.new     || []).map(m => m.id));
      const diffUpdatedIds = new Set((proposed.diff.updated || []).map(m => m.id));

      // Deep clone the committed tree as the merge base.
      const base = JSON.parse(JSON.stringify(committed));
      base.pages    = base.pages    || [];
      base.sections = base.sections || [];
      base.modules  = base.modules  || [];

      // Helper — find the container array holding a module id in the base tree.
      const findModuleContainer = (id) => {
        for (const s of base.sections) {
          if ((s.modules || []).some(m => m.id === id)) return s.modules;
        }
        if ((base.modules || []).some(m => m.id === id)) return base.modules;
        return null;
      };

      const applyFeatureFilter = (mod) => ({
        ...mod,
        features: (mod.features || []).filter(f => !excludedFeatures.has(f.id)),
      });

      const applyModule = (mod, fallbackSectionId) => {
        if (excludedModules.has(mod.id)) return; // unchecked — skip
        const finalMod = applyFeatureFilter(mod);
        const container = findModuleContainer(mod.id);
        if (container) {
          const idx = container.findIndex(x => x.id === mod.id);
          if (idx >= 0) container[idx] = finalMod;
          if (diffUpdatedIds.has(mod.id)) updatedCount++;
          return;
        }
        // New module — add to matching section or flat.
        if (fallbackSectionId) {
          let targetSection = base.sections.find(s => s.id === fallbackSectionId);
          if (!targetSection) {
            const fromProposed = (proposed.sections || []).find(s => s.id === fallbackSectionId);
            targetSection = { ...(fromProposed || { id: fallbackSectionId }), modules: [] };
            base.sections.push(targetSection);
          }
          targetSection.modules = targetSection.modules || [];
          targetSection.modules.push(finalMod);
        } else {
          base.modules.push(finalMod);
        }
        if (diffNewIds.has(mod.id)) newCount++;
      };

      for (const sec of (proposed.sections || [])) {
        for (const m of (sec.modules || [])) applyModule(m, sec.id);
      }
      for (const m of (proposed.modules || [])) applyModule(m, null);

      // Pages — additive: replace by id if matches, else append.
      for (const p of (proposed.pages || [])) {
        if (excludedPages.has(p.id)) continue;
        const idx = base.pages.findIndex(x => x.id === p.id);
        if (idx >= 0) base.pages[idx] = p;
        else base.pages.push(p);
      }

      pages    = base.pages;
      sections = base.sections;
      modules  = base.modules;

      // Tree dots — from the LLM's own diff entries (module type only).
      state._treeDots = state._treeDots || {};
      for (const m of (proposed.diff.new || [])) {
        if (m.type === 'page') continue;
        if (!excludedModules.has(m.id)) state._treeDots[m.id] = 'new';
      }
      for (const m of (proposed.diff.updated || [])) {
        if (m.type === 'page') continue;
        if (!excludedModules.has(m.id)) state._treeDots[m.id] = 'updated';
      }

      // Fallback — ids may not match. Recompute by comparing committed tree
      // against the PROPOSED modules (so we see actual name/summary/assumption
      // drift, not post-merge noise).
      if (newCount === 0 && updatedCount === 0) {
        const committedModMap = new Map();
        for (const s of (committed.sections || [])) {
          for (const m of (s.modules || [])) committedModMap.set(m.id, m);
        }
        for (const m of (committed.modules || [])) committedModMap.set(m.id, m);
        const proposedModules = [
          ...(proposed.sections || []).flatMap(s => s.modules || []),
          ...(proposed.modules  || []),
        ];
        for (const m of proposedModules) {
          if (excludedModules.has(m.id)) continue;
          const prev = committedModMap.get(m.id);
          if (!prev) {
            newCount++;
            state._treeDots[m.id] = 'new';
          } else {
            const prevFeatureIds = JSON.stringify((prev.features || []).map(f => f.id));
            const newFeatureIds  = JSON.stringify((m.features    || []).map(f => f.id));
            if (prev.name !== m.name || currentSummaryText(prev.summary) !== currentSummaryText(m.summary)
                || JSON.stringify(prev.assumptions || []) !== JSON.stringify(m.assumptions || [])
                || prevFeatureIds !== newFeatureIds) {
              updatedCount++;
              state._treeDots[m.id] = 'updated';
            }
          }
        }
      }

      // Last resort — trust the LLM's diff-object lengths.
      if (newCount === 0 && updatedCount === 0) {
        newCount     = (proposed.diff.new     || []).filter(e => e.type !== 'page').length;
        updatedCount = (proposed.diff.updated || []).filter(e => e.type !== 'page').length;
      }

      finalIsDiffMerge  = true;
      finalNewCount     = newCount;
      finalUpdatedCount = updatedCount;
    } else {
      // ── Normal insert: filter the PROPOSED structure by checkbox exclusions.
      // existing_structure may be null pre-first-insert — always read from the
      // proposed tree.
      const srcPages    = proposed.pages    || [];
      const srcSections = proposed.sections || [];
      const srcModules  = proposed.modules  || [];

      const filterFeatures = (features) => (features || []).filter(f => !excludedFeatures.has(f.id));
      const filterModules  = (mods) => (mods || [])
        .filter(m => !excludedModules.has(m.id))
        .map(m => ({ ...m, features: filterFeatures(m.features) }));

      pages    = srcPages.filter(p => !excludedPages.has(p.id));
      modules  = filterModules(srcModules);
      sections = srcSections
        .map(s => ({ ...s, modules: filterModules(s.modules) }))
        .filter(s => (s.modules || []).length > 0);
    }

    state.existing_structure = {
      pages,
      sections,
      modules,
      generation_type: proposed.generation_type || state.existing_structure?.generation_type || 'modules',
      confidence:      proposed.confidence      || state.existing_structure?.confidence      || state.project_context?.confidence || 0,
      inserted:        true,
      inserted_at:     new Date().toISOString(),
    };
    // Merge/insert committed — drop the proposed slot.
    state._proposedStructure = null;
    state._mode = 'chat';
    updateContextTag();
    // Collapse the inserted builder card — user can still expand it by clicking the header.
    if (lastCard) lastCard.classList.add('collapsed');

    // Frontend-generated chat response — no LLM call.
    const genType = state.existing_structure.generation_type;
    const totalModulesAfter = [
      ...(state.existing_structure.sections?.flatMap(s => s.modules || []) || []),
      ...(state.existing_structure.modules || []),
    ].length;
    const totalFeaturesAfter = [
      ...(state.existing_structure.sections?.flatMap(s => s.modules || []) || []),
      ...(state.existing_structure.modules || []),
    ].reduce((sum, m) => sum + (m.features?.length || 0), 0);

    const bullets = [
      '• Upload more documents or meeting transcripts',
      '• Enrich your context with discovery questions',
      '• Generate descriptions, user stories, or estimations',
    ].join('\n');

    console.log('[Insert]', { finalIsDiffMerge, finalNewCount, finalUpdatedCount });

    let headline;
    if (finalIsDiffMerge) {
      if (finalNewCount > 0 && finalUpdatedCount > 0) {
        headline = `✅ ${finalNewCount} new and ${finalUpdatedCount} updated module${finalUpdatedCount !== 1 ? 's' : ''} merged into the project.`;
      } else if (finalNewCount > 0) {
        headline = `✅ ${finalNewCount} new module${finalNewCount !== 1 ? 's' : ''} added to the project.`;
      } else if (finalUpdatedCount > 0) {
        headline = `✅ ${finalUpdatedCount} module${finalUpdatedCount !== 1 ? 's' : ''} updated in the project.`;
      } else {
        headline = `✅ Structure merged into the project.`;
      }
    } else if (genType === 'modules_features' || totalFeaturesAfter > 0) {
      headline = `✅ ${totalModulesAfter} module${totalModulesAfter !== 1 ? 's' : ''} with ${totalFeaturesAfter} feature${totalFeaturesAfter !== 1 ? 's' : ''} added to the project.`;
    } else {
      headline = `✅ ${totalModulesAfter} module${totalModulesAfter !== 1 ? 's' : ''} added to the project.`;
    }

    const insertMsgText = `**${headline}**\n\n**What's next?**\n\n${bullets}`;
    addAssistantMessage({ text: insertMsgText, hint: null }, resolveNextActions(buildBuilderInsertedTag()), 'insert');
    if (typeof renderLeftNavTree === 'function') renderLeftNavTree();
    updateStatePanel();
    return;
  }

  if (action === 'view_full') {
    // Re-render as full builder card — from the in-flight proposed tree if any,
    // else the committed tree.
    const src = state._proposedStructure || state.existing_structure;
    renderBuilderCard({ ...(src || {}), status: 'completed', confidence: src?.confidence || 0 });
    return;
  }


  if (action === 'discard') {
    // Discard = throw away the generated/proposed structure. The original chat
    // state (inputs, captured_topics, open_points, project_summary) is PRESERVED.
    // existing_structure (the committed tree) is NEVER touched by discard — it
    // only changes on insert/merge.

    // Clear whatever was on the builder/diff card.
    state._proposedStructure = null;
    state._resolvedAnswers = [];
    state._mode = 'chat';
    updateContextTag();
    addUserMessage([{ type: 'text', text: 'Discarded' }]);

    // If a structure was already inserted, we stay on the committed tree and
    // show the post-insert NA (same as normal chat with an existing tree).
    if (state.existing_structure?.inserted === true) {
      addAssistantMessage(
          { text: 'Changes discarded. Your project tree is unchanged.', hint: null },
          resolveNextActions(buildBuilderInsertedTag()),
          'builder_discard'
      );
      if (typeof renderLeftNavTree === 'function') renderLeftNavTree();
      updateStatePanel();
      return;
    }

    // Fresh project (no commit yet) — render the "continue with summary" recap.
    const lang    = (state.project_language || 'en').toLowerCase();
    const openings = {
      en: 'You are continuing with the current project:',
      de: '**Du arbeitest weiterhin am aktuellen Projekt:**',
      fr: 'Vous continuez avec le projet actuel :',
      es: 'Continúas con el proyecto actual:',
      it: 'Continui con il progetto attuale:',
      pt: 'Você continua com o projeto atual:',
      tr: 'Mevcut projeye devam ediyorsun:',
      nl: 'Je gaat verder met het huidige project:',
    };
    const opening = openings[lang] || openings.en;
    const summary = state.project_summary || '';

    const confidence = state.project_context?.confidence || 35;
    const nextActions = resolveNextActions(`[NA:GENERATE|CONFIDENCE:${confidence}]`);
    addAssistantMessage(
        { text: `${opening} ${summary}`.trim(), hint: null },
        nextActions,
        'builder_discard'
    );
    updateStatePanel();
    return;
  }

  if (action === 'enrich_context') {
    state._enrichDepthSource = 'builder';
    const na = resolveNextActions('[NA:ENRICH_DEPTH]');
    if (na) {
      renderNextActions(na);
      if (typeof activateFirstNaBtn === 'function') activateFirstNaBtn();
    }
    return;
  }

  if (action === 'resolve_assumptions') {
    addUserMessage([{ type: 'text', text: 'Resolve open points' }]);

    // If we already have questions cached — show immediately (e.g. after re-render)
    if (_lastOpenQuestions.length > 0) {
      showResolveWidget(_lastOpenQuestions);
      return;
    }

    // Collect assumptions from modules + features of the CURRENT builder card
    // (the proposed tree) — resolve runs while iterating on the card, before commit.
    const existing = state._proposedStructure || state.existing_structure || {};
    const allModules = [
      ...(existing.pages || []),
      ...(existing.sections || []).flatMap(s => s.modules || []),
      ...(existing.modules || [])
    ];
    const globalAssumptions = [...new Set(
        allModules.flatMap(m => [
          ...(m.assumptions || []),
          ...(m.features || []).flatMap(f => f.assumptions || []),
        ]).filter(Boolean)
    )];
    if (globalAssumptions.length === 0) return;

    try {
      // INTERVIEW solve_open_points — convert the local "assumptions" naming
      // back to the prompt's "global_open_points" slot. Each item must be
      // { text, element_name, element_id } per the prompt spec; the local
      // collection is flat strings, so wrap them.
      const global_open_points = globalAssumptions.map(t => ({ text: t, element_name: null, element_id: null }));
      const payload = payloadForInterview({
        mode:               'solve_open_points',
        phase:              'questions',
        global_open_points,
      });

      const response = await callAgent('interview', payload);

      if (response.status === 'questions_ready' && response.open_questions?.length > 0) {
        // Filter out enrich_topics — after resolve, regenerate directly without enrich step
        const questions = response.open_questions.filter(q => q.id !== 'enrich_topics');
        _lastOpenQuestions = questions;
        if (questions.length > 0) {
          showResolveWidget(questions);
        } else {
          // No real questions left — submit directly
          await submitResolvedAssumptions();
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') addErrorMessage(err.message);
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

  // Store resolved answers so Discard can use them
  state._resolvedAnswers = answers.map(a => ({
    topic: a.assumption?.split(' — ')[0] || a.assumption || 'Resolved point',
    detail: a.answer
  }));

  // Show as Q: / A: bubble
  const text = answers.map(a => 'Q: ' + (a.assumption || a.id) + '\nA: ' + a.answer).join('\n\n');
  addUserMessage([{ type: 'text', text: text }]);

  // Determine generation_type from existing builder output
  const genType = state.existing_structure?.generation_type || 'modules';

  try {
    // Separate resolve answers from enrich answers
    const resolveAnswers = answers.filter(a => !a.id?.startsWith('eq_') && a.id !== 'enrich_topics');
    const enrichAnswers  = answers.filter(a => a.id?.startsWith('eq_'));

    const payload = payloadForBuilder({
      mode:              'resolve',
      generation_type:   genType,
      resolve_questions: resolveAnswers,
    });
    // enrich answers (interview→builder handoff) aren't part of the prompt
    // INPUT spec — keep as a side-slot only when there's something to pass.
    if (enrichAnswers.length > 0) payload.enrich_answers = enrichAnswers;

    const response = await callAgent('builder', payload);
    await handleAgentResponse('builder', response);
  } catch (err) {
    if (err.name !== 'AbortError') addErrorMessage(err.message);
  }
}
// Expose for cross-file access
window.handleAgentResponse = handleAgentResponse;

// Toggle collapse/expand of a builder card when its header is clicked.
function toggleBuilderCard(headerEl) {
  const card = headerEl.closest('.builder-card');
  if (card) card.classList.toggle('collapsed');
}
window.toggleBuilderCard = toggleBuilderCard;

// Toggle show/hide for the overflow open-points list in the builder card footer.
function toggleAssumptions(btn) {
  const wrap = btn.previousElementSibling?.querySelector('.assumption-hidden');
  if (!wrap) return;
  const more = Number(btn.dataset.more || 0);
  const expanded = btn.dataset.expanded === '1';
  if (expanded) {
    wrap.style.display = 'none';
    btn.textContent = `Show ${more} more`;
    btn.dataset.expanded = '0';
  } else {
    wrap.style.display = 'contents';
    btn.textContent = 'Show less';
    btn.dataset.expanded = '1';
  }
}
window.toggleAssumptions = toggleAssumptions;
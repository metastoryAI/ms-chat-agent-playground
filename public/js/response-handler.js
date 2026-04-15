// ─── RESPONSE HANDLING ───────────────────────────────────────────────────────

// Hide action buttons on all previous builder cards so they can't be reused
function disablePreviousStructureCards() {
  removeAllNextActions();
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

  // ── Language change — replace lists instead of merging ─────────────────
  const _isLanguageChange = typeof userText === 'string' && userText.startsWith('Language changed to');
  if (_isLanguageChange) {
    state._capturedTopics = [];
    state._openPoints = [];
    state._projectNotes = [];
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

  if (r.action === 'analyze_input' && r.input) {
    const fi = { ...r.input, source: 'text', id: `fi_${Date.now()}`, added_at: new Date().toISOString() };
    state.inputs.push(fi);
    applyProjectSummary(r);
    if (r.captured_topics?.length) {
      state._capturedTopics = mergeTopics(state._capturedTopics || [], r.captured_topics);
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

  // Unified add/modify/remove — `r.target` picks the list:
  // "input" (default) | "captured_topic" | "open_point" | "project_note"
  if (r.action === 'add_input') {
    const target = r.target || 'input';
    if (target === 'open_point' && r.new_item) {
      const item = { title: String(r.new_item.title || '').trim(), summary: String(r.new_item.summary || '').trim() };
      if (item.title) {
        state._openPoints = [...(state._openPoints || []), item];
        state._topicTags[item.title.toLowerCase()] = 'NEW';
      }
    } else if (target === 'project_note' && r.new_item) {
      const item = { title: String(r.new_item.title || '').trim(), summary: String(r.new_item.summary || '').trim() };
      if (item.title) {
        state._projectNotes = [...(state._projectNotes || []), item];
        state._topicTags[item.title.toLowerCase()] = 'NEW';
      }
    } else if (target === 'input' && r.input) {
      const miId = `mi_${Date.now()}`;
      const mi = { ...r.input, source: 'additional', id: miId, added_at: new Date().toISOString() };
      state.inputs.push(mi);
      applyProjectSummary(r);
      if (r.captured_topics?.length) {
        state._capturedTopics = mergeTopics(state._capturedTopics || [], r.captured_topics);
      } else if (r.input?.topic) {
        const fallback = { title: r.input.topic, summary: String(r.input.detail || '').split(' ').slice(0, 8).join(' ') };
        state._capturedTopics = mergeTopics(state._capturedTopics || [], [fallback]);
      }
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

  // Store open_points from chat agent — dedup by title
  if (r.open_points !== undefined) {
    const normalize = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const getKey = (p) => normalize(typeof p === 'object' ? (p.title || '') : p);
    const existing = state._openPoints || [];
    const incoming = r.open_points || [];
    const seen = new Set();
    const merged = [];
    for (const p of [...existing, ...incoming]) {
      const k = getKey(p);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(p);
    }
    state._openPoints = merged;
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
    let nextActions = resolveNextActions(r.next_actions);

    // `answer` action always hides the next-actions bar — the hint points the user to `/`.
    // Force null even if the LLM disobeyed the prompt and returned a tag anyway.
    if (r.action === 'answer') {
      nextActions = null;
    } else if (!nextActions) {
      // Fallback: if LLM omitted next_actions tag for any non-answer action, derive from state.
      if (state.existing_structure) {
        nextActions = resolveNextActions('[NA:BUILDER_INSERTED]');
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
    }

    addAssistantMessage(r.chat_response, nextActions, r.action);

    // For answer mode, populate the NA bar with state-derived commands but keep it hidden.
    // Typing `/` in the input can then reveal it — otherwise the slash trigger would be dead.
    if (r.action === 'answer') {
      populateHiddenNextActions();
    }

    // ── Per-doc open points extraction (parallel) ────────────────────────
    if (willExtractOpenPoints) {
      for (const d of newDocs) {
        extractOpenPointsForDoc({ name: d.name, text: d.text }).finally(() => {
          state._openPointsLoadingCount = Math.max(0, (state._openPointsLoadingCount || 1) - 1);
          if (state._openPointsLoadingCount === 0) state._openPointsLoadingStart = null;
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
      if (agentKey === 'agent_builder') {
        if (state.existing_structure?.inserted === true) return 'diff';
        if (handoff.generation_type === 'modules_features') return 'generate_features';
        return 'generate';
      }
      if (agentKey === 'agent_interviewer') {
        return 'enrich_context';
      }
      return 'generate';
    })();

    const agentPayload = {
      to_agent:           agentKey,
      generation_type:    handoff.generation_type    || null,
      mode:               _autoMode,
      user_input:         handoff.user_input         || null,
      resolve_questions:  handoff.resolve_questions  || [],
      inputs:             state.inputs,
      project_summary:    state.project_summary,
      project_context:    state.project_context,
      existing_structure: state.existing_structure,
      open_points:        state._openPoints || [],
      resolved_points:    state._resolvedPoints || [],
      project_language:   state.project_language || null,
    };

    try {
      // Single bundled call — mode-prompts map for `generate` / `generate_features`
      // concatenates pages + modules + a merge footer so the LLM returns both slots at once.
      const agentResponse = await callAgent(agentKey, agentPayload, { setModelLabel: true });
      if (agentKey === 'agent_builder' && (_autoMode === 'generate' || _autoMode === 'generate_features')) {
        // Normalize top-level pages/sections into the envelope the handler expects.
        // Builder's atomic/bundled output doesn't carry project_context or confidence —
        // inherit those from the current state (set by chat agent during analyze_*).
        const normalized = {
          ...agentResponse,
          status:          agentResponse.status || 'completed',
          generation_type: handoff.generation_type || (_autoMode === 'generate_features' ? 'modules_features' : 'modules'),
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

// ─── OPEN POINTS EXTRACTION (separate call per document, parallel) ──────────

// Re-render the context card inside the last assistant message using current state.
function refreshContextCardInLastMessage() {
  const msgs = document.querySelectorAll('.msg.assistant');
  const lastMsg = msgs[msgs.length - 1];
  if (!lastMsg) return;
  const html = buildContextCardHTML();
  // Remove any existing tabbed card in this message and re-append a fresh one.
  lastMsg.querySelectorAll('.cc-tabbed-card').forEach(el => el.remove());
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

async function extractOpenPointsForDoc({ name, text }) {
  if (!text) return;
  const prompt = prompts['extract_open_points'];
  // Log this call in the Prompt Stack tab so users can see the extract_open_points
  // prompt was sent (it runs in parallel to analyze_document, outside getPromptForAgent).
  if (typeof recordPromptComposition === 'function') {
    recordPromptComposition('extract_open_points', name, ['extract_open_points']);
  }
  if (!prompt) { console.warn('[OpenPoints] extract_open_points prompt not loaded'); return; }

  const docBlock = `[DOCUMENT: ${name}]\n\n${text}`;
  const payload = { document_text: docBlock, project_language: state.project_language || null };

  try {
    const key = getActiveKey();
    if (!key) return;
    const userMsg = JSON.stringify(payload, null, 2);
    const content = docBlock + '\n\n' + userMsg;
    const model = getModelForAgent('agent_chat');

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

    // Tag entries from extraction with source only. No NEW badge — the user
    // just uploaded the document, every extracted item is trivially "new", so
    // the badge adds noise. NEW is reserved for explicit user changes (add_input).
    const tag = (p) => ({ ...p, source: p.source || name });
    const newOpen  = Array.isArray(response?.open_points)   ? response.open_points.map(tag)   : [];
    const newNotes = Array.isArray(response?.project_notes) ? response.project_notes.map(tag) : [];
    if (newOpen.length  > 0) state._openPoints   = [...(state._openPoints   || []), ...newOpen];
    if (newNotes.length > 0) state._projectNotes = [...(state._projectNotes || []), ...newNotes];

    if (typeof showDebugOutput === 'function') showDebugOutput(response, 'extract_open_points');
    console.log('[OpenPoints] extracted', response?.open_points?.length || 0, 'points from', name);
  } catch (err) {
    console.warn('[OpenPoints] extraction failed for', name, '—', err.message);
  }
}

// ─── AGENT RESPONSE HANDLING ─────────────────────────────────────────────────

async function handleAgentResponse(agentKey, r) {

  // ── Structure Generator ───────────────────────────────────────────────────
  if (agentKey === 'agent_builder') {
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

    // Move resolved answers to _resolvedPoints (shown separately, not in captured topics)
    if (state._resolvedAnswers?.length > 0) {
      state._resolvedPoints = [...(state._resolvedPoints || []), ...state._resolvedAnswers];
      state._resolvedAnswers = [];
    }

    // completed — show builder card
    if (r.status === 'completed' || r.structure || r.modules || r.sections) {
      // Clear cached questions — new builder output means new assumptions
      _lastOpenQuestions = [];

      // Atomic mode responses (resolve/refine/etc.) return only the slots they touched —
      // preserve the rest from existing_structure instead of wiping them.
      // The generate flow wraps its result in r.structure (via the normalizer), so
      // r.structure.pages is always authoritative. Raw responses from resolve/refine may
      // include empty pages/modules as LLM filler — only treat non-empty arrays or
      // explicit r.structure slots as intentional.
      const hasPages    = (r.structure?.pages    !== undefined) || (r.pages?.length    > 0);
      const hasSections = (r.structure?.sections !== undefined) || (r.sections?.length > 0);
      const hasModules  = (r.structure?.modules  !== undefined) || (r.modules?.length  > 0);

      const struct = r.structure || { pages: r.pages, sections: r.sections, modules: r.modules };

      let pages    = hasPages    ? (struct.pages    || []) : (state.existing_structure?.pages    || []);
      let sections = hasSections ? (struct.sections || []) : (state.existing_structure?.sections || []);
      let modules  = hasModules  ? (struct.modules  || []) : (state.existing_structure?.modules  || []);
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

      // Snapshot previous modules BEFORE updating state — needed for diff comparison
      const prevSnapshot = snapshotModules();

      state.existing_structure = {
        pages,
        sections,
        modules,
        generation_type: r.generation_type || state.existing_structure?.generation_type || 'modules',
        confidence:      r.confidence || state.existing_structure?.confidence || state.project_context?.confidence || 0,
        inserted:        false,
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
        addAssistantMessage(r.chat_response, null, 'agent_builder');
      }
      updateStatePanel();
      return;
    }

    // diff_completed — render diff card
    if (r.status === 'diff_completed') {
      const struct = r.structure || {};

      // Build a map of assumptions from the previous state keyed by module id.
      // The LLM only returns what changed — unchanged modules often come back
      // without assumptions[], which would wipe out the "open points" tags.
      const prevModules = [
        ...(state.existing_structure?.pages    || []),
        ...(state.existing_structure?.sections?.flatMap(s => s.modules || []) || []),
        ...(state.existing_structure?.modules  || []),
      ];
      const prevAssumpMap = new Map(prevModules.map(m => [m.id, m.assumptions || []]));

      const mergeAssumptions = (modules) =>
          (modules || []).map(m => ({
            ...m,
            assumptions: (m.assumptions?.length > 0)
                ? m.assumptions
                : (prevAssumpMap.get(m.id) || []),
          }));

      const mergedPages    = mergeAssumptions(struct.pages);
      const mergedModules  = mergeAssumptions(struct.modules);
      const mergedSections = (struct.sections || []).map(sec => ({
        ...sec,
        modules: mergeAssumptions(sec.modules),
      }));

      // Patch r.structure so renderDiffCard also sees the merged assumptions
      const mergedStruct = {
        ...struct,
        pages:    mergedPages,
        modules:  mergedModules,
        sections: mergedSections,
      };
      const rPatched = { ...r, structure: mergedStruct };

      // Snapshot previous modules BEFORE updating state — needed for diff comparison
      const prevSnapshot = snapshotModules();

      state.existing_structure = {
        pages:           mergedPages,
        sections:        mergedSections,
        modules:         mergedModules,
        generation_type: r.generation_type || 'modules',
        confidence:      r.confidence || 0,
        inserted:        true,
      };
      renderDiffCard(rPatched, prevSnapshot);
      updateStatePanel();
      return;
    }
  }

  // ── Interviewer Agent (enrich flow) ──────────────────────────────────────
  if (agentKey === 'agent_interviewer') {
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
      }
      if (r.project_context) {
        state.project_context = { ...(state.project_context || {}), ...r.project_context };
      }
      if (state._mode === 'builder') {
        if (r.chat_response) addAssistantMessage(r.chat_response, null, 'enrich_context');
        showBuilderCardNA();
      } else {
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
      // No answers — send through chat agent for a clean project recap
      const input = document.getElementById('user-input');
      if (input) {
        input.value = 'Context closed';
        sendMessage();
      }
    }
  }
  updateStatePanel();
}

// Helper: populate the NA bar with state-derived commands and immediately hide it.
// Used in answer mode so that typing `/` in the chat input can still reveal commands.
function populateHiddenNextActions() {
  let tag = null;
  if (state.existing_structure) {
    tag = '[NA:BUILDER_INSERTED]';
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

// Helper: show builder card NA commands based on current state
function showBuilderCardNA() {
  if (!state.existing_structure) return;
  const allMods = [
    ...(state.existing_structure.sections?.flatMap(s => s.modules || []) || []),
    ...(state.existing_structure.modules || []),
    ...(state.existing_structure.pages || []),
  ];
  const assumptionCount = [...new Set(allMods.flatMap(m => [
    ...(m.assumptions || []),
    ...(m.features || []).flatMap(f => f.assumptions || []),
  ]).filter(Boolean))].length;
  const na = resolveNextActions(`[NA:BUILDER_CARD|ASSUMPTIONS:${assumptionCount}]`);
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
  if (!bar || !label) return;
  if (state._mode === 'builder') {
    const textEl = label.querySelector('.context-tag-text');
    if (textEl) textEl.textContent = 'Builder';
    bar.style.display = 'flex';
    if (input) input.placeholder = 'Add, rename, remove... or / for options';
  } else {
    bar.style.display = 'none';
    if (input) input.placeholder = 'Type a message...';
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
  const diff = r.diff || { new: [], updated: [], unchanged: [] };
  const newIds = new Set((diff.new || []).map(m => m.id));

  // Use snapshot of previous modules (before state was updated)
  prevModules = prevModules || [];
  const prevNameById = new Map(prevModules.map(m => [m.id, m.name?.toLowerCase()]));

  // Classify updated[]: renamed (name changed) vs updated (content changed)
  const renamedMap = new Map();
  const updMap     = new Map();
  for (const m of (diff.updated || [])) {
    const oldName = prevNameById.get(m.id);
    const newName = m.name?.toLowerCase();          // diff entry always carries new name
    const prevName = prevModules.find(p => p.id === m.id)?.name || oldName || '';
    if (oldName && newName && oldName !== newName) {
      renamedMap.set(m.id, `Renamed from ${prevName}`);
    } else {
      updMap.set(m.id, m.changes);
    }
  }


  console.log('[Diff]', { new: [...newIds], renamed: [...renamedMap.entries()], updated: [...updMap.entries()] });
  renderBuilderCard(r, { newIds, updMap, renamedMap });
}

// ─── STRUCTURE CARD RENDERER ─────────────────────────────────────────────────

// Stores open_questions from last builder response — used by resolve card
let _lastOpenQuestions = [];

function renderBuilderCard(r, diffOpts) {
  const struct          = r.structure || r; // support both new {structure:{}} and old flat format
  const pages           = struct.pages    || [];
  const sections        = struct.sections || [];
  const flatModules     = struct.modules  || [];
  const confidence      = r.confidence   || '?';
  // Derive label from confidence + open points — don't rely on LLM
  const _hasOpenPoints = (() => {
    const allMods = [...pages, ...sections.flatMap(s=>s.modules||[]), ...flatModules];
    return allMods.some(m =>
        (m.assumptions?.length > 0) ||
        (m.features || []).some(f => f.assumptions?.length > 0)
    );
  })();
  const label = _hasOpenPoints
      ? (r.confidence >= 75 ? 'minor open points' : 'with open points')
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
  html += `<div class="builder-card-header">
    <span class="builder-card-title">${cardTitle}</span>
    <span class="builder-card-meta">${metaParts.join(' · ')}</span>
  </div>`;

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
    html += `<div class="builder-assumptions">
      <span class="builder-confidence-badge">${confidence}% confidence · ${label}</span>
      <ul class="assumption-list">
        ${globalAssumps.map(a => `<li>${escHtml(a)}</li>`).join('')}
      </ul>
    </div>`;
  }

  // resolve-card removed — resolve flow now uses cb-widget as chat message

  html += `</div>`;

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
    const na = resolveNextActions(`[NA:BUILDER_CARD|ASSUMPTIONS:${globalAssumps.length}]`);
    renderNextActions(na);
  }
}

// renderModulesByLabel removed — sections now come directly from LLM output

function renderModuleRow(item, cssClass, diffOpts) {
  const hasAssumptions = item.assumptions?.length > 0;
  const featureCount   = item.features?.length || 0;

  // Count total open points: module-level + feature-level
  const moduleOpenCount  = (item.assumptions || []).length;
  const featureOpenCount = (item.features || []).reduce((s, f) => s + (f.assumptions?.length || 0), 0);
  const totalOpenCount   = moduleOpenCount + featureOpenCount;

  // ── Expanded content ──────────────────────────────────────────────────────
  let detail = '';

  if (item.summary) {
    detail += `<div class="builder-detail-summary">${escHtml(item.summary)}</div>`;
  }

  // Module-level open points BEFORE features
  if (hasAssumptions) {
    const items = item.assumptions.map(a => `<li>${escHtml(a)}</li>`).join('');
    detail += `<div class="builder-detail-section">
      <div class="builder-detail-label">Open points</div>
      <ul class="builder-detail-list">${items}</ul>
    </div>`;
  }

  if (featureCount > 0) {
    const featureItems = item.features.map(f => {
      const fAssumptions = f.assumptions || [];
      const fHasOpen = fAssumptions.length > 0;
      const fOpenHtml = fHasOpen
          ? `<div class="builder-feature-open-points">
            <ul class="builder-detail-list">${fAssumptions.map(a => `<li>${escHtml(a)}</li>`).join('')}</ul>
          </div>`
          : '';
      return `<div class="builder-feature-row">
        <div class="builder-feature-header">
          <span class="builder-feature-name">${escHtml(f.name)}</span>
        </div>
        ${f.summary ? `<span class="builder-feature-summary">${escHtml(f.summary)}</span>` : ''}
        ${fOpenHtml}
      </div>`;
    }).join('');
    detail += `<div class="builder-detail-section">
      <div class="builder-detail-label">Features</div>
      <div class="builder-feature-list">${featureItems}</div>
    </div>`;
  }

  const swatch = item.color ? `<span class="palette-swatch" style="background:${paletteColor(item.color)};"></span>` : '';

  // Diff badge
  let diffBadge = '';
  if (diffOpts) {
    if (diffOpts.newIds?.has(item.id)) {
      diffBadge = `<span class="diff-badge diff-badge-new">New</span>`;
    } else if (diffOpts.renamedMap?.has(item.id)) {
      const changes = diffOpts.renamedMap.get(item.id);
      diffBadge = `<span class="diff-badge diff-badge-renamed" title="${escHtml(changes||'')}">Renamed</span>`;
    } else if (diffOpts.updMap?.has(item.id)) {
      const changes = diffOpts.updMap.get(item.id);
      diffBadge = `<span class="diff-badge diff-badge-updated" title="${escHtml(changes||'')}">Updated</span>`;
    }
  }

  const featureBadge = featureCount > 0
      ? `<span class="feature-count-badge">${featureCount} feature${featureCount > 1 ? 's' : ''}</span>`
      : '';

  return `<div class="builder-row ${cssClass}" onclick="this.classList.toggle('open')">
    <div class="builder-row-header">
      <div class="builder-row-left">
        <span class="builder-row-chevron">&#9658;</span>
        ${swatch}
        <span class="builder-row-name">${escHtml(item.name)}</span>
        ${featureBadge}
      </div>
      <div class="builder-row-right">
        ${diffBadge}
        ${totalOpenCount > 0 ? `<span class="assumption-tag">${totalOpenCount} open point${totalOpenCount > 1 ? 's' : ''}</span>` : ''}
      </div>
    </div>
    <div class="builder-row-summary">${detail}</div>
  </div>`;
}

// ─── STRUCTURE ACTION HANDLER ─────────────────────────────────────────────────

async function handleBuilderAction(action) {
  disablePreviousStructureCards();

  if (action === 'insert') {
    state.existing_structure = {
      pages:           (state.existing_structure?.pages    || []),
      sections:        (state.existing_structure?.sections  || []),
      modules:         (state.existing_structure?.modules   || []),
      generation_type: state.existing_structure?.generation_type || 'modules',
      confidence:      state.existing_structure?.confidence || 0,
      inserted:        true,
      inserted_at:     new Date().toISOString(),
    };
    state._mode = 'chat';
    updateContextTag();
    addAssistantMessage('Inserted into project.', resolveNextActions('[NA:BUILDER_INSERTED]'), 'insert');
    updateStatePanel();
    return;
  }

  if (action === 'view_full') {
    // Re-render as full builder card
    renderBuilderCard({ ...state.existing_structure, status: 'completed', confidence: state.existing_structure?.confidence || 0 });
    return;
  }


  if (action === 'discard') {
    // Discard = throw away the generated structure. The original chat state
    // (inputs, captured_topics, open_points, project_summary) is PRESERVED —
    // nothing absorbed, no LLM call. A local Template-A style confirmation
    // message is rendered directly from current state.

    state.existing_structure = null;
    state._mode = 'chat';
    updateContextTag();

    // Resolved answers from the (now-discarded) generation are dropped too —
    // they belonged to the structure that was thrown away.
    state._resolvedAnswers = [];

    const lang    = (state.project_language || 'en').toLowerCase();
    const openings = {
      en: 'You are continuing with the current project:',
      de: 'Du arbeitest weiterhin am aktuellen Projekt:',
      fr: 'Vous continuez avec le projet actuel :',
      es: 'Continúas con el proyecto actual:',
      it: 'Continui con il progetto attuale:',
      pt: 'Você continua com o projeto atual:',
      tr: 'Mevcut projeye devam ediyorsun:',
      nl: 'Je gaat verder met het huidige project:',
    };
    const opening = openings[lang] || openings.en;
    const summary = state.project_summary || '';

    addUserMessage([{ type: 'text', text: 'Discarded' }]);

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
    removeAllNextActions();
    addUserMessage([{ type: 'text', text: 'Enrich Context' }]);
    setEnrichContextSource('builder');
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
      },
    }, null);
    return;
  }

  if (action === 'resolve_assumptions') {
    addUserMessage([{ type: 'text', text: 'Resolve open points' }]);

    // If we already have questions cached — show immediately (e.g. after re-render)
    if (_lastOpenQuestions.length > 0) {
      showResolveWidget(_lastOpenQuestions);
      return;
    }

    // Collect assumptions from modules + features (frontend-built, not from LLM global_assumptions)
    const existing = state.existing_structure || {};
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
      const payload = {
        to_agent:           'agent_interviewer',
        mode:               'solve_open_points',
        global_assumptions: globalAssumptions,
        project_summary:    state.project_summary,
        project_context:    state.project_context,
        existing_structure: state.existing_structure,
        open_points:        state._openPoints || [],
        resolved_points:    state._resolvedPoints || [],
        project_language:   state.project_language || null,
      };

      const response = await callAgent('agent_interviewer', payload);

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

    const payload = {
      to_agent:           'agent_builder',
      generation_type:    genType,
      mode:               'resolve',
      resolve_questions:  resolveAnswers,
      enrich_answers:     enrichAnswers.length > 0 ? enrichAnswers : [],
      inputs:             state.inputs,
      project_summary:    state.project_summary,
      project_context:    state.project_context,
      existing_structure: state.existing_structure,
      resolved_points:    state._resolvedPoints || [],
      open_points:        state._openPoints || [],
      project_language:   state.project_language || null,
    };

    const response = await callAgent('agent_builder', payload);
    await handleAgentResponse('agent_builder', response);
  } catch (err) {
    if (err.name !== 'AbortError') addErrorMessage(err.message);
  }
}
// Expose for cross-file access
window.handleAgentResponse = handleAgentResponse;
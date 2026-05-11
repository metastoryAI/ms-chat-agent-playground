// ─── FILE HANDLING ───────────────────────────────────────────────────────────

const MAX_FILES = 5;

// Long pastes auto-convert to attachments. Thresholds by detected kind.
const PASTE_THRESHOLDS = { plain: 800, code: 400, json: 400, markdown: 400 };

function detectTextKind(text) {
  const trimmed = text.trim();
  if (/^[{\[]/.test(trimmed)) {
    try { JSON.parse(trimmed); return 'json'; } catch (_) { /* not valid JSON, fall through */ }
  }
  if (/```|\bfunction\s*\(|\bconst\s+\w+\s*=|\blet\s+\w+\s*=|\bimport\s+\w+|\bdef\s+\w+|\bclass\s+\w+/.test(text)) return 'code';
  if (/(^|\n)\s{0,3}(#{1,6}\s|[-*]\s+\S|\d+\.\s+\S|>\s|\|.+\|)/.test(text)) return 'markdown';
  return 'plain';
}

function makePastedAttachment(text, kind) {
  const existing = pendingFiles.filter(f => f._pasted && f._kind === kind).length;
  const extByKind  = { plain: 'txt',           code: 'md',            json: 'json',          markdown: 'md' };
  const nameByKind = { plain: 'Pasted Text',   code: 'Pasted Code',   json: 'Pasted JSON',   markdown: 'Pasted Markdown' };
  const name = `${nameByKind[kind] || 'Pasted'} ${existing + 1}.${extByKind[kind] || 'txt'}`;
  const file = new File([text], name, { type: 'text/plain' });
  pendingFiles.push({ file, text, ready: Promise.resolve(), error: null, _pasted: true, _kind: kind });
  renderFilePreview();
}

function onUserInputPaste(e) {
  const clip = (e.clipboardData || window.clipboardData);
  if (!clip) return;
  const text = clip.getData('text') || '';
  if (!text) return;
  const kind = detectTextKind(text);
  const threshold = PASTE_THRESHOLDS[kind] || PASTE_THRESHOLDS.plain;
  if (text.length < threshold) return;
  if (pendingFiles.length >= MAX_FILES) return; // respect upload limit, fall through to regular paste
  e.preventDefault();
  makePastedAttachment(text, kind);
}

function extractFileText(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (ext === 'pdf') {
          const base64 = reader.result.split(',')[1];
          const arrayBuf = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
          const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
          const pageTexts = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            const text = tc.items.map(it => it.str).join(' ');
            pageTexts.push(`<PARSED TEXT FOR PAGE: ${i} / ${pdf.numPages}>\n${text}`);
          }
          const text = pageTexts.join('\n\n');
          console.log('[File] PDF extracted:', file.name, text.length, 'chars,', pdf.numPages, 'pages');
          resolve({ text, error: null });
        } else if (ext === 'docx') {
          if (typeof mammoth === 'undefined') throw new Error('mammoth.js not loaded');
          const result = await mammoth.extractRawText({ arrayBuffer: reader.result });
          if (!result.value || result.value.trim().length === 0) throw new Error('DOCX text is empty');
          console.log('[File] DOCX extracted:', file.name, result.value.length, 'chars');
          resolve({ text: result.value, error: null });
        } else {
          resolve({ text: null, error: `Unsupported file type: .${ext}` });
        }
      } catch (err) {
        console.error('[File] Text extraction failed:', file.name, err);
        resolve({ text: `[Text extraction failed for ${file.name}: ${err.message}]`, error: err.message });
      }
    };
    if (ext === 'pdf') reader.readAsDataURL(file);
    else reader.readAsArrayBuffer(file);
  });
}

function onFileSelect(e) {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  const slotsLeft = MAX_FILES - pendingFiles.length;
  if (slotsLeft <= 0) {
    alert(`Max ${MAX_FILES} files per message.`);
    e.target.value = '';
    return;
  }
  const toAdd = files.slice(0, slotsLeft);
  if (files.length > slotsLeft) {
    alert(`Only added ${slotsLeft} of ${files.length} files (max ${MAX_FILES} per message).`);
  }

  for (const file of toAdd) {
    const entry = { file, text: null, ready: null, error: null };
    entry.ready = extractFileText(file).then(({ text, error }) => {
      entry.text  = text;
      entry.error = error;
      renderFilePreview();
    });
    pendingFiles.push(entry);
  }

  renderFilePreview();
  e.target.value = ''; // allow re-selecting the same file
}

function removeFile(index) {
  if (index == null) { pendingFiles = []; }
  else { pendingFiles.splice(index, 1); }
  renderFilePreview();
  document.getElementById('file-input').value = '';
}

function renderFilePreview() {
  const el = document.getElementById('file-preview');
  if (!el) return;
  const hasFiles = pendingFiles.length > 0;
  document.body.classList.toggle('has-pending-files', hasFiles);
  if (!hasFiles) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  el.innerHTML = pendingFiles.map((entry, i) => {
    const loading = entry.text === null && !entry.error;
    const errored = !!entry.error;
    const cls = ['file-chip', loading && 'is-loading', errored && 'is-error'].filter(Boolean).join(' ');
    const icon = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 1h6l3 3v9H3V1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    const name = entry.file.name.replace(/</g, '&lt;');
    return `<div class="${cls}">${icon}<span class="file-chip-name" title="${name}">${name}</span><button onclick="removeFile(${i})" title="Remove">×</button></div>`;
  }).join('');
}

// ─── SEND ────────────────────────────────────────────────────────────────────

function onKeyDown(e) {
  const bar = document.getElementById('next-actions-bar');
  const isBarVisible = bar && bar.style.display !== 'none' && bar.innerHTML !== '';
  const visibleBtns = isBarVisible ? [...bar.querySelectorAll('.na-btn:not(.na-hidden):not([disabled])')] : [];
  const activeIdx = visibleBtns.findIndex(b => b.classList.contains('na-active'));

  // Arrow Down — enter or navigate next-actions
  if (e.key === 'ArrowDown' && isBarVisible && visibleBtns.length > 0) {
    e.preventDefault();
    const next = activeIdx < visibleBtns.length - 1 ? activeIdx + 1 : 0;
    visibleBtns.forEach(b => b.classList.remove('na-active'));
    visibleBtns[next].classList.add('na-active');
    return;
  }

  // Arrow Up — navigate up or back to textarea
  if (e.key === 'ArrowUp' && isBarVisible && activeIdx >= 0) {
    e.preventDefault();
    visibleBtns.forEach(b => b.classList.remove('na-active'));
    if (activeIdx > 0) visibleBtns[activeIdx - 1].classList.add('na-active');
    return;
  }

  // Enter — if a button is active, click it; if typing `/...` select first visible; otherwise send
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const input = document.getElementById('user-input');
    // If a file is attached, Enter always sends (even in builder mode — attaching a
    // document implicitly means "upload this to the project", not "run a slash cmd").
    if (pendingFiles.length > 0) {
      sendMessage();
      return;
    }
    if (activeIdx >= 0) {
      visibleBtns[activeIdx].click();
      if (input) input.value = '';
    } else if ((input?.value.startsWith('/') || state._mode === 'builder') && visibleBtns.length > 0) {
      visibleBtns[0].click();
      if (input) input.value = '';
    } else {
      sendMessage();
    }
    return;
  }

  // Escape — hide next-actions
  if (e.key === 'Escape' && isBarVisible) {
    e.preventDefault();
    bar.style.display = 'none';
    _naHidden = true;
    // In Builder mode, collapse the visible "/" prefix too — user needs to
    // type `/` again to re-enter filter mode.
    if (state._mode === 'builder') {
      document.body.classList.add('mode-builder-collapsed');
      const input = document.getElementById('user-input');
      if (input) { input.value = ''; input.style.height = 'auto'; }
    }
    updateNaPlaceholder();
    return;
  }
}

// Track whether user manually hid NA with Escape
let _naHidden = false;

function onInputChange(el) {
  autoResize(el);

  const val = el.value;
  const bar = document.getElementById('next-actions-bar');
  if (!bar) return;

  // Safety: in builder mode with an active structure, ensure the NA bar is
  // populated so `/` can always filter commands. regenerate/resolve flows can
  // leave the bar empty until the next response lands.
  if (bar.innerHTML === '' && state._mode === 'builder' && state.existing_structure) {
    if (typeof showBuilderCardNA === 'function') showBuilderCardNA();
    if (val) bar.style.display = 'none';
  }

  const hasNA = bar.innerHTML !== '';
  if (!hasNA) return;

  // In Builder mode the slash `/` is implicit and rendered as a visual prefix —
  // any typed text is treated as a command filter. In Chat mode, the user must
  // type `/` explicitly to enter slash-mode.
  const isBuilder = state._mode === 'builder';

  // If Builder filter is collapsed (after ESC), only `/` re-opens it — and we
  // strip the leading `/` since it's implicit in Builder mode.
  if (isBuilder && document.body.classList.contains('mode-builder-collapsed')) {
    if (val.startsWith('/')) {
      document.body.classList.remove('mode-builder-collapsed');
      el.value = val.slice(1);
      updateNaPlaceholder();
      return onInputChange(el); // re-run with stripped value
    }
    // Any other key typed while collapsed is ignored as a filter → keep bar hidden.
    return;
  }

  const lastSlashIdx = val.lastIndexOf('/');
  const inSlashMode = isBuilder
      ? true
      : (lastSlashIdx !== -1 && !/\s/.test(val.slice(lastSlashIdx)));

  if (inSlashMode) {
    // Explicit user intent to open NA → override ESC-hide state
    _naHidden = false;
    bar.style.display = 'flex';
    const filter = isBuilder
        ? val.toLowerCase()
        : val.slice(lastSlashIdx + 1).toLowerCase();
    let anyVisible = false;
    bar.querySelectorAll('.na-btn').forEach(b => {
      const cmd = (b.querySelector('.na-btn-cmd')?.textContent || '').toLowerCase();
      const match = cmd.includes(filter);
      b.classList.toggle('na-hidden', !match);
      b.classList.remove('na-active');
      if (match) anyVisible = true;
    });
    // Hide group hints if all their buttons are hidden
    bar.querySelectorAll('.na-hint[data-group]').forEach(h => {
      const gid = h.dataset.group;
      const groupBtns = bar.querySelectorAll(`.na-btn[data-group="${gid}"]`);
      const anyGroupVisible = [...groupBtns].some(b => !b.classList.contains('na-hidden'));
      h.classList.toggle('na-hidden', !anyGroupVisible);
    });
    // Hide separators whose adjacent groups are empty (leading / trailing /
    // between two fully-filtered groups).
    const children = [...bar.children];
    children.forEach((el, i) => {
      if (!el.classList.contains('na-separator')) return;
      const hasVisible = (start, step) => {
        for (let j = start; j >= 0 && j < children.length; j += step) {
          const c = children[j];
          if (c.classList.contains('na-separator')) return false;
          if (c.classList.contains('na-btn') && !c.classList.contains('na-hidden')) return true;
        }
        return false;
      };
      const before = hasVisible(i - 1, -1);
      const after  = hasVisible(i + 1,  1);
      el.classList.toggle('na-hidden', !(before && after));
    });
    if (!anyVisible) bar.style.display = 'none';
    updateNaPlaceholder();
    return;
  }

  // Not in slash mode — reset any filter styling
  bar.querySelectorAll('.na-btn').forEach(b => { b.classList.remove('na-hidden'); b.classList.remove('na-active'); });
  bar.querySelectorAll('.na-hint').forEach(h => h.classList.remove('na-hidden'));

  // While the user is typing a regular message, hide the NA bar to keep the chat clean.
  // The bar reappears automatically when the input is emptied — unless the user explicitly
  // dismissed it earlier with ESC (`_naHidden`).
  if (val) {
    bar.style.display = 'none';
  } else if (!_naHidden) {
    bar.style.display = 'flex';
  }

  updateNaPlaceholder();
}

function updateNaPlaceholder() {
  const input = document.getElementById('user-input');
  if (!input) return;
  if (state._mode === 'builder') {
    input.placeholder = document.body.classList.contains('mode-builder-collapsed')
        ? 'Type / for options'
        : 'Filter';
    return;
  }
  // In chat mode, `/` is always available — either the bar is already populated,
  // or it will be populated on demand (in answer mode via `populateHiddenNextActions`).
  input.placeholder = 'Type a message or / for commands...';
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

let _lastUserText = '';
let pendingFileTexts = [];

function stopMessage() {
  activeAbortController?.abort();
  // If the main response already returned and we're now waiting on per-doc
  // extract_details calls, also bail out of the post-extraction lock so the
  // user can keep typing instead of being stuck behind the spinner.
  if ((state._openPointsLoadingCount || 0) > 0) {
    state._openPointsLoadingCount = 0;
    state._openPointsLoadingStart = null;
    if (state._docLoadingNames) state._docLoadingNames.clear();
    if (typeof finalizePostExtraction === 'function') finalizePostExtraction();
    if (typeof refreshContextCardInLastMessage === 'function') refreshContextCardInLastMessage();
  }
}

async function sendMessage(opts = {}) {
  if (isLoading) return;
  const key = getActiveKey();
  if (!key) { alert(`Please enter your ${PROVIDER_LABELS[provider]} API key`); return; }

  let text = document.getElementById('user-input').value.trim();
  const hasFiles = pendingFiles.length > 0;
  if (!text && !hasFiles) return;

  // In Builder mode free-text submission is disabled — only slash commands
  // can be selected from the next-actions bar. Silently clear the input.
  if (state._mode === 'builder') {
    const input = document.getElementById('user-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    return;
  }

  if (text) _lastUserText = text;
  removeAllNextActions();
  disablePreviousStructureCards();

  // Wait for all files to be fully loaded (text extraction)
  if (hasFiles) {
    await Promise.all(pendingFiles.map(f => f.ready).filter(Boolean));
  }

  // Startup language QA — kept for future use but DISABLED in the playground.
  // Reason: every new agent prompt already instructs the LLM to respond in the
  // language of `user_input` / the uploaded document, so frontend detection
  // is redundant and only adds friction.
  if (LANGUAGE_DETECTION_ENABLED && !state._languageConfirmed) {
    const fileText = pendingFiles.find(f => f.text)?.text || '';
    const sample = (text + '\n' + fileText).trim();
    const detected = detectLanguageFromText(sample);
    if (detected && detected !== 'en') {
      state._pendingSendArgs = opts;
      showLanguagePickerQA(detected);
      return;
    }
    if (detected === 'en' || (sample.length >= 50 && !detected)) {
      state.project_language = 'en';
      state._languageConfirmed = true;
    }
  }

  const emptyEl = document.getElementById('empty-state');
  if (emptyEl) emptyEl.style.display = 'none';

  const userContent = [];
  for (const entry of pendingFiles) userContent.push({ type: 'file', name: entry.file.name });
  if (text) userContent.push({ type: 'text', text });
  addUserMessage(userContent);

  document.getElementById('user-input').value = '';
  document.getElementById('user-input').style.height = 'auto';

  // ── Shortcut: file uploaded with no accompanying text ────────────────────
  // The router would only ever classify this as analyze_document, so skip it
  // and dispatch analyze directly. Saves one LLM round-trip per file-only turn.
  //
  // Skip when the file is being retained from a prior intent_unclear turn
  // (`_retained`) — in that case the user explicitly chose the Ask/Answer lane
  // and must type their question first. An empty send would otherwise silently
  // re-upload the file to analyze.
  const allRetained = hasFiles && pendingFiles.every(f => f._retained);
  if (hasFiles && !text && !allRetained) {
    await dispatchAnalyzeFromPicker({ skipBubble: true });
    return;
  }
  // Retained file + no text → user picked Ask earlier but hasn't typed yet.
  // Bail out completely — no router call, no LLM hit. Focus the input and
  // let them type their question; the file stays attached for that next send.
  if (allRetained && !text) {
    document.getElementById('user-input').focus();
    return;
  }

  // Two-step flow: intent-router classifies the message → target agent executes.
  // Builder generate/refine is reached via the router, not free-text. Payload
  // is built per-agent below — only what each agent's prompt actually needs.

  activeAbortController = new AbortController();
  isLoading = true;
  document.getElementById('send-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'flex';
  const loadingEl = addLoading();

  const fileLabel = hasFiles ? pendingFiles.map(f => f.file.name).join(', ') : null;

  // Save file texts for open points extraction (runs after main response)
  pendingFileTexts = pendingFiles.filter(f => f.text).map(f => ({ name: f.file.name, text: f.text }));

  // When CLARIFY asks the user to disambiguate (intent_unclear), the file
  // must stay attached so the INTENT_PICKER buttons or the user's follow-up
  // message can re-use it. Flag is set inside the try block once the response
  // is known, and consulted just before removeFile() at the end.
  let keepFileForPicker = false;

  try {
    // Step 1 — Intent routing. Router sees a slim payload with state flags.
    const routerPayload = payloadForRouter(text);
    showDebugInput(routerPayload, fileLabel, 'intent_router');
    const routed = await callLLM(key, routerPayload, 'intent_router');
    showDebugOutput(routed, 'intent_router');

    // Step 2 — Dispatch the routed intent. Single intent only — multi-intent was
    // dropped from the new INTENT_ROUTER_AGENT contract. Unknown / malformed
    // router output → analyze with null variant (fallback-detection rule fires).
    const intent = routed && typeof routed === 'object' && routed.intent
        ? routed
        : { intent: 'analyze', variant_key: null, reason: 'router fallback' };

    const plan = planDispatch(intent);
    const dispatchPayload = payloadForAgent(plan.agentKey, text, plan);
    if (plan.mode) dispatchPayload.mode = plan.mode;

    showDebugInput(dispatchPayload, fileLabel, plan.agentKey);
    const response = await callLLM(key, dispatchPayload, plan.agentKey);
    // Orchestrator stamps `action` so response-handler dispatch (still keyed on
    // r.action) lights up. Analyze emits per-variant actions; everything else
    // uses the agent name.
    if (response && typeof response === 'object') {
      response.action = plan.agentKey === 'analyze'
          ? (plan.mode || 'analyze_input')
          : plan.agentKey;
    }
    // If we got intent_unclear back AND a file was attached this turn, keep
    // pendingFiles populated past the cleanup below so the user's next pick
    // (Analyze / Ask / free-text) automatically re-includes it. Tag each file
    // as retained so the no-text bypass above doesn't fire on a stray empty
    // send — the user must actually type a question.
    if (hasFiles && intent.intent === 'clarify' && intent.variant_key === 'intent_unclear') {
      keepFileForPicker = true;
      pendingFiles.forEach(f => { f._retained = true; });
    }
    showDebugOutput(response, plan.agentKey);
    await handleResponse(response, text);

    removeLoading(loadingEl);
  } catch(err) {
    removeLoading(loadingEl);
    if (err.name !== 'AbortError') {
      addErrorMessage(err.message);
      showDebugOutput({ error: err.message });
    }
  }

  activeAbortController = null;
  // If extract_details is still running, keep the input in loading state —
  // finalizePostExtraction() in response-handler.js will unlock it once all
  // per-doc extractions complete.
  if ((state._openPointsLoadingCount || 0) === 0) {
    isLoading = false;
    document.getElementById('send-btn').style.display = 'flex';
    document.getElementById('stop-btn').style.display = 'none';
  }
  if (!keepFileForPicker) removeFile();
}

// Direct dispatch to ANALYZE (router bypass). Used by:
//   1. sendMessage when the user uploads a file with no text — no need to ask
//      the router what to do, the answer is always analyze_document.
//   2. The INTENT_PICKER "Analyze" button after CLARIFY emitted intent_unclear.
// `skipBubble` is true when the caller already added the user bubble (case 1).
async function dispatchAnalyzeFromPicker({ skipBubble = false, bubbleLabel = 'Analyze' } = {}) {
  const key = getActiveKey();
  if (!key) return;

  const hasDoc = pendingFiles.length > 0;
  const variant = hasDoc ? 'analyze_document' : 'analyze_input';

  if (hasDoc) {
    await Promise.all(pendingFiles.map(f => f.ready).filter(Boolean));
    pendingFileTexts = pendingFiles.filter(f => f.text).map(f => ({ name: f.file.name, text: f.text }));
  }

  if (!skipBubble) {
    // Mirror the visual bubble the user would see if they retyped the message —
    // file chips + the "Analyze" label.
    const userContent = [];
    for (const entry of pendingFiles) userContent.push({ type: 'file', name: entry.file.name });
    userContent.push({ type: 'text', text: bubbleLabel });
    addUserMessage(userContent);
  }

  const payload = payloadForAnalyze('', variant);
  payload.mode = variant;

  activeAbortController = new AbortController();
  isLoading = true;
  document.getElementById('send-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'flex';
  const loadingEl = addLoading();
  const fileLabel = hasDoc ? pendingFiles.map(f => f.file.name).join(', ') : null;

  try {
    showDebugInput(payload, fileLabel, 'analyze');
    const response = await callLLM(key, payload, 'analyze');
    if (response && typeof response === 'object') response.action = variant;
    showDebugOutput(response, 'analyze');
    await handleResponse(response, '');
  } catch (err) {
    if (err.name !== 'AbortError') {
      addErrorMessage(err.message);
      showDebugOutput({ error: err.message });
    }
  } finally {
    removeLoading(loadingEl);
    activeAbortController = null;
    if ((state._openPointsLoadingCount || 0) === 0) {
      isLoading = false;
      document.getElementById('send-btn').style.display = 'flex';
      document.getElementById('stop-btn').style.display = 'none';
    }
    removeFile();
  }
}

// Bypass the intent-router for the Proceed button on a conflict warning.
// The router is stateless and cannot see `state._pendingConflict`, so we call
// analyze directly with an explicit `conflict_resolution` flag + the
// matching action_hint. This tells conflict-detection.md to skip re-detection
// and emit the hinted analyze action normally (default Template A opening).
// Discard is handled client-side in ui.js — it never calls this function.
async function resolveConflict(resolution /* 'proceed' */) {
  const key = getActiveKey();
  if (!key) return;

  const hasDoc = pendingFiles.length > 0 || (state.inputs || []).some(i => i.source === 'document');
  const actionHint = hasDoc ? 'analyze_document' : 'analyze_input';

  if (pendingFiles.length > 0) {
    await Promise.all(pendingFiles.map(f => f.ready).filter(Boolean));
  }
  pendingFileTexts = pendingFiles.filter(f => f.text).map(f => ({ name: f.file.name, text: f.text }));

  const payload = payloadForAnalyze('', actionHint, {
    conflict_resolution: resolution,
    action_hint:         actionHint,
    mode:                actionHint,
  });

  activeAbortController = new AbortController();
  isLoading = true;
  document.getElementById('send-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'flex';
  const loadingEl = addLoading();
  const fileLabel = hasDoc && pendingFiles.length > 0 ? pendingFiles.map(f => f.file.name).join(', ') : null;

  try {
    showDebugInput(payload, fileLabel, 'analyze');
    const response = await callLLM(key, payload, 'analyze');
    if (response && typeof response === 'object') {
      response.action = actionHint;
    }
    showDebugOutput(response, 'analyze');
    await handleResponse(response, '');
  } catch(err) {
    if (err.name !== 'AbortError') {
      addErrorMessage(err.message);
      showDebugOutput({ error: err.message });
    }
  } finally {
    removeLoading(loadingEl);
    activeAbortController = null;
    if ((state._openPointsLoadingCount || 0) === 0) {
      isLoading = false;
      document.getElementById('send-btn').style.display = 'flex';
      document.getElementById('stop-btn').style.display = 'none';
    }
    removeFile();
  }
}

// Map a router output `{ intent, variant_key, reason }` to a dispatch plan
// `{ agentKey, mode, payloadPatch }`. The `mode` becomes the composition trigger
// in getPromptForAgent — for analyze/builder/interview it picks the action/mode
// file; for standalone agents it stays null.
//
// Builder generation_type is encoded directly in the variant_key (e.g.
// "generate_modules"), so no separate hint is needed.
function planDispatch(routed) {
  const intent  = routed?.intent;
  const variant = routed?.variant_key || null;

  switch (intent) {
    case 'answer':
      return { agentKey: 'answer', mode: null, payloadPatch: {} };

    case 'clarify':
      return {
        agentKey: 'clarify',
        mode: variant || 'standard',
        payloadPatch: { clarify_variant: variant || 'standard' },
      };

    case 'query':
      return { agentKey: 'query', mode: null, payloadPatch: {} };

    case 'mutation':
      return { agentKey: 'mutation', mode: null, payloadPatch: {} };

    case 'analyze':
      return {
        agentKey: 'analyze',
        mode: variant,
        payloadPatch: { variant_key: variant },
      };

    case 'builder': {
      // variant maps directly to a builder mode. For generate_modules /
      // generate_modules_features / generate_pages, derive a generation_type for
      // downstream consumers that still look at it.
      const genType = variant === 'generate_pages'             ? 'pages'
                    : variant === 'generate_modules'           ? 'modules'
                    : variant === 'generate_modules_features'  ? 'modules_features'
                    : null;
      return {
        agentKey: 'builder',
        mode: variant,
        payloadPatch: { mode: variant, generation_type: genType },
      };
    }

    case 'interview':
      return {
        agentKey: 'interview',
        mode: variant,
        payloadPatch: { mode: variant },
      };

    default:
      // Unknown intent → analyze with null variant (fallback-detection picks).
      return { agentKey: 'analyze', mode: null, payloadPatch: {} };
  }
}

// ─── LLM PAYLOAD BUILDERS ────────────────────────────────────────────────────
// Every agent receives only what its prompt INPUT spec actually declares.
// Top-level legacy lists (captured_topics / open_points / project_notes) are
// gone — they live nested inside each `inputs[]` entry per the current prompts.
//
// Universal minimum across all agents:
//   • `user_input`            — the user's message
//   • `_file_attached: true`  — only when a file is pending in this turn
// Everything else is conditional on the agent and present-state.

// Strip large `text` field from document inputs before sending to LLMs —
// raw text belongs to the extract_details flow only. Also fold the flat
// state lists (captured_topics / decisions / open_points / project_notes /
// entities) back into the input they belong to via the `source` tag, so the
// agent sees the nested schema the prompts declare.
function inputsForLLM() {
  const inputs = state.inputs || [];

  // Build a per-input bucket map for each derived list. Items carry a `source`
  // field that points to the parent input's id (or document name); collect by
  // both keys so old name-tagged items still match.
  const buckets = new Map(); // key (lowercased id|name) → { captured_topics, decisions, open_points, project_notes, entities }
  const _ensure = (k) => {
    if (!buckets.has(k)) buckets.set(k, { captured_topics: [], decisions: [], open_points: [], project_notes: [], entities: [] });
    return buckets.get(k);
  };
  const _strip = (item) => {
    if (!item || typeof item !== 'object') return item;
    const { source: _s, status: _st, ...rest } = item;
    return rest;
  };
  const _spread = (list, field) => {
    for (const item of (list || [])) {
      const raw = typeof item === 'object' ? String(item.source || '') : '';
      const keys = raw ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      if (keys.length === 0) keys.push('__unsourced__');
      const clean = _strip(item);
      for (const k of keys) _ensure(k)[field].push(clean);
    }
  };
  _spread(state._capturedTopics, 'captured_topics');
  _spread(state._decisions,      'decisions');
  _spread(state._openPoints,     'open_points');
  _spread(state._projectNotes,   'project_notes');
  _spread(state._entities,       'entities');

  const _seen = (arr) => {
    const seen = new Set();
    return (arr || []).filter(it => {
      const sig = JSON.stringify(it);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  };

  return inputs.map(i => {
    // Strip the document body — agents work from `summary`. Extract flow uses
    // the raw text separately via extractDetailsForDoc.
    const { text: _t, ...rest } = i;
    const idKey   = String(i.id   || '').toLowerCase();
    const nameKey = String(i.name || '').toLowerCase();
    const a = buckets.get(idKey)   || { captured_topics: [], decisions: [], open_points: [], project_notes: [], entities: [] };
    const b = buckets.get(nameKey) || { captured_topics: [], decisions: [], open_points: [], project_notes: [], entities: [] };
    return {
      ...rest,
      captured_topics: _seen([...(rest.captured_topics || []), ...a.captured_topics, ...b.captured_topics]),
      decisions:       _seen([...(rest.decisions       || []), ...a.decisions,       ...b.decisions]),
      open_points:     _seen([...(rest.open_points     || []), ...a.open_points,     ...b.open_points]),
      project_notes:   _seen([...(rest.project_notes   || []), ...a.project_notes,   ...b.project_notes]),
      entities:        _seen([...(rest.entities        || []), ...a.entities,        ...b.entities]),
    };
  });
}

// Strip null / undefined / empty-string / empty-array values from a payload
// object so the LLM only sees keys with real content.
function _omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && v === '') continue;
    out[k] = v;
  }
  return out;
}

// Universal envelope — always carries user_input. `_file_attached` only when
// a file is pending. Per-agent builders extend this with what they need.
function _baseInput(text) {
  const env = { user_input: text || '' };
  if ((typeof pendingFiles !== 'undefined') && pendingFiles.length > 0) {
    env._file_attached = true;
  }
  return env;
}

function payloadForRouter(text) {
  return _omitEmpty({
    ..._baseInput(text),
    project_summary:    state.project_summary,
    existing_structure: state.existing_structure,
    inputs:             (state.inputs || []).length > 0 ? inputsForLLM() : null,
  });
}

function payloadForAnswer(text) {
  return _omitEmpty({
    ..._baseInput(text),
    inputs:             (state.inputs || []).length > 0 ? inputsForLLM() : null,
    project_summary:    state.project_summary,
    project_context:    state.project_context,
    existing_structure: state.existing_structure,
  });
}

function payloadForClarify(text, variantKey) {
  return _omitEmpty({
    ..._baseInput(text),
    clarify_variant:    variantKey || null,
    existing_structure: state.existing_structure,
  });
}

function payloadForQuery(text) {
  // QUERY only needs user_input + workspace/project ids (not wired in the
  // playground yet — omit when null).
  return _omitEmpty(_baseInput(text));
}

function payloadForMutation(text) {
  return _omitEmpty({
    ..._baseInput(text),
    existing_structure: state.existing_structure,
  });
}

function payloadForAnalyze(text, variantKey, extras = {}) {
  return _omitEmpty({
    ..._baseInput(text),
    variant_key:        variantKey || null,
    inputs:             (state.inputs || []).length > 0 ? inputsForLLM() : null,
    project_summary:    state.project_summary,
    project_context:    state.project_context,
    existing_structure: state.existing_structure,
    project_language:   state.project_language,
    ...extras,
  });
}

// Builder — per BUILDER_AGENT_PROMPT.md INPUT spec.
// Pulled from state plus a handoff blob carrying mode-specific extras
// (generation_type, mode, resolve_questions, …).
function payloadForBuilder({ mode, generation_type, resolve_questions, user_input } = {}) {
  return _omitEmpty({
    user_input:         user_input || null,
    generation_type:    generation_type || state.existing_structure?.generation_type || 'modules',
    mode:               mode || null,
    inputs:             (state.inputs || []).length > 0 ? inputsForLLM() : null,
    project_summary:    state.project_summary,
    project_context:    state.project_context,
    existing_structure: state.existing_structure,
    resolve_questions:  (resolve_questions && resolve_questions.length > 0) ? resolve_questions : null,
    resolved_points:    state._resolvedPoints,
  });
}

// Interview — per INTERVIEW_AGENT_PROMPT.md INPUT spec.
function payloadForInterview({ mode, phase, depth, pending_questions, answers, global_open_points } = {}) {
  return _omitEmpty({
    mode:                mode || null,
    phase:               phase || null,
    depth:               depth || null,
    pending_questions:   (pending_questions && pending_questions.length > 0) ? pending_questions : null,
    answers:             (answers && answers.length > 0) ? answers : null,
    global_open_points:  (global_open_points && global_open_points.length > 0) ? global_open_points : null,
    inputs:              (state.inputs || []).length > 0 ? inputsForLLM() : null,
    project_summary:     state.project_summary,
    project_context:     state.project_context,
  });
}

// Dispatch by agent — used by chat.js after the router classifies the intent.
function payloadForAgent(agentKey, text, plan) {
  const variant = plan?.mode || plan?.payloadPatch?.variant_key || plan?.payloadPatch?.clarify_variant || null;
  switch (agentKey) {
    case 'answer':   return payloadForAnswer(text);
    case 'clarify':  return payloadForClarify(text, variant);
    case 'query':    return payloadForQuery(text);
    case 'mutation': return payloadForMutation(text);
    case 'analyze':  return payloadForAnalyze(text, variant, plan?.payloadPatch || {});
    default:         return payloadForAnalyze(text, variant);
  }
}
// ─── FILE HANDLING ───────────────────────────────────────────────────────────

const MAX_FILES = 5;

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
  if (pendingFiles.length === 0) {
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
  const visibleBtns = isBarVisible ? [...bar.querySelectorAll('.na-btn:not(.na-hidden)')] : [];
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
    if (activeIdx >= 0) {
      visibleBtns[activeIdx].click();
      if (input) input.value = '';
    } else if (input?.value.startsWith('/') && visibleBtns.length > 0) {
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

  const hasNA = bar.innerHTML !== '';
  if (!hasNA) return;

  // Detect trailing slash-command pattern: last `/` in the input with no whitespace after it.
  // Matches: "/", "/gen", "hello/", "hello/gen"  — does NOT match: "hello/gen foo", "hello"
  const lastSlashIdx = val.lastIndexOf('/');
  const inSlashMode = lastSlashIdx !== -1 && !/\s/.test(val.slice(lastSlashIdx));

  if (inSlashMode) {
    // Explicit user intent to open NA → override ESC-hide state
    _naHidden = false;
    bar.style.display = 'flex';
    const filter = val.slice(lastSlashIdx + 1).toLowerCase();
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
    input.placeholder = 'Add, rename, remove... or / for options';
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
}

async function sendMessage(opts = {}) {
  if (isLoading) return;
  const key = getActiveKey();
  if (!key) { alert(`Please enter your ${PROVIDER_LABELS[provider]} API key`); return; }

  let text = document.getElementById('user-input').value.trim();
  const hasFiles = pendingFiles.length > 0;
  if (!text && !hasFiles) return;

  if (text) _lastUserText = text;
  removeAllNextActions();
  disablePreviousStructureCards();

  // Wait for all files to be fully loaded (text extraction)
  if (hasFiles) {
    await Promise.all(pendingFiles.map(f => f.ready).filter(Boolean));
  }

  // Startup language QA — ask once when the first input isn't English.
  // After the user picks, `_languageConfirmed` locks the choice for the session.
  if (!state._languageConfirmed) {
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

  // Route based on mode
  const isBuilderMode = state._mode === 'builder' && !hasFiles;

  const payload = isBuilderMode
      ? buildStructurePayload(text)
      : buildPayload(text);

  activeAbortController = new AbortController();
  isLoading = true;
  document.getElementById('send-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'flex';
  const loadingEl = addLoading();

  const agentLabel = isBuilderMode ? 'agent_builder' : 'agent_chat';
  const fileLabel = hasFiles ? pendingFiles.map(f => f.file.name).join(', ') : null;
  showDebugInput(payload, fileLabel, agentLabel);

  // Save file texts for open points extraction (runs after main response)
  pendingFileTexts = pendingFiles.filter(f => f.text).map(f => ({ name: f.file.name, text: f.text }));

  try {
    let response;
    if (isBuilderMode) {
      response = await callLLM(key, payload, 'agent_builder');
      removeLoading(loadingEl);
      showDebugOutput(response, 'agent_builder');
      await handleAgentResponse('agent_builder', response);
    } else {
      response = await callLLM(key, payload);
      removeLoading(loadingEl);
      showDebugOutput(response, 'agent_chat');
      await handleResponse(response, text);
    }
  } catch(err) {
    removeLoading(loadingEl);
    if (err.name !== 'AbortError') {
      addErrorMessage(err.message);
      showDebugOutput({ error: err.message });
    }
  }

  activeAbortController = null;
  isLoading = false;
  document.getElementById('send-btn').style.display = 'flex';
  document.getElementById('stop-btn').style.display = 'none';
  removeFile();
}

// Strip large `text` field from document inputs before sending to LLMs —
// raw text belongs to the extract_open_points flow only, main agents use summaries.
function inputsForLLM() {
  return (state.inputs || []).map(i => {
    if (i.source !== 'document') return i;
    const { text: _t, ...rest } = i;
    return rest;
  });
}

function buildStructurePayload(text) {
  return {
    to_agent:           'agent_builder',
    generation_type:    state.existing_structure?.generation_type || 'modules',
    mode:               'refine',
    user_input:         text,
    inputs:             inputsForLLM(),
    project_summary:    state.project_summary,
    project_context:    state.project_context,
    existing_structure: state.existing_structure,
    open_points:        state._openPoints || [],
    project_notes:      state._projectNotes || [],
    resolved_points:    state._resolvedPoints || [],
    project_language:   state.project_language || null,
  };
}

function buildPayload(text) {
  return {
    inputs:             inputsForLLM(),
    project_summary:    state.project_summary,
    project_context:    state.project_context,
    existing_structure: state.existing_structure,
    captured_topics:    state._capturedTopics || null,
    open_points:        state._openPoints || [],
    project_notes:      state._projectNotes || [],
    user_input:         text || '',
    project_language:   state.project_language || null,
  };
}
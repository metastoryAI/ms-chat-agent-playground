// ─── FILE HANDLING ───────────────────────────────────────────────────────────

let fileReady = null; // resolves when file is fully loaded

function onFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;
  pendingFileText = null;

  const ext = file.name.split('.').pop().toLowerCase();

  fileReady = new Promise((resolve) => {
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
          pendingFileText = pageTexts.join('\n\n');
          console.log('[File] PDF extracted:', pendingFileText.length, 'chars,', pdf.numPages, 'pages');
        } else if (ext === 'docx') {
          if (typeof mammoth === 'undefined') throw new Error('mammoth.js not loaded');
          const result = await mammoth.extractRawText({ arrayBuffer: reader.result });
          if (!result.value || result.value.trim().length === 0) throw new Error('DOCX text is empty');
          pendingFileText = result.value;
          console.log('[File] DOCX extracted:', pendingFileText.length, 'chars');
        }
      } catch (err) {
        console.error('[File] Text extraction failed:', err);
        pendingFileText = `[Text extraction failed for ${file.name}: ${err.message}]`;
      }
      resolve();
    };
    if (ext === 'pdf') reader.readAsDataURL(file);
    else reader.readAsArrayBuffer(file);
  });

  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-preview').style.display = 'flex';
}

function removeFile() {
  pendingFile = null;
  pendingFileText = null;
  document.getElementById('file-preview').style.display = 'none';
  document.getElementById('file-input').value = '';
}

// ─── SEND ────────────────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

let _lastUserText = '';
let activeAbortController = null;

function stopMessage() {
  activeAbortController?.abort();
}

async function sendMessage() {
  if (isLoading) return;
  const key = getActiveKey();
  if (!key) { alert(`Please enter your ${providerLabels[provider]} API key`); return; }

  let text = document.getElementById('user-input').value.trim();
  if (!text && !pendingFile) return;

  if (text) _lastUserText = text;
  removeAllNextActions();

  // Wait for file to be fully loaded (text extraction)
  if (pendingFile && fileReady) {
    await fileReady;
  }

  document.getElementById('empty-state').style.display = 'none';

  const userContent = [];
  if (pendingFile) userContent.push({ type: 'file', name: pendingFile.name });
  if (text) userContent.push({ type: 'text', text });
  addUserMessage(userContent);

  document.getElementById('user-input').value = '';
  document.getElementById('user-input').style.height = 'auto';

  const payload = buildPayload(text);

  activeAbortController = new AbortController();
  isLoading = true;
  document.getElementById('send-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'flex';
  const loadingEl = addLoading();

  showDebugInput(payload, pendingFile ? pendingFile.name : null, 'chat_agent');

  try {
    const response = await callLLM(key, payload);
    removeLoading(loadingEl);
    showDebugOutput(response, 'chat_agent');

    await handleResponse(response, text);
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

function buildPayload(text) {
  return {
    documents:       state.documents,
    free_inputs:     state.free_inputs,
    manual_inputs:   state.manual_inputs,
    project_summary: state.project_summary,
    project_context: state.project_context,
    existing_structure: state.existing_structure,
    captured_topics: state._capturedTopics || null,
    user_input:      text || ''
  };
}
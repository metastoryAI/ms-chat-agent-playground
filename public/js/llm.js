// ─── LLM CALLS ───────────────────────────────────────────────────────────────

function parseJSON(raw) {
  let text = raw.trim();
  // Try direct parse first (covers clean JSON responses)
  try { return JSON.parse(text); } catch (_) {}
  // Extract from markdown code blocks
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) {
    try { return JSON.parse(codeMatch[1].trim()); } catch (_) {}
    text = codeMatch[1].trim();
  }
  // Fallback: extract first complete JSON object { ... } via brace depth
  // Handles braces inside strings correctly
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0, inString = false, escape = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Incomplete JSON object in response');
  return JSON.parse(text.substring(start, end + 1));
}

/**
 * Prepend extracted document text to the state JSON message.
 * Supports multiple files — each becomes its own [DOCUMENT: name] block.
 *
 * For `intent_router`: include only the [DOCUMENT: name] header, NOT the body.
 * The router only needs to know a file is attached to pick the right intent;
 * sending the full text wastes ~all of the doc's tokens on a routing decision
 * (and can mislead the router with content noise).
 */
function buildUserMessage(stateMsg, agentKey) {
  const withText = pendingFiles.filter(f => f.text);
  if (withText.length === 0) return stateMsg;

  if (agentKey === 'intent_router') {
    const headers = withText.map(f => `[DOCUMENT: ${f.file.name}]`);
    console.log('[LLM] injecting', withText.length, 'document header(s) for intent_router (body skipped)');
    return headers.join('\n') + '\n\n' + stateMsg;
  }

  const blocks = withText.map(f => `[DOCUMENT: ${f.file.name}]\n\n${f.text}`);
  const totalChars = withText.reduce((n, f) => n + f.text.length, 0);
  console.log('[LLM] injecting', withText.length, 'document(s),', totalChars, 'chars total for', agentKey || 'unknown');
  return blocks.join('\n\n') + '\n\n' + stateMsg;
}

// ─── Low-level provider calls (internal — use callAgent instead) ─────────────

async function _callProvider(key, userMsg, agentKey, signal) {
  const content = buildUserMessage(userMsg, agentKey);
  const model   = getModelForAgent(agentKey);
  // Extract mode from payload for sub-prompt selection
  let mode = null;
  try { mode = JSON.parse(userMsg).mode; } catch(e) {}
  const system  = getPromptForAgent(agentKey, mode);

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, max_tokens: 8192, system, messages: [{ role: 'user', content }] })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    trackTokens(data, agentKey);
    return parseJSON(data.content[0].text);
  }

  if (provider === 'openai') {
    const res = await fetch('/openai', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        payload: { model, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content }] }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    trackTokens(data, agentKey);
    return parseJSON(data.choices[0].message.content);
  }

  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: { response_mime_type: 'application/json' }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    trackTokens(data, agentKey);
    return parseJSON(data.candidates[0].content.parts[0].text);
  }

  if (provider === 'kimi') {
    const res = await fetch('/kimi', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        payload: { model, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content }] }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    trackTokens(data, agentKey);
    return parseJSON(data.choices[0].message.content);
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ─── Unified agent call — handles loading, abort, debug, errors ──────────────

/**
 * Call an LLM agent with full lifecycle management.
 *
 * @param {string} agentKey   - 'intent_router' | 'analyze' | 'answer' | 'clarify' | 'query' | 'mutation' | 'builder' | 'interview'
 * @param {object} payload    - The state/payload object to send
 * @param {object} [opts]     - Options
 * @param {boolean} [opts.showLoading=true]  - Show/remove loading spinner
 * @param {boolean} [opts.showDebug=true]    - Update debug panel
 * @param {boolean} [opts.setModelLabel=false] - Temporarily show this agent's model in toolbar
 * @param {string}  [opts.fileName=null]     - Attached file name for debug
 * @returns {Promise<object>} Parsed JSON response from LLM
 * @throws {Error} On LLM error or abort
 */
async function callAgent(agentKey, payload, opts = {}) {
  const { showLoading = true, showDebug = true, setModelLabel = false, fileName = null } = opts;
  const key = getActiveKey();
  if (!key) throw new Error(`Please enter your ${PROVIDER_LABELS[provider]} API key`);

  const abort = new AbortController();
  const prevController = activeAbortController;
  activeAbortController = abort;

  if (setModelLabel) setModelLabelForAgent(agentKey);
  if (showDebug) showDebugInput(payload, fileName, agentKey);

  const loadingEl = showLoading ? addLoading() : null;
  const wasLoading = isLoading;
  isLoading = true;
  document.getElementById('send-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'flex';

  try {
    const userMsg = JSON.stringify(payload, null, 2);
    const response = await _callProvider(key, userMsg, agentKey, abort.signal);
    if (showDebug) showDebugOutput(response, agentKey);
    return response;
  } finally {
    if (loadingEl) removeLoading(loadingEl);
    if (setModelLabel) updateModelLabel();
    if (!wasLoading) {
      isLoading = false;
      document.getElementById('send-btn').style.display = 'flex';
      document.getElementById('stop-btn').style.display = 'none';
    }
    if (activeAbortController === abort) {
      activeAbortController = prevController;
    }
  }
}

// Legacy compat — used for one-shot calls that bypass callAgent's lifecycle wrapper.
// Defaults to intent_router (the entry point for every user message).
async function callLLM(key, payload, agentKey = 'intent_router') {
  const userMsg = JSON.stringify(payload, null, 2);
  return _callProvider(key, userMsg, agentKey, activeAbortController?.signal);
}

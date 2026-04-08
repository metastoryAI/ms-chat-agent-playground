// ─── LLM CALLS ───────────────────────────────────────────────────────────────

function parseJSON(raw) {
  let text = raw.trim();
  // Extract from markdown code blocks
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) text = codeMatch[1].trim();
  // Extract first complete JSON object { ... }
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Incomplete JSON object in response');
  return JSON.parse(text.substring(start, end + 1));
}

/**
 * Prepend extracted PDF text (page-structured) to the state JSON message.
 * Returns the combined string to send as user message.
 */
function buildUserMessage(stateMsg) {
  if (!pendingFile || !pendingFileText) return stateMsg;
  const block = `[DOCUMENT: ${pendingFile.name}]\n\n${pendingFileText}`;
  console.log('[LLM] injecting PDF text:', pendingFileText.length, 'chars');
  return block + '\n\n' + stateMsg;
}

async function callLLM(key, payload, agentKey = 'chat_agent') {
  const userMsg = JSON.stringify(payload, null, 2);

  if (provider === 'anthropic') return callAnthropic(key, userMsg, agentKey);
  if (provider === 'openai') return callOpenAI(key, userMsg, agentKey);
  if (provider === 'gemini') return callGemini(key, userMsg, agentKey);
  if (provider === 'kimi') return callKimi(key, userMsg, agentKey);
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

async function callAnthropic(key, userMsg, agentKey = 'chat_agent') {
  const content = buildUserMessage(userMsg);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: activeAbortController?.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: getModelForAgent(agentKey),
      max_tokens: 8192,
      system: getPromptForAgent(agentKey),
      messages: [{ role: 'user', content }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  trackTokens(data, agentKey);
  return parseJSON(data.content[0].text);
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function callOpenAI(key, userMsg, agentKey = 'chat_agent') {
  const content = buildUserMessage(userMsg);

  const res = await fetch('/openai', {
    method: 'POST',
    signal: activeAbortController?.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      payload: {
        model: getModelForAgent(agentKey),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: getPromptForAgent(agentKey) },
          { role: 'user', content }
        ]
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  trackTokens(data, agentKey);
  return parseJSON(data.choices[0].message.content);
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function callGemini(key, userMsg, agentKey = 'chat_agent') {
  const content = buildUserMessage(userMsg);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${getModelForAgent(agentKey)}:generateContent?key=${key}`, {
    method: 'POST',
    signal: activeAbortController?.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: getPromptForAgent(agentKey) }] },
      contents: [{ role: 'user', parts: [{ text: content }] }],
      generationConfig: { response_mime_type: 'application/json' }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  trackTokens(data, agentKey);
  return parseJSON(data.candidates[0].content.parts[0].text);
}

// ─── Kimi (Moonshot AI) — OpenAI-compatible ──────────────────────────────────

async function callKimi(key, userMsg, agentKey = 'chat_agent') {
  const content = buildUserMessage(userMsg);

  const res = await fetch('/kimi', {
    method: 'POST',
    signal: activeAbortController?.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      payload: {
        model: getModelForAgent(agentKey),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: getPromptForAgent(agentKey) },
          { role: 'user', content }
        ]
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  trackTokens(data, agentKey);
  return parseJSON(data.choices[0].message.content);
}

const db = require('./db');

// ---------------------------------------------------------------------------
// Calls the right LLM provider with the given agent prompt + state.
// Returns a parsed JSON object from the model response.
// ---------------------------------------------------------------------------

async function callLLM({ provider, apiKey, agentPromptKey, stateJSON, fileBase64 }) {
  const promptRow = db.prepare('SELECT text FROM prompts WHERE key = ?').get(agentPromptKey);
  if (!promptRow) throw new Error(`Prompt not found: ${agentPromptKey}`);

  const systemPrompt = promptRow.text;
  const stateText    = JSON.stringify(stateJSON);

  if (provider === 'claude') return callClaude(apiKey, systemPrompt, stateText, fileBase64);
  if (provider === 'openai') return callOpenAI(apiKey, systemPrompt, stateText);
  if (provider === 'gemini') return callGemini(apiKey, systemPrompt, stateText, fileBase64);
  throw new Error(`Unknown provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// Anthropic — Claude
// ---------------------------------------------------------------------------

async function callClaude(apiKey, systemPrompt, stateText, fileBase64) {
  const userContent = [];
  if (fileBase64) {
    userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } });
  }
  userContent.push({ type: 'text', text: stateText });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 8192, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Claude error: ${data.error.message}`);
  return parseJSONResponse(data.content?.[0]?.text || '{}');
}

// ---------------------------------------------------------------------------
// OpenAI — GPT
// ---------------------------------------------------------------------------

async function callOpenAI(apiKey, systemPrompt, stateText) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: stateText }] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenAI error: ${data.error.message}`);
  return parseJSONResponse(data.choices?.[0]?.message?.content || '{}');
}

// ---------------------------------------------------------------------------
// Google — Gemini
// ---------------------------------------------------------------------------

async function callGemini(apiKey, systemPrompt, stateText, fileBase64) {
  const parts = [];
  if (fileBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: fileBase64 } });
  parts.push({ text: stateText });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Gemini error: ${data.error.message}`);
  return parseJSONResponse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
}

// ---------------------------------------------------------------------------

function parseJSONResponse(text) {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { error: 'Failed to parse LLM response as JSON', raw: text };
  }
}

module.exports = { callLLM };

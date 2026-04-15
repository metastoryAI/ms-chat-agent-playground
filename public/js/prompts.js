// ─── PROMPTS ─────────────────────────────────────────────────────────────────

// Ensure every agent×provider combo has a saved model in localStorage at startup.
// This guarantees getModelForAgent() never has to fall back to the global model.
(function initAgentModelDefaults() {
  const agents    = ['agent_chat', 'agent_builder', 'agent_interviewer'];
  const providers = ['anthropic', 'openai', 'gemini', 'kimi'];
  agents.forEach(agent => {
    providers.forEach(p => {
      const key    = `ms_agent_model_${agent}_${p}`;
      const models = PROVIDER_MODELS[p] || [];
      if (!localStorage.getItem(key) && models.length) {
        localStorage.setItem(key, models[0].id);
      }
    });
  });
})();

let currentPromptTab = 'agent_chat';
let prompts = {
  agent_chat:                     'Loading...',
  agent_builder:                  'Loading...',
  agent_interviewer:              'Loading...',
  // Builder modes
  generate_modules:               '',
  generate_modules_features:      '',
  generate_pages:                 '',
  refine:                         '',
  resolve:                        '',
  diff:                           '',
  // Interviewer modes
  solve_open_points:              '',
  enrich_context:                 '',
  // Chat rules
  chat_rules_input_detection:     '',
  chat_rules_confidence:          '',
  chat_rules_next_actions_tags:   '',
  chat_rules_command_routing:     '',
  // Chat templates
  chat_templates_responses:       '',
  // Chat actions
  chat_action_analyze_document:   '',
  chat_action_analyze_input:      '',
  chat_action_answer:             '',
  chat_action_route:              '',
  chat_action_add_input:          '',
  chat_action_modify_input:       '',
  chat_action_remove_input:       '',
  chat_action_clarify:            '',
  extract_open_points:            '',
};

const PROMPT_FILES = {
  agent_chat:                     '/prompts/agents/agent-chat.md',
  agent_builder:                  '/prompts/agents/agent-builder.md',
  agent_interviewer:              '/prompts/agents/agent-interviewer.md',
  // Builder modes
  generate_modules:               '/prompts/modes/builder/generate/modules.md',
  generate_modules_features:      '/prompts/modes/builder/generate/modules-features.md',
  generate_pages:                 '/prompts/modes/builder/generate/pages.md',
  refine:                         '/prompts/modes/builder/edit/refine.md',
  resolve:                        '/prompts/modes/builder/edit/resolve.md',
  diff:                           '/prompts/modes/builder/compare/diff.md',
  // Interviewer modes
  solve_open_points:              '/prompts/modes/interviewer/solve-open-points.md',
  enrich_context:                 '/prompts/modes/interviewer/enrich-context.md',
  // Chat rules
  chat_rules_input_detection:     '/prompts/modes/chat/rules/input-detection.md',
  chat_rules_confidence:          '/prompts/modes/chat/rules/confidence.md',
  chat_rules_next_actions_tags:   '/prompts/modes/chat/rules/next-actions-tags.md',
  chat_rules_command_routing:     '/prompts/modes/chat/rules/command-routing.md',
  // Chat templates
  chat_templates_responses:       '/prompts/modes/chat/templates/chat-responses.md',
  // Chat actions
  chat_action_analyze_document:   '/prompts/modes/chat/actions/analyze-document.md',
  chat_action_analyze_input:      '/prompts/modes/chat/actions/analyze-input.md',
  chat_action_answer:             '/prompts/modes/chat/actions/answer.md',
  chat_action_route:              '/prompts/modes/chat/actions/route.md',
  chat_action_add_input:          '/prompts/modes/chat/actions/add-input.md',
  chat_action_modify_input:       '/prompts/modes/chat/actions/modify-input.md',
  chat_action_remove_input:       '/prompts/modes/chat/actions/remove-input.md',
  chat_action_clarify:            '/prompts/modes/chat/actions/clarify.md',
  extract_open_points:            '/prompts/modes/chat/actions/extract-open-points.md',
};

// Dynamic chat mode files — only include what's needed for this call.
// Reduces prompt size by ~60% on first call.
function getChatModeFiles(hasDocuments) {
  const hasInputs = state.inputs.length > 0;

  // Always included — core routing and formatting
  const files = [
    'chat_rules_input_detection',
    'chat_rules_confidence',
    'chat_rules_next_actions_tags',
    'chat_rules_command_routing',
    'chat_templates_responses',
  ];

  // Document vs text input — mutually exclusive
  if (hasDocuments) {
    files.push('chat_action_analyze_document');
  } else {
    files.push('chat_action_analyze_input');
  }

  // Always needed for routing
  files.push('chat_action_route');

  // Only after first input exists
  if (hasInputs) {
    files.push('chat_action_answer');
    files.push('chat_action_clarify');
    files.push('chat_action_add_input');
    files.push('chat_action_modify_input');
    files.push('chat_action_remove_input');
  }

  return files;
}

async function loadPrompts() {
  for (const [key, url] of Object.entries(PROMPT_FILES)) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        prompts[key] = await res.text();
      }
    } catch (e) {
      console.warn(`Failed to load prompt ${key}:`, e);
    }
  }
  // Refresh TOC if modal is already open
  if (document.getElementById('prompts-modal').classList.contains('open')) {
    renderTOC(prompts[currentPromptTab]);
  }
}
loadPrompts();

function openPromptsModal() {
  document.getElementById('prompts-modal').classList.add('open');
  showPromptTab(currentPromptTab);
  renderAgentModelSidebar(currentPromptTab);
}

function closePromptsModal() {
  document.getElementById('prompts-modal').classList.remove('open');
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('prompts-modal')) closePromptsModal();
}

function showPromptTab(key) {
  currentPromptTab = key;
  const promptTabs = document.querySelectorAll('#prompts-modal .mtab');
  promptTabs.forEach(t => t.classList.remove('active'));
  const tabs = ['agent_chat', 'agent_builder', 'agent_interviewer'];
  const idx = tabs.indexOf(key);
  if (idx !== -1 && promptTabs[idx]) promptTabs[idx].classList.add('active');
  document.getElementById('prompt-editor').value = prompts[key] || '';
  document.getElementById('saved-badge').style.display = 'none';
  renderTOC(prompts[key] || '');
  renderAgentModelSidebar(key);
}

function renderTOC(text) {
  const view = document.getElementById('toc-contents-view');
  const headers = [];
  text.split('\n').forEach((line, lineIndex) => {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) headers.push({ level: m[1].length, text: m[2].trim(), lineIndex });
  });

  let html = '';
  if (headers.length === 0) {
    html += '<div class="toc-empty">No headers found</div>';
  } else {
    headers.forEach(h => {
      html += `<button class="toc-item toc-h${h.level}" onclick="scrollToHeader(${h.lineIndex})" title="${h.text}">${h.text}</button>`;
    });
  }
  view.innerHTML = html;
}

// ─── AGENT MODEL SIDEBAR ─────────────────────────────────────────────────────

// PROVIDER_LABELS defined in state.js

function renderAgentModelSidebar(agentKey) {
  const body = document.getElementById('pms-body');
  if (!body) return;
  const providers = ['anthropic', 'openai', 'gemini', 'kimi'];
  body.innerHTML = providers.map(p => {
    const models = PROVIDER_MODELS[p] || [];
    const storageKey = `ms_agent_model_${agentKey}_${p}`;
    let saved = localStorage.getItem(storageKey);
    // Auto-persist the default so getModelForAgent() always finds a value
    if (!saved || !models.find(m => m.id === saved)) {
      saved = models[0]?.id || '';
      if (saved) localStorage.setItem(storageKey, saved);
    }
    const isActive = p === provider;
    const opts = models.map(m =>
        `<option value="${m.id}"${m.id === saved ? ' selected' : ''}>${m.name}</option>`
    ).join('');
    return `<div class="pms-section">
      <div class="pms-provider-label">${PROVIDER_LABELS[p]}${isActive ? '<span class="pms-active-dot" title="Active provider"></span>' : ''}</div>
      <select class="pms-select" onchange="setAgentModel('${agentKey}','${p}',this.value)">${opts}</select>
    </div>`;
  }).join('');
}

function setAgentModel(agentKey, providerKey, modelId) {
  localStorage.setItem(`ms_agent_model_${agentKey}_${providerKey}`, modelId);
  // If this is agent_chat and the current provider matches → sync toolbar label
  if (agentKey === 'agent_chat' && providerKey === provider) {
    selectedModel = modelId;
    updateModelLabel();
    updateStatePanel();
  }
}

function scrollToHeader(lineIndex) {
  const editor = document.getElementById('prompt-editor');
  const lines = editor.value.split('\n');
  let charPos = 0;
  for (let i = 0; i < lineIndex; i++) charPos += lines[i].length + 1;
  // Measure scroll: create a hidden clone to get line height
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
  editor.scrollTop = lineIndex * lineHeight - 40;
  editor.focus();
  editor.setSelectionRange(charPos, charPos + (lines[lineIndex] || '').length);
}

async function savePrompt() {
  const text = document.getElementById('prompt-editor').value;
  prompts[currentPromptTab] = text;

  // Save to .md file on disk
  const filename = PROMPT_FILES[currentPromptTab].split('/').pop(); // e.g. "agent-chat.md"
  try {
    const res = await fetch(`/api/prompts/file/${filename}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
  } catch (err) {
    console.error('Failed to save prompt file:', err);
  }

  const badge = document.getElementById('saved-badge');
  badge.style.display = 'inline';
  setTimeout(() => { badge.style.display = 'none'; }, 2000);
}


// ─── AGENT PROMPTS ────────────────────────────────────────────────────────────

// Builder mode → ordered list of prompt dict keys to bundle into one call.
// Multi-key entries concatenate all files + append a merge footer so the LLM
// returns one merged JSON object instead of the per-file atomic shape.
const BUILDER_MODE_PROMPTS = {
  generate:          ['generate_pages', 'generate_modules'],          // bundled: pages + modules
  generate_features: ['generate_pages', 'generate_modules_features'], // bundled: pages + modules+features
  generate_pages:    ['generate_pages'],                              // atomic (tree-flow friendly)
  refine:            ['refine'],
  resolve:           ['resolve'],
  diff:              ['diff'],
};

// Interviewer mode → ordered list of prompt dict keys
const INTERVIEWER_MODE_PROMPTS = {
  solve_open_points: ['solve_open_points'],
  enrich_context:    ['enrich_context'],
};

// Which top-level output slot each mode file populates.
// Used to build the merge footer when multiple files are bundled.
const MODE_SLOT = {
  generate_pages:            'pages',
  generate_modules:          'sections',
  generate_modules_features: 'sections',
};

function buildMergeFooter(slotNames) {
  const slotLines = slotNames.map(s => `  "${s}": [ ... from the ${s.toUpperCase()} section above ]`).join(',\n');
  return `---

## FINAL OUTPUT (bundled call)

The sections above describe multiple output slots. Your response MUST be ONE JSON object merging all slots:

\`\`\`json
{
  "status": "completed",
${slotLines}
}
\`\`\`

Ignore any "Return only" instructions in the individual sections — those apply when a section is sent alone. When bundled, combine all outputs into one JSON object with the exact shape above.`;
}

// ─── BACKEND TAB — live prompt composition tracking ─────────────────────────

let _promptCompositionHistory = [];
const PROMPT_HISTORY_MAX = 20;

function recordPromptComposition(agent, mode, fileKeys) {
  const entry = {
    agent,
    mode: mode || null,
    timestamp: new Date().toLocaleTimeString(),
    files: fileKeys.map(key => ({
      key,
      path: (PROMPT_FILES[key] || '').replace(/^\/prompts\//, ''),
      size: (prompts[key] || '').length,
    })),
  };
  _promptCompositionHistory.unshift(entry);
  if (_promptCompositionHistory.length > PROMPT_HISTORY_MAX) {
    _promptCompositionHistory.length = PROMPT_HISTORY_MAX;
  }
  renderPromptStackTab();
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function renderPromptStackTab() {
  const emptyEl   = document.getElementById('prompt-stack-empty');
  const contentEl = document.getElementById('prompt-stack-content');
  if (!emptyEl || !contentEl) return;
  if (_promptCompositionHistory.length === 0) {
    emptyEl.style.display = 'block';
    contentEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  contentEl.style.display = 'block';

  const renderEntry = (c, idx) => {
    const total = c.files.reduce((s, f) => s + f.size, 0);
    const isLatest = idx === 0;
    return `
      <div class="json-section" style="${isLatest ? '' : 'opacity:0.75;'}">
        <div class="json-title">
          <div class="dot" style="background:${isLatest ? 'var(--purple,#a78bfa)' : 'var(--text3)'}"></div>
          ${isLatest ? 'LATEST' : '#' + (idx + 1)} · ${c.agent}${c.mode ? ' · ' + c.mode : ''} · ${c.timestamp}
        </div>
        <div style="font-size:11px;line-height:1.6;color:var(--text2);padding:4px 0 8px 0;">
          <span style="color:var(--text3);">files:</span> <span style="color:var(--text1);">${c.files.length}</span>
          &nbsp;·&nbsp;
          <span style="color:var(--text3);">total:</span> <span style="color:var(--text1);">${fmtBytes(total)}</span>
        </div>
        <div style="font-size:11px;font-family:var(--mono,monospace);padding:2px 0;">
          ${c.files.map((f, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--border,#2a2a2a);">
              <div style="color:var(--text3);width:18px;text-align:right;">${i + 1}</div>
              <div style="flex:1;color:var(--text1);word-break:break-all;">${f.path}</div>
              <div style="color:var(--text3);white-space:nowrap;">${fmtBytes(f.size)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  };

  contentEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0 8px 0;">
      <div style="font-size:11px;color:var(--text3);">Recent calls (newest first)</div>
      <button onclick="clearPromptHistory()" style="font-size:10px;padding:3px 8px;background:var(--bg2,#1a1a1a);border:1px solid var(--border,#2a2a2a);color:var(--text3);cursor:pointer;border-radius:3px;">Clear</button>
    </div>
    ${_promptCompositionHistory.map(renderEntry).join('')}
  `;
}

function clearPromptHistory() {
  _promptCompositionHistory = [];
  renderPromptStackTab();
}

function getPromptForAgent(agent, mode) {
  if (agent === 'agent_builder' && mode && BUILDER_MODE_PROMPTS[mode]) {
    const subKeys = BUILDER_MODE_PROMPTS[mode];
    recordPromptComposition(agent, mode, ['agent_builder', ...subKeys]);
    const parts = [prompts['agent_builder']];
    for (const k of subKeys) parts.push(prompts[k] || '');
    if (subKeys.length > 1) {
      const slots = [...new Set(subKeys.map(k => MODE_SLOT[k]).filter(Boolean))];
      if (slots.length > 0) parts.push(buildMergeFooter(slots));
    }
    return parts.join('\n\n');
  }
  if (agent === 'agent_interviewer' && mode && INTERVIEWER_MODE_PROMPTS[mode]) {
    const subKeys = INTERVIEWER_MODE_PROMPTS[mode];
    recordPromptComposition(agent, mode, ['agent_interviewer', ...subKeys]);
    const parts = [prompts['agent_interviewer']];
    for (const k of subKeys) parts.push(prompts[k] || '');
    return parts.join('\n\n');
  }
  if (agent === 'agent_chat') {
    const hasDocuments = pendingFiles.some(f => f.text);
    const modeFiles = getChatModeFiles(hasDocuments);
    const keys = ['agent_chat', ...modeFiles.filter(k => prompts[k])];
    recordPromptComposition(agent, mode, keys);
    return keys.map(k => prompts[k]).join('\n\n');
  }
  const fallback = prompts[agent] ? agent : 'agent_chat';
  recordPromptComposition(agent, mode, [fallback]);
  return prompts[fallback];
}
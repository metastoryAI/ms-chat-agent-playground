// ─── PROMPTS ─────────────────────────────────────────────────────────────────

// Ensure every agent×provider combo has a saved model in localStorage at startup.
// This guarantees getModelForAgent() never has to fall back to the global model.
(function initAgentModelDefaults() {
  const agents    = ['intent_router', 'analyze', 'answer', 'clarify', 'query', 'mutation', 'builder', 'interview'];
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

let currentPromptTab = 'intent_router';
let prompts = {
  // Top-level standalone agents (one tab each)
  intent_router:                          'Loading...',
  answer:                                 'Loading...',
  clarify:                                'Loading...',
  query:                                  'Loading...',
  mutation:                               'Loading...',
  // Composite agent bases (one tab each)
  analyze_base:                           'Loading...',
  builder_base:                           'Loading...',
  interview_base:                         'Loading...',
  // ANALYZE conditional rules + actions (composed by variant_key)
  analyze_rule_next_actions_tags:         '',
  analyze_rule_project_context:           '',
  analyze_rule_target_keywords:           '',
  analyze_rule_post_insert_routing:       '',
  analyze_action_analyze_document:        '',
  analyze_action_analyze_input:           '',
  analyze_action_add_input:               '',
  analyze_action_modify_input:            '',
  analyze_action_remove_input:            '',
  analyze_action_extract_details:         '',
  // BUILDER always-loaded rules + per-mode files
  builder_rule_module_naming:             '',
  builder_rule_confidence:                '',
  builder_rule_summary_style:             '',
  builder_rule_resolved_points:           '',
  builder_rule_gaps:                      '',
  builder_rule_context_enrichment:        '',
  builder_mode_generate_modules:          '',
  builder_mode_generate_modules_features: '',
  builder_mode_generate_pages:            '',
  builder_mode_add_features:              '',
  builder_mode_add_subfeatures:           '',
  builder_mode_resolve:                   '',
  builder_mode_diff:                      '',
  // INTERVIEW per-mode files
  interview_mode_solve_open_points:       '',
  interview_mode_enrich_context:          '',
};

const PROMPT_FILES = {
  // Top-level standalone agents
  intent_router:                          '/prompts/INTENT_ROUTER_AGENT.md',
  answer:                                 '/prompts/ANSWER_AGENT.md',
  clarify:                                '/prompts/CLARIFY_AGENT.md',
  query:                                  '/prompts/QUERY_AGENT.md',
  mutation:                               '/prompts/MUTATION_AGENT.md',
  // Composite agent bases
  analyze_base:                           '/prompts/ANALYZE/ANALYZE_AGENT_PROMPT.md',
  builder_base:                           '/prompts/BUILDER/BUILDER_AGENT_PROMPT.md',
  interview_base:                         '/prompts/INTERVIEW/INTERVIEW_AGENT_PROMPT.md',
  // ANALYZE rules + actions
  analyze_rule_next_actions_tags:         '/prompts/ANALYZE/ANALYZE_RULE_NEXT_ACTIONS_TAGS.md',
  analyze_rule_project_context:           '/prompts/ANALYZE/ANALYZE_RULE_PROJECT_CONTEXT.md',
  analyze_rule_target_keywords:           '/prompts/ANALYZE/ANALYZE_RULE_TARGET_KEYWORDS.md',
  analyze_rule_post_insert_routing:       '/prompts/ANALYZE/ANALYZE_RULE_POST_INSERT_ROUTING.md',
  analyze_action_analyze_document:        '/prompts/ANALYZE/ANALYZE_ACTION_ANALYZE_DOCUMENT.md',
  analyze_action_analyze_input:           '/prompts/ANALYZE/ANALYZE_ACTION_ANALYZE_INPUT.md',
  analyze_action_add_input:               '/prompts/ANALYZE/ANALYZE_ACTION_ADD_INPUT.md',
  analyze_action_modify_input:            '/prompts/ANALYZE/ANALYZE_ACTION_MODIFY_INPUT.md',
  analyze_action_remove_input:            '/prompts/ANALYZE/ANALYZE_ACTION_REMOVE_INPUT.md',
  analyze_action_extract_details:         '/prompts/ANALYZE/ANALYZE_ACTION_EXTRACT_DETAILS.md',
  // BUILDER rules + modes
  builder_rule_module_naming:             '/prompts/BUILDER/BUILDER_RULE_MODULE_NAMING.md',
  builder_rule_confidence:                '/prompts/BUILDER/BUILDER_RULE_CONFIDENCE.md',
  builder_rule_summary_style:             '/prompts/BUILDER/BUILDER_RULE_SUMMARY_STYLE.md',
  builder_rule_resolved_points:           '/prompts/BUILDER/BUILDER_RULE_RESOLVED_POINTS.md',
  builder_rule_gaps:                      '/prompts/BUILDER/BUILDER_RULE_GAPS.md',
  builder_rule_context_enrichment:        '/prompts/BUILDER/BUILDER_RULE_CONTEXT_ENRICHMENT.md',
  builder_mode_generate_modules:          '/prompts/BUILDER/BUILDER_MODE_GENERATE_MODULES.md',
  builder_mode_generate_modules_features: '/prompts/BUILDER/BUILDER_MODE_GENERATE_MODULES_FEATURES.md',
  builder_mode_generate_pages:            '/prompts/BUILDER/BUILDER_MODE_GENERATE_PAGES.md',
  builder_mode_add_features:              '/prompts/BUILDER/BUILDER_MODE_ADD_FEATURES.md',
  builder_mode_add_subfeatures:           '/prompts/BUILDER/BUILDER_MODE_ADD_SUBFEATURES.md',
  builder_mode_resolve:                   '/prompts/BUILDER/BUILDER_MODE_RESOLVE.md',
  builder_mode_diff:                      '/prompts/BUILDER/BUILDER_MODE_DIFF.md',
  // INTERVIEW modes
  interview_mode_solve_open_points:       '/prompts/INTERVIEW/INTERVIEW_MODE_SOLVE_OPEN_POINTS.md',
  interview_mode_enrich_context:          '/prompts/INTERVIEW/INTERVIEW_MODE_ENRICH_CONTEXT.md',
};

// ANALYZE composition — conditional loading driven by the router's variant_key.
// Always-loaded core (base + tag rules + project_context rule) + exactly one
// ACTION file + a few state-conditional rules.
const ANALYZE_ACTION_FILES = {
  analyze_document: 'analyze_action_analyze_document',
  analyze_input:    'analyze_action_analyze_input',
  add_input:        'analyze_action_add_input',
  modify_input:     'analyze_action_modify_input',
  remove_input:     'analyze_action_remove_input',
  extract_details:  'analyze_action_extract_details',
};
const ANALYZE_ALWAYS = ['analyze_base', 'analyze_rule_next_actions_tags', 'analyze_rule_project_context'];
const TARGET_KEYWORD_VARIANTS = new Set(['add_input', 'modify_input', 'remove_input']);

function composeAnalyzePromptKeys(variantKey) {
  const keys = [...ANALYZE_ALWAYS];
  if (variantKey && ANALYZE_ACTION_FILES[variantKey]) {
    keys.push(ANALYZE_ACTION_FILES[variantKey]);
    if (TARGET_KEYWORD_VARIANTS.has(variantKey)) keys.push('analyze_rule_target_keywords');
  } else {
    // Fallback — no variant from router. Load every action file.
    for (const v of Object.values(ANALYZE_ACTION_FILES)) keys.push(v);
    keys.push('analyze_rule_target_keywords');
  }
  if (typeof state !== 'undefined' && state && state.existing_structure) {
    keys.push('analyze_rule_post_insert_routing');
  }
  return keys;
}

// BUILDER composition — base + always-loaded rules + one mode file.
const BUILDER_ALWAYS = [
  'builder_base',
  'builder_rule_module_naming',
  'builder_rule_confidence',
  'builder_rule_summary_style',
  'builder_rule_resolved_points',
  'builder_rule_gaps',
  'builder_rule_context_enrichment',
];
const BUILDER_MODE_FILES = {
  generate_modules:          'builder_mode_generate_modules',
  generate_modules_features: 'builder_mode_generate_modules_features',
  generate_pages:            'builder_mode_generate_pages',
  add_features:              'builder_mode_add_features',
  add_subfeatures:           'builder_mode_add_subfeatures',
  resolve:                   'builder_mode_resolve',
  diff:                      'builder_mode_diff',
};

// Modes that bundle the documentary pages output alongside their primary slot.
// Per BUILDER_AGENT_PROMPT.md: generate_modules / generate_modules_features /
// generate_pages always emit `pages[]`, so the pages-mode rules need to be in
// the system prompt for those calls. resolve / diff do NOT emit pages[].
const BUILDER_MODES_WITH_PAGES = new Set(['generate_modules', 'generate_modules_features']);

function composeBuilderPromptKeys(mode) {
  const keys = [...BUILDER_ALWAYS];
  if (mode && BUILDER_MODE_FILES[mode]) keys.push(BUILDER_MODE_FILES[mode]);
  // Append the pages-mode prompt for fresh-generation modes so the LLM also
  // produces `pages[]` in the same call.
  if (BUILDER_MODES_WITH_PAGES.has(mode)) keys.push('builder_mode_generate_pages');
  return keys;
}

// INTERVIEW composition — base + one mode file.
const INTERVIEW_ALWAYS = ['interview_base'];
const INTERVIEW_MODE_FILES = {
  solve_open_points: 'interview_mode_solve_open_points',
  enrich_context:    'interview_mode_enrich_context',
};

function composeInterviewPromptKeys(mode) {
  const keys = [...INTERVIEW_ALWAYS];
  if (mode && INTERVIEW_MODE_FILES[mode]) keys.push(INTERVIEW_MODE_FILES[mode]);
  return keys;
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

const PROMPT_MODAL_TABS = ['intent_router', 'analyze_base', 'answer', 'clarify', 'query', 'mutation', 'builder_base', 'interview_base'];

// Map a modal tab key to the agent's canonical key (used by callAgent / getModelForAgent).
// Composite agents store the base file under "<agent>_base" but the agent key itself
// drops the suffix.
const TAB_TO_AGENT_KEY = {
  intent_router:  'intent_router',
  analyze_base:   'analyze',
  answer:         'answer',
  clarify:        'clarify',
  query:          'query',
  mutation:       'mutation',
  builder_base:   'builder',
  interview_base: 'interview',
};

function showPromptTab(key) {
  currentPromptTab = key;
  const promptTabs = document.querySelectorAll('#prompts-modal .mtab');
  promptTabs.forEach(t => t.classList.remove('active'));
  const idx = PROMPT_MODAL_TABS.indexOf(key);
  if (idx !== -1 && promptTabs[idx]) promptTabs[idx].classList.add('active');
  document.getElementById('prompt-editor').value = prompts[key] || '';
  document.getElementById('saved-badge').style.display = 'none';
  renderTOC(prompts[key] || '');
  // Model selector keys off the agent's canonical name, not the file storage key.
  renderAgentModelSidebar(TAB_TO_AGENT_KEY[key] || key);
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
  // If this is intent_router and the current provider matches → sync toolbar label.
  // Intent router drives the toolbar model since it's the entry point.
  if (agentKey === 'intent_router' && providerKey === provider) {
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
  // Intent router — single file, no composition.
  if (agent === 'intent_router') {
    recordPromptComposition('intent_router', null, ['intent_router']);
    return prompts.intent_router;
  }
  // Standalone agents — single file each.
  if (agent === 'answer')   { recordPromptComposition('answer',   null, ['answer']);   return prompts.answer; }
  if (agent === 'query')    { recordPromptComposition('query',    null, ['query']);    return prompts.query; }
  if (agent === 'mutation') { recordPromptComposition('mutation', null, ['mutation']); return prompts.mutation; }
  // Clarify — variant carried in payload (clarify_variant); prompt is single file.
  if (agent === 'clarify') {
    recordPromptComposition('clarify', mode, ['clarify']);
    return prompts.clarify;
  }
  // Composite — analyze (variant_key drives action selection).
  if (agent === 'analyze') {
    const keys = composeAnalyzePromptKeys(mode);
    recordPromptComposition('analyze', mode, keys);
    return keys.map(k => prompts[k]).filter(Boolean).join('\n\n');
  }
  // Composite — builder (mode drives mode-file selection).
  if (agent === 'builder') {
    const keys = composeBuilderPromptKeys(mode);
    recordPromptComposition('builder', mode, keys);
    let composed = keys.map(k => prompts[k]).filter(Boolean).join('\n\n');
    // Override footer — resolves the conflict between the modules-mode rule
    // ("never emit pages[]") and the bundled pages-mode rule ("emit pages[]").
    // When bundling, both modes are present in the system prompt; without this
    // footer the modules rule wins and pages[] never appears in the response.
    if (BUILDER_MODES_WITH_PAGES.has(mode)) {
      composed += '\n\n## BUNDLED OUTPUT — OVERRIDE\n' +
        'This call bundles `BUILDER_MODE_GENERATE_PAGES.md` with `' +
        (mode === 'generate_modules_features' ? 'BUILDER_MODE_GENERATE_MODULES_FEATURES' : 'BUILDER_MODE_GENERATE_MODULES') +
        '.md`. ' +
        'Ignore any "never emit `pages[]`" wording in the modules-mode file — that wording assumes a parallel-call architecture which is no longer used. ' +
        'In this bundled call you MUST emit BOTH `modules[]` (per the modules-mode rules) AND `pages[]` (per the pages-mode rules) in the SAME response object. ' +
        'Apply both rule sets independently and merge the slots into one envelope.';
    }
    return composed;
  }
  // Composite — interview (mode drives mode-file selection).
  if (agent === 'interview') {
    const keys = composeInterviewPromptKeys(mode);
    recordPromptComposition('interview', mode, keys);
    return keys.map(k => prompts[k]).filter(Boolean).join('\n\n');
  }
  // Fallback — unknown agent → intent_router (entry point).
  recordPromptComposition(agent, mode, ['intent_router']);
  return prompts.intent_router;
}
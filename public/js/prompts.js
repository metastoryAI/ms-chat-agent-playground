// ─── PROMPTS ─────────────────────────────────────────────────────────────────

// Ensure every agent×provider combo has a saved model in localStorage at startup.
// This guarantees getModelForAgent() never has to fall back to the global model.
(function initAgentModelDefaults() {
  const agents    = ['chat_agent', 'structure_generator'];
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

let currentPromptTab = 'chat_agent';
let prompts = {
  chat_agent: 'Loading...',
  structure_generator: 'Loading...',
};

const PROMPT_FILES = {
  chat_agent: '/prompts/chat-agent-v1.0.md',
  structure_generator: '/prompts/structure-generator-agent-v1.0.md',
};

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
  const tabs = ['chat_agent', 'structure_generator'];
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

  let html = '<div class="toc-header">Contents</div>';
  if (headers.length === 0) {
    html += '<div class="toc-empty">No headers found</div>';
  } else {
    headers.forEach(h => {
      html += `<button class="toc-item toc-h${h.level}" onclick="scrollToHeader(${h.lineIndex})" title="${h.text}">${h.text}</button>`;
    });
  }
  view.innerHTML = html;
}

// ─── FLOW VIEW ────────────────────────────────────────────────────────────────

const AGENT_FLOWS = {

  chat_agent: `<fa>── STEP 1: PRIORITY CHECK ──────────────────────────────────────</fa>
<fa>Is a project present?</fa>
  <fdim>documents[] not empty       ─┐
  free_inputs[] not empty     ─┼─ YES → skip onboarding, go to Step 2
  project_summary not null    ─┘
  all empty / null            → NO  → answer Case 2</fdim>
         <fout>[NA:EMPTY]</fout>  chat: short friendly prompt
                                buttons: Upload Document / Enter Project Input

<fa>── STEP 2: SPECIAL CASE ────────────────────────────────────────</fa>
user_input = "" AND documents[] not empty?
  YES → <fout>analyze_document</fout> <fdim>(user uploaded file without typing)</fdim>
  NO  → continue to Step 3

<fa>── STEP 3: CONFLICT CHECK ──────────────────────────────────────</fa>
<fdim>(free_inputs[] or documents[] not empty)
AND new input describes a CLEARLY DIFFERENT project?
(different domain / app type / core purpose)</fdim>
  YES → <fout>clarify</fout> <fout>[NA:CONFLICT]</fout>
        <fdim>pending_free_input:
          source: "document" (if file) | "text" (if free text)
          document_name: filename | null
        buttons: Keep existing project / Switch to new project</fdim>
  NO  → continue to Step 4

<fa>── STEP 4: PENDING INPUTS CHECK ────────────────────────────────</fa>
<fdim>(only applies when user gives explicit generate command)
hasPendingInputs = manual_inputs.some(a => a.added_at > project_context.built_at)</fdim>
  YES → <fout>clarify</fout> <fout>[NA:PENDING]</fout>
        <fdim>buttons: Generate with new inputs / Update context first (Recommended)</fdim>
  NO  → continue to Step 5

<fa>── STEP 5: INPUT TYPE DETECTION ────────────────────────────────</fa>

📄 <fa>File uploaded</fa> <fdim>(or user_input = "" with file present)</fdim>
    → always <fout>analyze_document</fout> FIRST <fdim>[Template A]</fdim>
    → no project_context     → <fout>[NA:NO_CONTEXT|RECOMMENDED:XX-XX|DIRECT:XX]</fout>
    → project_context exists → <fout>[NA:CONTEXT_UPDATE_DOC]</fout>
          <fdim>Update Context (Recommended) / Generate Structure Directly</fdim>

📝 <fa>Free text</fa> <fdim>(describes project, no file)</fdim>
    → <fout>analyze_input</fout> <fdim>[Template B]</fdim>  → <fout>[NA:STATE]</fout>

❓ <fa>Question about project</fa>
    → <fout>answer Case 1</fout>  <fdim>direct answer + transition line at end</fdim>
    → <fout>[NA:STATE]</fout>

💬 <fa>Off-topic / greeting / test</fa>
    project exists → <fout>answer</fout> <fdim>honestly, suggest what to do</fdim>  → <fout>[NA:STATE]</fout>
    no project     → <fout>answer Case 2</fout>  → <fout>[NA:EMPTY]</fout>

➕ <fa>New info</fa> <fdim>(not yet in context)</fdim>
    → <fout>add_to_manual_input</fout> <fdim>[Template C — added]</fdim>  → <fout>[NA:STATE]</fout>

✏️  <fa>Correction</fa> <fdim>(changes existing info)</fdim>
    → <fout>modify_manual_input</fout> <fdim>[Template C — updated]</fdim>  → <fout>[NA:STATE]</fout>

🎯 <fa>Generate — NO explicit type</fa>
    → <fout>clarify</fout> <fout>[NA:STRUCTURE_TYPE|DIRECT:XX]</fout>
      <fdim>buttons: Only Modules / Modules + Features / Full Structure</fdim>

🚀 <fa>Generate — EXPLICIT type</fa>
    hasPendingInputs?       → <fout>clarify [NA:PENDING]</fout> <fdim>(see Step 4)</fdim>
    no pending, no context  → <fout>route_to_agent: structure_generator</fout> <fdim>(fresh)</fdim>
    no pending, ctx exists  → <fout>route_to_agent: structure_generator</fout> <fdim>(diff)</fdim>

🔁 <fa>keep_existing_project</fa>
    free_inputs[] not empty → <fout>analyze_input</fout> <fdim>[Template B — keep opening]</fdim>
    documents[] not empty   → <fout>analyze_document</fout> <fdim>[Template A]</fdim>
    → <fout>[NA:STATE]</fout>

🔀 <fa>switch_to_new_project / [switch:document]</fa>
    file present → <fout>analyze_document</fout> <fdim>[Template A — switch opening]</fdim>
    no file      → <fout>analyze_input</fout> <fdim>[Template B — switch opening]</fdim>

<fa>── STEP 6: NEXT ACTIONS TAG SELECTION ──────────────────────────</fa>
<fdim>(applies to all actions except route_to_agent and clarify conflict)</fdim>

no project at all          → <fout>[NA:EMPTY]</fout>
no project_context         → <fout>[NA:NO_CONTEXT|RECOMMENDED:XX-XX|DIRECT:XX]</fout>
context + gaps[] not empty → <fout>[NA:CONTEXT_WITH_GAPS|RECOMMENDED:XX-XX|DIRECT:XX]</fout>
context + gaps[] empty     → <fout>[NA:CONTEXT_READY|CONFIDENCE:XX]</fout>
new doc + context exists   → <fout>[NA:CONTEXT_UPDATE_DOC]</fout>
existing_structure set     → <fout>[NA:STRUCTURE_INSERTED]</fout>
conflict detected          → <fout>[NA:CONFLICT]</fout>
pending inputs             → <fout>[NA:PENDING]</fout>
generate type unclear      → <fout>[NA:STRUCTURE_TYPE|DIRECT:XX]</fout>

<fa>── STEP 7: CONFIDENCE ESTIMATION ───────────────────────────────</fa>
RECOMMENDED <fdim>(context built first)</fdim>
  sparse input   → 65-75%   moderate input → 75-85%   detailed input → 85-95%
  <fdim>always a range — never a single value (e.g. 75-85 not 80)</fdim>

DIRECT <fdim>(without context)</fdim>
  minimal input  → 25-35%   moderate input → 35-45%   detailed input → 40-50%
  +5 if documents[] AND manual_inputs[] both present — never exceed 50%

CONFIDENCE <fdim>(for [NA:CONTEXT_READY] only)</fdim>
  take from project_context.confidence — round to nearest 5

<fa>── TEMPLATES ────────────────────────────────────────────────────</fa>
<fa>Template A</fa> — analyze_document
  opening: "Here is what I understood from the [detected format]:"
  <fdim>detected format: transcript / meeting notes / email / specification / document
  never use: PDF / DOCX</fdim>
  body:    1 sentence (project + who + period) + Topics discussed: 4-6 bullets
           Agreed approach: <fdim>(only if explicitly stated)</fdim>
  language: always match document language

<fa>Template B</fa> — analyze_input
  opening (default): <fdim>"This is the current project context based on your input:"</fdim>
  opening (switch):  <fdim>"You are now working with the new project:"</fdim>
  opening (keep):    <fdim>"You are continuing with the current project:"</fdim>
  body:    1 sentence from project_summary + Captured topics: 4-6 bullets
           💡 The more details you add, the better the context will be.

<fa>Template C</fa> — add/modify manual_input
  opening (add):    <fdim>"[Topic] added — here is the current project overview:"</fdim>
  opening (modify): <fdim>"[Topic] updated — here is the current project overview:"</fdim>
  body:    1 sentence from updated project_summary + Current project overview: 3-5 bullets

<fa>Template D</fa> — clarify
  1 clear question only — max 2 sentences, no opening / no bullets
  conflict variant: 1 short sentence only
  <fdim>example: "This doesn't match the current project. Which one should I work with?"</fdim>

answer <fdim>(no template)</fdim>
  Case 1: direct answer + transition line at end
  Case 2: short onboarding prompt 1-2 sentences
  <fdim>never: confirmation / key topics / project recap / guess beyond context</fdim>

<fa>── LANGUAGE RULES ───────────────────────────────────────────────</fa>
chat_response → user/document language
JSON keys · action values · button labels/subtext/tooltips → always English`,

  structure_generator: `<fa>── INPUT ─────────────────────────</fa>
generation_type: modules | modules_features
                 full_structure | pages_only
mode:            generate | refine | diff
project_context: null → derive internally
existing_structure: null → fresh | exists → diff/refine

<fa>── project_context NULL ───────────</fa>
Derive from documents[] + manual_inputs[]
Do NOT ask questions
Set store_project_context: true

<fa>── MODE: generate ─────────────────</fa>
│
├─ generation_type: pages_only
│   └─ <fout>→ pages only</fout>
│
├─ generation_type: modules
│   └─ <fout>→ pages + modules</fout>
│       action_buttons: Refine modules | Resolve assumptions | + Insert
│
├─ generation_type: modules_features
│   └─ <fout>→ pages + modules + features</fout>
│       action_buttons: Refine all | Resolve assumptions | + Insert
│
└─ generation_type: full_structure
    └─ <fout>→ pages + modules + features + subfeatures</fout>
        action_buttons: Refine structure | Resolve assumptions | + Insert
        └─ <fdim>status: completed</fdim>
            handoff_back → chat_agent (trigger: generation_completed)

<fa>── MODE: refine ───────────────────</fa>
refine_instruction provided by user
Keep all existing unless instruction says remove
Only change what instruction requests
└─ <fout>→ full updated structure</fout> <fdim>status: completed</fdim>

<fa>── MODE: diff ─────────────────────</fa>
existing_structure exists
Compare new context vs existing modules
└─ return only changed or new modules
    <fout>status: diff_completed</fout>
    updated_modules[] + unchanged_count
    is_new: true/false per module
    handoff_back → chat_agent

<fa>── PAGE TYPES (conditional) ───────</fa>
project_summary  → always
user_roles       → if roles mentioned
core_process     → if process described
tech_stack       → if stack defined
integrations     → if integrations listed
non_functional   → if NFRs mentioned
target_audience  → if audience described
mvp_scope        → if MVP discussed
<fdim>only generate when content exists</fdim>

<fa>── SOURCE TYPES ───────────────────</fa>
Every element MUST have sources[]
document     → from uploaded file
user_input   → user typed in chat
manual_input → via add_to_manual_input
assumption   → no source, agent derived
<fdim>no source → goes to assumptions[]</fdim>

<fa>── CONFIDENCE / ASSUMPTION LABELS ─</fa>
never generate below 35%
50–75% → "with assumptions"
75–90% → "minor assumptions"
90%+   → "no assumptions needed"
<fdim>never show % next to assumption labels</fdim>

<fa>── ANTI-PATTERNS ──────────────────</fa>
✗ never ask questions
✗ never show features when type = modules
✗ never lose modules in diff mode
✗ never generate below 35%
✗ never create element without sources[]
✗ never omit action_buttons`

};

// ─── AGENT MODEL SIDEBAR ─────────────────────────────────────────────────────

const PROVIDER_LABELS = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', kimi: 'Kimi' };

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
  // If this is the chat_agent and the current provider matches → sync toolbar label
  if (agentKey === 'chat_agent' && providerKey === provider) {
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
  const filename = PROMPT_FILES[currentPromptTab].split('/').pop(); // e.g. "chat-agent-v1.0.md"
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

function getPromptForAgent(agent) {
  const map = {
    chat_agent: 'chat_agent',
    structure_generator: 'structure_generator',
  };
  return prompts[map[agent] || 'chat_agent'];
}

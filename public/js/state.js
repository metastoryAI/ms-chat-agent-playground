// ─── STATE ───────────────────────────────────────────────────────────────────
let provider = 'anthropic';
let selectedModel = null; // set per provider

function freshState() {
  return {
    documents: [],
    free_inputs: [],
    manual_inputs: [],
    project_summary: null,
    project_context: null,
    existing_structure: null,
    docCounter: 0,
    manualCounter: 0,
    messagesHTML: null,
    debugInput: null,
    debugOutput: null,
    _pendingConflict: null,
    _contextBuilderMode: false,
    _qaHistory: [],
    _selectedTopics: [],
    _capturedTopics: null, // stored from first analyze_input/analyze_document — never changes
  };
}

const providerStates = {
  anthropic: freshState(),
  openai: freshState(),
  gemini: freshState(),
  kimi: freshState()
};

// Models per provider — first is default
const PROVIDER_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', ctx: 200000 },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', ctx: 200000 },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', ctx: 200000 },
  ],
  openai: [
    { id: 'gpt-4.1', name: 'GPT-4.1', ctx: 1047576 },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', ctx: 1047576 },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', ctx: 1047576 },
    { id: 'o4-mini', name: 'o4-mini', ctx: 200000 },
    { id: 'gpt-4o', name: 'GPT-4o', ctx: 128000 },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', ctx: 1048576 },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', ctx: 1048576 },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', ctx: 1048576 },
  ],
  kimi: [
    { id: 'kimi-k2.5', name: 'Kimi K2.5', ctx: 131072 },
  ]
};

function getSelectedModel() {
  return selectedModel || PROVIDER_MODELS[provider][0].id;
}

// Returns the configured model for a specific agent+provider combo.
// Falls back to the globally selected model if none is set.
function getModelForAgent(agentKey) {
  const saved = localStorage.getItem(`ms_agent_model_${agentKey}_${provider}`);
  const models = PROVIDER_MODELS[provider] || [];
  if (saved && models.find(m => m.id === saved)) return saved;
  return getSelectedModel();
}

function getModelContextLimit() {
  const models = PROVIDER_MODELS[provider] || [];
  const model = models.find(m => m.id === getSelectedModel());
  return model ? model.ctx : 200000;
}

let state = providerStates['anthropic'];
let pendingFile = null;
let pendingFileText = null;
let isLoading = false;
let docCounter = 0;
let manualCounter = 0;

// Token tracking
const tokenStats = { totalInput: 0, totalOutput: 0, requests: 0, log: [] };
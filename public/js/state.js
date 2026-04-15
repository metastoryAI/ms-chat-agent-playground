// ─── STATE ───────────────────────────────────────────────────────────────────
let provider = 'anthropic';
let selectedModel = null; // set per provider

function freshState() {
  return {
    inputs: [],
    project_summary: null,
    project_context: null,
    existing_structure: null,
    docCounter: 0,
    _mode: 'chat',
    messagesHTML: null,
    debugInput: null,
    debugOutput: null,
    _pendingConflict: null,
    _contextBuilderMode: false,
    _qaHistory: [],
    _selectedTopics: [],
    _capturedTopics: null, // stored from first analyze_input/analyze_document — never changes
    _openPoints: [],      // unresolved decisions/unclear requirements from input
    _projectNotes: [],    // PM/planning items — launch strategy, migration, responsibilities
    _resolvedAnswers: [],  // answers from last resolve — kept for discard flow
    _resolvedPoints: [],   // confirmed resolved open points — shown separately, not in captured topics
    _openPointsLoadingCount: 0, // number of pending per-doc open-point extractions
    _openPointsLoadingStart: null, // timestamp when the first pending extraction started
    project_language: null, // null = not yet picked — set once via startup QA, then locked
    _languageConfirmed: false, // true after user picks from the startup language QA
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

// Provider display names — single source of truth
const PROVIDER_LABELS = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', kimi: 'Kimi' };

// Helpers to filter inputs by source
function getDocuments()    { return state.inputs.filter(i => i.source === 'document'); }
function getFreeInputs()   { return state.inputs.filter(i => i.source === 'text'); }
function getAdditionalInputs() { return state.inputs.filter(i => i.source === 'additional'); }

let state = providerStates['anthropic'];
// Multi-file upload: each entry is { file: File, text: string|null, ready: Promise<void>, error: string|null }
let pendingFiles = [];
let isLoading = false;
let docCounter = 0;
let activeAbortController = null;

// Token tracking
const tokenStats = { totalInput: 0, totalOutput: 0, requests: 0, log: [] };

// ─── App namespace — groups cross-file mutable state for discoverability ─────
// Individual vars above remain for backward compat; App.x is the canonical ref.
const App = {
  // Core state
  get provider()    { return provider; },
  set provider(v)   { provider = v; },
  get state()       { return state; },
  set state(v)      { state = v; },
  get isLoading()   { return isLoading; },
  set isLoading(v)  { isLoading = v; },
  get docCounter()  { return docCounter; },
  set docCounter(v) { docCounter = v; },

  // File handling (multi-file)
  get pendingFiles()      { return pendingFiles; },
  set pendingFiles(v)     { pendingFiles = v; },
  // Back-compat shims: singular getters return the first entry's fields
  get pendingFile()       { return pendingFiles[0]?.file || null; },
  set pendingFile(v)      {
    if (v == null) { pendingFiles = []; return; }
    pendingFiles = [{ file: v, text: pendingFiles[0]?.text || null, ready: pendingFiles[0]?.ready || null, error: null }];
  },
  get pendingFileText()   { return pendingFiles[0]?.text || null; },
  set pendingFileText(v)  { if (pendingFiles[0]) pendingFiles[0].text = v; },

  // Abort
  get activeAbortController()      { return activeAbortController; },
  set activeAbortController(v)     { activeAbortController = v; },

  // UI persistence (set by ui.js)
  messageLog: [],
  restoring: false,

  // Widget state (set by qa.js)
  cb: {
    questions: [],
    currentIdx: 0,
    batchAnswers: [],
    resolveMode: false,
    enrichMode: false,
    enrichContextMode: false,
    enrichContextSource: 'chat',
  },

  // Resolve state (set by response-handler.js)
  resolve: {
    questions: [],
    currentIdx: 0,
    batchAnswers: [],
    lastOpenQuestions: [],
  },

  // Constants
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  providerStates,
  tokenStats,
};
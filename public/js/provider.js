// ─── PROVIDER ────────────────────────────────────────────────────────────────
// PROVIDER_LABELS defined in state.js

function populateModelSelect() {
  const models = PROVIDER_MODELS[provider] || [];
  // Prefer the agent_chat-specific model for this provider, fallback to global saved
  const agentSaved  = localStorage.getItem(`ms_agent_model_agent_chat_${provider}`);
  const globalSaved = localStorage.getItem('ms_model_' + provider);
  const resolved    = (agentSaved && models.find(m => m.id === agentSaved)) ? agentSaved : globalSaved;
  selectedModel = resolved || models[0]?.id || null;
  updateModelLabel();
}

function updateModelLabel() {
  const models  = PROVIDER_MODELS[provider] || [];
  const modelId = getSelectedModel();
  const model   = models.find(m => m.id === modelId);
  const label   = document.getElementById('model-label');
  if (label) label.textContent = model ? model.name : (modelId || '');
}

function setModelLabelForAgent(agentKey) {
  const models  = PROVIDER_MODELS[provider] || [];
  const modelId = getModelForAgent(agentKey);
  const model   = models.find(m => m.id === modelId);
  const label   = document.getElementById('model-label');
  if (label) label.textContent = model ? model.name : (modelId || '');
}

function onModelChange(val) {
  selectedModel = val;
  localStorage.setItem('ms_model_' + provider, val);
  updateModelLabel();
  updateTokenPanel();
  updateStatePanel();
}

function setProvider(p, el) {
  if (isLoading) return;

  const old = providerStates[provider];
  old.docCounter = docCounter;
  old.messagesHTML = document.getElementById('messages').innerHTML;
  old.debugInput = document.getElementById('debug-input').textContent;
  old.debugOutput = document.getElementById('debug-output').textContent;

  provider = p;
  localStorage.setItem('ms_provider', p);

  state = providerStates[p];
  docCounter = state.docCounter;

  const msgEl = document.getElementById('messages');
  if (state.messagesHTML) {
    msgEl.innerHTML = state.messagesHTML;
  } else {
    msgEl.innerHTML = `<div class="empty-state" id="empty-state">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="1.5"/><path d="M13 20h14M20 13v14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <div class="empty-title">Metastory AI Chat Agent</div>
      <div class="empty-sub">Upload a PDF or type a project description to start</div>
    </div>`;
  }
  scrollToBottom();

  if (state.debugInput) {
    document.getElementById('io-empty').style.display = 'none';
    document.getElementById('io-content').style.display = 'block';
    document.getElementById('debug-input').textContent = state.debugInput;
    document.getElementById('debug-output').textContent = state.debugOutput || '';
  } else {
    document.getElementById('io-empty').style.display = 'block';
    document.getElementById('io-content').style.display = 'none';
  }

  // Update activity bar icons
  document.querySelectorAll('.ab-provider').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('st-provider').textContent = p;

  // Update flyout
  const flyoutTitle = document.getElementById('ab-flyout-title');
  if (flyoutTitle) flyoutTitle.textContent = PROVIDER_LABELS[p];
  document.querySelectorAll('.api-key-input[data-provider]').forEach(el => {
    el.style.display = el.dataset.provider === p ? '' : 'none';
  });

  // Show flyout on provider switch
  const flyout = document.getElementById('ab-flyout');
  if (flyout) flyout.style.display = 'block';

  populateModelSelect();
  updateStatusDot();
  updateStatePanel();
  updateTokenPanel();
}

function onKeyInput(p) {
  const val = document.getElementById('api-key-' + p).value.trim();
  if (val) localStorage.setItem('ms_key_' + p, val);
  else localStorage.removeItem('ms_key_' + p);
  updateStatusDot();
}

function getActiveKey() {
  return document.getElementById('api-key-' + provider).value.trim();
}

function clearApiKey() {
  document.getElementById('api-key-' + provider).value = '';
  localStorage.removeItem('ms_key_' + provider);
  updateStatusDot();
}

function updateStatusDot() {
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot' + (getActiveKey() ? ' ok' : '');
}

function restoreKeys() {
  const saved = localStorage.getItem('ms_provider');
  if (saved) provider = saved;
  ['anthropic', 'openai', 'gemini', 'kimi'].forEach(p => {
    const key = localStorage.getItem('ms_key_' + p);
    if (key) document.getElementById('api-key-' + p).value = key;
  });
  document.querySelectorAll('.ab-provider').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ab-provider').forEach(t => {
    if (t.dataset.provider === provider) t.classList.add('active');
  });
  const flyoutTitle = document.getElementById('ab-flyout-title');
  if (flyoutTitle) flyoutTitle.textContent = PROVIDER_LABELS[provider];
  document.querySelectorAll('.api-key-input[data-provider]').forEach(el => {
    el.style.display = el.dataset.provider === provider ? '' : 'none';
  });
  state = providerStates[provider];
  populateModelSelect();
  updateStatusDot();
}
restoreKeys();
updateTokenPanel();

function showTab(id, el) {
  document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (el) el.classList.add('active');
}

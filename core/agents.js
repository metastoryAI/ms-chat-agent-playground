const { v4: uuidv4 } = require('uuid');
const db             = require('./db');
const { buildStateJSON } = require('./state');
const { callLLM }    = require('./llm');

// ---------------------------------------------------------------------------
// DB Helpers
// ---------------------------------------------------------------------------

function recomputeProjectSummary(projectId) {
  const parts = [
    ...db.prepare('SELECT original_summary AS v FROM project_documents   WHERE project_id = ? ORDER BY uploaded_at').all(projectId),
    ...db.prepare('SELECT summary          AS v FROM project_free_inputs  WHERE project_id = ? ORDER BY added_at').all(projectId),
    ...db.prepare('SELECT detail           AS v FROM project_manual_inputs WHERE project_id = ? ORDER BY added_at').all(projectId),
  ].map(r => r.v).filter(Boolean);

  db.prepare(`
    INSERT INTO project_summary (id, project_id, text, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at
  `).run(uuidv4(), projectId, parts.join('\n\n'));
}

function saveMessage(projectId, role, content, action) {
  db.prepare(
    "INSERT INTO project_messages (id, project_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).run(uuidv4(), projectId, role, typeof content === 'string' ? content : JSON.stringify(content), action || null);
}

function saveProjectContext(projectId, ctx) {
  db.prepare(`
    INSERT INTO project_context (id, project_id, summary, confidence, entities, covered, gaps, built_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      summary = excluded.summary, confidence = excluded.confidence,
      entities = excluded.entities, covered = excluded.covered,
      gaps = excluded.gaps, built_at = excluded.built_at
  `).run(uuidv4(), projectId,
    ctx.summary || '', ctx.confidence || 0,
    JSON.stringify(ctx.entities || []), JSON.stringify(ctx.covered || []), JSON.stringify(ctx.gaps || []));
}

function hasPendingInputs(projectId) {
  const ctx = db.prepare('SELECT built_at FROM project_context WHERE project_id = ?').get(projectId);
  if (!ctx) return true;
  return db.prepare(
    'SELECT COUNT(*) as cnt FROM project_manual_inputs WHERE project_id = ? AND added_at > ?'
  ).get(projectId, ctx.built_at).cnt > 0;
}

// ---------------------------------------------------------------------------
// Chat Agent
// ---------------------------------------------------------------------------

async function handleChatAgent(projectId, provider, apiKey, userInput, fileBase64, fileName) {
  saveMessage(projectId, 'user', userInput, null);

  const stateJSON = buildStateJSON(projectId, userInput, fileBase64, fileName);
  const debug     = { input: stateJSON, agentPromptKey: 'chat_agent_v1.0' };
  const r         = await callLLM({ provider, apiKey, agentPromptKey: 'chat_agent_v1.0', stateJSON, fileBase64, fileName });
  debug.output    = r;

  let result;

  switch (r.action) {
    case 'answer':
      saveMessage(projectId, 'assistant', r.chat_response, 'answer');
      result = { type: 'answer', chat_response: r.chat_response };
      break;

    case 'clarify': {
      const stored = r.pending_free_input
        ? JSON.stringify({ chat_response: r.chat_response, pending_free_input: { summary: r.pending_free_input.summary, source: r.pending_free_input.source || 'text', document_name: r.pending_free_input.document_name || null } })
        : r.chat_response;
      saveMessage(projectId, 'assistant', stored, 'clarify');
      result = { type: 'clarify', chat_response: r.chat_response, pending_free_input: r.pending_free_input || null, next_actions: r.next_actions || null };
      break;
    }

    case 'route_to_agent':
      result = await handleRouteToAgent(projectId, provider, apiKey, r.target_agent, r);
      break;

    case 'add_to_manual_input':
      db.prepare("INSERT INTO project_manual_inputs (id, project_id, topic, detail, added_at) VALUES (?, ?, ?, ?, datetime('now'))")
        .run(uuidv4(), projectId, r.topic || 'User Input', r.detail || userInput);
      recomputeProjectSummary(projectId);
      saveMessage(projectId, 'assistant', r.chat_response || 'Input added.', 'add_to_manual_input');
      result = { type: 'add_to_manual_input', chat_response: r.chat_response || 'Input added.', next_actions: r.next_actions || null };
      break;

    case 'modify_manual_input':
      if (r.manual_input_id) {
        db.prepare("UPDATE project_manual_inputs SET topic = ?, detail = ?, added_at = datetime('now') WHERE id = ? AND project_id = ?")
          .run(r.topic, r.detail, r.manual_input_id, projectId);
      }
      recomputeProjectSummary(projectId);
      saveMessage(projectId, 'assistant', r.chat_response || 'Input updated.', 'modify_manual_input');
      result = { type: 'modify_manual_input', chat_response: r.chat_response || 'Input updated.', next_actions: r.next_actions || null };
      break;

    case 'analyze_document':
      db.prepare("INSERT INTO project_documents (id, project_id, name, original_summary, source, uploaded_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
        .run(uuidv4(), projectId, r.document_name || fileName || 'Document', r.original_summary || '', r.source || 'upload');
      recomputeProjectSummary(projectId);
      saveMessage(projectId, 'assistant', r.chat_response || 'Document analyzed.', 'analyze_document');
      result = { type: 'analyze_document', chat_response: r.chat_response || 'Document analyzed.', next_actions: r.next_actions || null };
      break;

    case 'analyze_input': {
      const fi = r.free_input;
      db.prepare("INSERT INTO project_free_inputs (id, project_id, summary, added_at) VALUES (?, ?, ?, datetime('now'))")
        .run(fi?.id || uuidv4(), projectId, fi?.summary || userInput);
      recomputeProjectSummary(projectId);
      saveMessage(projectId, 'assistant', r.chat_response || 'Input analyzed.', 'analyze_input');
      result = { type: 'analyze_input', chat_response: r.chat_response || 'Input analyzed.', next_actions: r.next_actions || null };
      break;
    }

    case 'switch_project': {
      let summary = userInput, source = 'text', documentName = null;
      const lastClarify = db.prepare(
        "SELECT content FROM project_messages WHERE project_id = ? AND action = 'clarify' ORDER BY created_at DESC LIMIT 1"
      ).get(projectId);
      if (lastClarify) {
        try {
          const p = JSON.parse(lastClarify.content);
          if (p.pending_free_input?.summary)       summary      = p.pending_free_input.summary;
          if (p.pending_free_input?.source)        source       = p.pending_free_input.source;
          if (p.pending_free_input?.document_name) documentName = p.pending_free_input.document_name;
        } catch (_) {}
      }
      if (source === 'document') {
        db.prepare('DELETE FROM project_documents WHERE project_id = ? AND source = ?').run(projectId, 'conflict_pending');
        db.prepare("INSERT INTO project_documents (id, project_id, name, original_summary, source, uploaded_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
          .run(uuidv4(), projectId, documentName || 'Document', summary, 'upload');
      } else {
        db.prepare('DELETE FROM project_free_inputs WHERE project_id = ?').run(projectId);
        db.prepare("INSERT INTO project_free_inputs (id, project_id, summary, added_at) VALUES (?, ?, ?, datetime('now'))")
          .run(uuidv4(), projectId, summary);
      }
      recomputeProjectSummary(projectId);
      saveMessage(projectId, 'assistant', r.chat_response || 'Switched to new project.', 'switch_project');
      result = { type: 'switch_project', chat_response: r.chat_response || 'Switched to new project.', next_actions: r.next_actions || null };
      break;
    }

    case 'keep_project':
      saveMessage(projectId, 'assistant', r.chat_response || 'Continuing with existing project.', 'keep_project');
      result = { type: 'answer', chat_response: r.chat_response || 'Continuing with existing project.', next_actions: r.next_actions || null };
      break;

    default:
      saveMessage(projectId, 'assistant', r.chat_response || JSON.stringify(r), r.action || 'unknown');
      result = { type: 'answer', chat_response: r.chat_response || JSON.stringify(r) };
  }

  result.debug = debug;
  return result;
}

// ---------------------------------------------------------------------------
// Route to specific agent
// ---------------------------------------------------------------------------

async function handleRouteToAgent(projectId, provider, apiKey, targetAgent, params) {
  const stateJSON = buildStateJSON(projectId, params.user_input || '', null, null);
  if (params.generation_type)               stateJSON.generation_type     = params.generation_type;
  if (params.mode)                          stateJSON.mode                = params.mode;
  if (params.include_manual_inputs != null) stateJSON.include_manual_inputs = params.include_manual_inputs;

  const promptKeyMap = {
    context_builder:    'context_builder_v1.0',
    structure_generator:'structure_generator_v1.0',
  };

  const agentPromptKey = promptKeyMap[targetAgent];
  if (!agentPromptKey) return { type: 'error', error: `Unknown agent: ${targetAgent}` };

  const debug    = { input: stateJSON, agentPromptKey };
  const response = await callLLM({ provider, apiKey, agentPromptKey, stateJSON });
  debug.output   = response;

  let result;
  switch (targetAgent) {
    case 'context_builder':    result = await handleContextBuilderOutput(projectId, provider, apiKey, response); break;
    case 'structure_generator':result = await handleStructureGeneratorOutput(projectId, provider, apiKey, response); break;
    default:                   result = { type: 'agent_response', data: response };
  }

  result.debug = debug;
  return result;
}

// ---------------------------------------------------------------------------
// Context Builder — output handler
// ---------------------------------------------------------------------------

async function handleContextBuilderOutput(projectId, provider, apiKey, output) {
  if (output.type === 'question') return { type: 'cb_question', questions: output.questions || [] };
  if (output.type === 'phase3')   return { type: 'cb_phase3',   options:   output.options   || [] };
  if (output.type === 'handoff') {
    if (output.project_context) saveProjectContext(projectId, output.project_context);
    return await handleRouteToAgent(projectId, provider, apiKey, 'structure_generator', {});
  }
  return { type: 'cb_response', data: output };
}

// ---------------------------------------------------------------------------
// Structure Generator — output handler
// ---------------------------------------------------------------------------

async function handleStructureGeneratorOutput(projectId, provider, apiKey, output) {
  if (output.store_project_context && output.project_context) {
    saveProjectContext(projectId, output.project_context);
  }

  if (output.status === 'completed') {
    db.prepare(`
      INSERT INTO project_structure (id, project_id, pages, modules, inserted_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET pages = excluded.pages, modules = excluded.modules, inserted_at = excluded.inserted_at
    `).run(uuidv4(), projectId, JSON.stringify(output.pages || []), JSON.stringify(output.modules || []));

    let chatResult = null;
    if (output.trigger === 'generation_completed') {
      chatResult = await handleChatAgent(projectId, provider, apiKey, '[trigger:generation_completed]', null, null);
    }
    return { type: 'sg_completed', pages: output.pages || [], modules: output.modules || [], chat_trigger_result: chatResult };
  }

  if (output.status === 'diff_completed') {
    const row = db.prepare('SELECT modules FROM project_structure WHERE project_id = ?').get(projectId);
    const modules = row ? JSON.parse(row.modules || '[]') : [];
    for (const updated of (output.updated_modules || [])) {
      const idx = modules.findIndex(m => m.id === updated.id);
      if (idx >= 0) modules[idx] = updated; else modules.push(updated);
    }
    db.prepare("UPDATE project_structure SET modules = ?, inserted_at = datetime('now') WHERE project_id = ?")
      .run(JSON.stringify(modules), projectId);
    return { type: 'sg_diff_completed', updated_modules: output.updated_modules || [] };
  }

  return { type: 'sg_response', data: output };
}

// ---------------------------------------------------------------------------
// Context Updater — output handler
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

module.exports = {
  handleChatAgent,
  handleRouteToAgent,
  recomputeProjectSummary,
  hasPendingInputs,
  saveMessage,
};

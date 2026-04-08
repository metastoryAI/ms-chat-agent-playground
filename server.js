const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./core/db');
const { handleChatAgent, handleRouteToAgent, applyContextUpdate, hasPendingInputs } = require('./core/agents');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/prompts', express.static(path.join(__dirname, 'prompts')));

// ---------------------------------------------------------------------------
// POST /api/projects/:id/chat
// ---------------------------------------------------------------------------
app.post('/api/projects/:id/chat', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_input, file_base64, file_name, provider, api_key } = req.body;

    if (!user_input && !file_base64) {
      return res.status(400).json({ error: 'user_input or file required' });
    }
    if (!provider || !api_key) {
      return res.status(400).json({ error: 'provider and api_key required' });
    }

    const result = await handleChatAgent(id, provider, api_key, user_input, file_base64, file_name);
    res.json(result);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/agent/route
// ---------------------------------------------------------------------------
app.post('/api/projects/:id/agent/route', async (req, res) => {
  try {
    const { id } = req.params;
    const { agent, generation_type, mode, include_manual_inputs, provider, api_key } = req.body;

    if (!agent) return res.status(400).json({ error: 'agent required' });
    if (!provider || !api_key) {
      return res.status(400).json({ error: 'provider and api_key required' });
    }

    const result = await handleRouteToAgent(id, provider, api_key, agent, {
      generation_type,
      mode,
      include_manual_inputs,
    });
    res.json(result);
  } catch (err) {
    console.error('Agent route error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/context/apply
// ---------------------------------------------------------------------------
app.post('/api/projects/:id/context/apply', (req, res) => {
  try {
    const { id } = req.params;
    const { updated_context } = req.body;
    const result = applyContextUpdate(id, updated_context);
    res.json(result);
  } catch (err) {
    console.error('Context apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/messages
// ---------------------------------------------------------------------------
app.get('/api/projects/:id/messages', (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const before = req.query.before; // cursor: created_at value

    let messages;
    if (before) {
      messages = db.prepare(
        'SELECT id, role, content, action, created_at FROM project_messages WHERE project_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
      ).all(id, before, limit);
    } else {
      messages = db.prepare(
        'SELECT id, role, content, action, created_at FROM project_messages WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(id, limit);
    }

    res.json({ messages: messages.reverse() });
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/state
// ---------------------------------------------------------------------------
app.get('/api/projects/:id/state', (req, res) => {
  try {
    const { id } = req.params;

    const documents = db.prepare(
      'SELECT id, name, original_summary, source, uploaded_at FROM project_documents WHERE project_id = ? ORDER BY uploaded_at'
    ).all(id);

    const manualInputs = db.prepare(
      'SELECT id, topic, detail, added_at FROM project_manual_inputs WHERE project_id = ? ORDER BY added_at'
    ).all(id);

    const summaryRow = db.prepare('SELECT text, updated_at FROM project_summary WHERE project_id = ?').get(id);

    const contextRow = db.prepare(
      'SELECT summary, confidence, entities, covered, gaps, built_at FROM project_context WHERE project_id = ?'
    ).get(id);

    const structureRow = db.prepare(
      'SELECT pages, modules, inserted_at FROM project_structure WHERE project_id = ?'
    ).get(id);

    let projectContext = null;
    if (contextRow) {
      projectContext = {
        summary: contextRow.summary,
        confidence: contextRow.confidence,
        entities: JSON.parse(contextRow.entities || '[]'),
        covered: JSON.parse(contextRow.covered || '[]'),
        gaps: JSON.parse(contextRow.gaps || '[]'),
        built_at: contextRow.built_at,
      };
    }

    let existingStructure = null;
    if (structureRow) {
      existingStructure = {
        pages: JSON.parse(structureRow.pages || '[]'),
        modules: JSON.parse(structureRow.modules || '[]'),
        inserted_at: structureRow.inserted_at,
      };
    }

    res.json({
      documents,
      manual_inputs: manualInputs,
      project_summary: summaryRow ? { text: summaryRow.text, updated_at: summaryRow.updated_at } : null,
      project_context: projectContext,
      existing_structure: existingStructure,
      has_pending_inputs: hasPendingInputs(id),
    });
  } catch (err) {
    console.error('State error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT id, name, created_at FROM projects ORDER BY created_at DESC').all();
  res.json({ projects });
});

// ---------------------------------------------------------------------------
// GET /api/prompts
// ---------------------------------------------------------------------------
app.get('/api/prompts', (req, res) => {
  const prompts = db.prepare('SELECT key, text, updated_at FROM prompts ORDER BY key').all();
  res.json({ prompts });
});

// ---------------------------------------------------------------------------
// PUT /api/prompts/:key
// ---------------------------------------------------------------------------
app.put('/api/prompts/:key', (req, res) => {
  const { key } = req.params;
  const { text } = req.body;
  db.prepare('UPDATE prompts SET text = ?, updated_at = datetime(\'now\') WHERE key = ?').run(text, key);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// PUT /api/prompts/file/:filename — save prompt to .md file
// ---------------------------------------------------------------------------
app.put('/api/prompts/file/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const { text } = req.body;
    // Only allow writing to known prompt files
    const allowed = ['chat-agent-v1.0.md', 'structure-generator-agent-v1.0.md'];
    if (!allowed.includes(filename)) {
      return res.status(400).json({ error: 'Unknown prompt file' });
    }
    const filePath = path.join(__dirname, 'prompts', filename);
    fs.writeFileSync(filePath, text, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// OpenAI CORS proxy — Chat Completions (non-PDF calls)
// ---------------------------------------------------------------------------
app.post('/openai', async (req, res) => {
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.body.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body.payload),
    });
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Kimi (Moonshot AI) CORS proxy — Chat Completions
// ---------------------------------------------------------------------------
app.post('/kimi', async (req, res) => {
  try {
    const r = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.body.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body.payload),
    });
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Serve frontend
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Metastory AI server running on http://localhost:${PORT}`);
});

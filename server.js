const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/prompts', express.static(path.join(__dirname, 'prompts')));

// ---------------------------------------------------------------------------
// PUT /api/prompts/file/:filename — save prompt to .md file
// ---------------------------------------------------------------------------
app.put('/api/prompts/file/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const { text } = req.body;
    // Map allowed filenames to their actual paths under prompts/.
    // Top-level agents live in prompts/agents/.
    // Structure-generator mode overlays live in prompts/modes/structure-generator/.
    const ALLOWED_PATHS = {
      'agent-chat.md':        'agents/agent-chat.md',
      'agent-builder.md':     'agents/agent-builder.md',
      'agent-interviewer.md': 'agents/agent-interviewer.md',
      // Builder modes
      'modules.md':           'modes/builder/generate/modules.md',
      'modules-features.md':  'modes/builder/generate/modules-features.md',
      'pages.md':             'modes/builder/generate/pages.md',
      'refine.md':            'modes/builder/edit/refine.md',
      'resolve.md':           'modes/builder/edit/resolve.md',
      'diff.md':              'modes/builder/compare/diff.md',
      // Interviewer modes
      'solve-open-points.md': 'modes/interviewer/solve-open-points.md',
      'enrich-context.md':    'modes/interviewer/enrich-context.md',
      // Chat rules
      'intent-override.md':   'modes/chat/rules/intent-override.md',
      'input-detection.md':   'modes/chat/rules/input-detection.md',
      'confidence.md':        'modes/chat/rules/confidence.md',
      'next-actions-tags.md': 'modes/chat/rules/next-actions-tags.md',
      'command-routing.md':   'modes/chat/rules/command-routing.md',
      // Chat templates
      'chat-responses.md':    'modes/chat/templates/chat-responses.md',
      // Chat actions
      'analyze-document.md':  'modes/chat/actions/analyze-document.md',
      'analyze-input.md':     'modes/chat/actions/analyze-input.md',
      'answer.md':            'modes/chat/actions/answer.md',
      'route.md':             'modes/chat/actions/route.md',
      'add-input.md':         'modes/chat/actions/add-input.md',
      'modify-input.md':      'modes/chat/actions/modify-input.md',
      'clarify.md':           'modes/chat/actions/clarify.md',
    };
    if (!ALLOWED_PATHS[filename]) {
      return res.status(400).json({ error: 'Unknown prompt file' });
    }
    const filePath = path.join(__dirname, 'prompts', ALLOWED_PATHS[filename]);
    fs.writeFileSync(filePath, text, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// OpenAI CORS proxy
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
// Kimi (Moonshot AI) CORS proxy
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

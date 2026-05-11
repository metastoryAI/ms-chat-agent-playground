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
      // Top-level standalone agents (flat in /prompts)
      'INTENT_ROUTER_AGENT.md':                       'INTENT_ROUTER_AGENT.md',
      'ANSWER_AGENT.md':                              'ANSWER_AGENT.md',
      'CLARIFY_AGENT.md':                             'CLARIFY_AGENT.md',
      'QUERY_AGENT.md':                               'QUERY_AGENT.md',
      'MUTATION_AGENT.md':                            'MUTATION_AGENT.md',
      // ANALYZE composite
      'ANALYZE_AGENT_PROMPT.md':                      'ANALYZE/ANALYZE_AGENT_PROMPT.md',
      'ANALYZE_RULE_NEXT_ACTIONS_TAGS.md':            'ANALYZE/ANALYZE_RULE_NEXT_ACTIONS_TAGS.md',
      'ANALYZE_RULE_PROJECT_CONTEXT.md':              'ANALYZE/ANALYZE_RULE_PROJECT_CONTEXT.md',
      'ANALYZE_RULE_TARGET_KEYWORDS.md':              'ANALYZE/ANALYZE_RULE_TARGET_KEYWORDS.md',
      'ANALYZE_RULE_POST_INSERT_ROUTING.md':          'ANALYZE/ANALYZE_RULE_POST_INSERT_ROUTING.md',
      'ANALYZE_ACTION_ANALYZE_DOCUMENT.md':           'ANALYZE/ANALYZE_ACTION_ANALYZE_DOCUMENT.md',
      'ANALYZE_ACTION_ANALYZE_INPUT.md':              'ANALYZE/ANALYZE_ACTION_ANALYZE_INPUT.md',
      'ANALYZE_ACTION_ADD_INPUT.md':                  'ANALYZE/ANALYZE_ACTION_ADD_INPUT.md',
      'ANALYZE_ACTION_MODIFY_INPUT.md':               'ANALYZE/ANALYZE_ACTION_MODIFY_INPUT.md',
      'ANALYZE_ACTION_REMOVE_INPUT.md':               'ANALYZE/ANALYZE_ACTION_REMOVE_INPUT.md',
      'ANALYZE_ACTION_EXTRACT_DETAILS.md':            'ANALYZE/ANALYZE_ACTION_EXTRACT_DETAILS.md',
      // BUILDER composite
      'BUILDER_AGENT_PROMPT.md':                      'BUILDER/BUILDER_AGENT_PROMPT.md',
      'BUILDER_RULE_MODULE_NAMING.md':                'BUILDER/BUILDER_RULE_MODULE_NAMING.md',
      'BUILDER_RULE_CONFIDENCE.md':                   'BUILDER/BUILDER_RULE_CONFIDENCE.md',
      'BUILDER_RULE_SUMMARY_STYLE.md':                'BUILDER/BUILDER_RULE_SUMMARY_STYLE.md',
      'BUILDER_RULE_RESOLVED_POINTS.md':              'BUILDER/BUILDER_RULE_RESOLVED_POINTS.md',
      'BUILDER_RULE_GAPS.md':                         'BUILDER/BUILDER_RULE_GAPS.md',
      'BUILDER_RULE_CONTEXT_ENRICHMENT.md':           'BUILDER/BUILDER_RULE_CONTEXT_ENRICHMENT.md',
      'BUILDER_MODE_GENERATE_MODULES.md':             'BUILDER/BUILDER_MODE_GENERATE_MODULES.md',
      'BUILDER_MODE_GENERATE_MODULES_FEATURES.md':    'BUILDER/BUILDER_MODE_GENERATE_MODULES_FEATURES.md',
      'BUILDER_MODE_GENERATE_PAGES.md':               'BUILDER/BUILDER_MODE_GENERATE_PAGES.md',
      'BUILDER_MODE_ADD_FEATURES.md':                 'BUILDER/BUILDER_MODE_ADD_FEATURES.md',
      'BUILDER_MODE_ADD_SUBFEATURES.md':              'BUILDER/BUILDER_MODE_ADD_SUBFEATURES.md',
      'BUILDER_MODE_RESOLVE.md':                      'BUILDER/BUILDER_MODE_RESOLVE.md',
      'BUILDER_MODE_DIFF.md':                         'BUILDER/BUILDER_MODE_DIFF.md',
      // INTERVIEW composite
      'INTERVIEW_AGENT_PROMPT.md':                    'INTERVIEW/INTERVIEW_AGENT_PROMPT.md',
      'INTERVIEW_MODE_SOLVE_OPEN_POINTS.md':          'INTERVIEW/INTERVIEW_MODE_SOLVE_OPEN_POINTS.md',
      'INTERVIEW_MODE_ENRICH_CONTEXT.md':             'INTERVIEW/INTERVIEW_MODE_ENRICH_CONTEXT.md',
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

# ms-chat-agent — Documentation

Playground for the Metastory AI chat agent system. Single-page app + thin Node server, all state in the browser.

---

## 1. Overview

The app is a three-agent LLM system. Every user message goes through **`agent_chat`**, which decides what happens next:

```
user input ─▶ agent_chat ─┬─▶ updates state (documents, inputs, summary)
                          ├─▶ answers directly
                          └─▶ routes to agent_builder / agent_interviewer
```

| Agent | Role |
|---|---|
| `agent_chat` | Entry point. Classifies input, updates state, routes to specialists. |
| `agent_builder` | Generates the app structure (pages, modules, features). |
| `agent_interviewer` | Solves open points, enriches project context. |

Each agent has **modes**. The frontend picks a mode based on what needs to happen (e.g. `generate/modules`, `compare/diff`, `edit/resolve`) and composes the system prompt from `agents/<agent>.md` + the mode sub-prompts.

Four LLM providers supported: **Anthropic**, **OpenAI**, **Gemini**, **Kimi**.

---

## 2. Frontend (`public/`)

Static SPA — no build step. `index.html` loads the JS modules in order.

| File | Lines | Owns |
|---|---|---|
| `js/state.js` | 210 | Global in-memory state (`state`), per-provider copies, `PROVIDER_MODELS` catalog. |
| `js/language.js` | 158 | `project_language` detection and the startup language QA. |
| `js/next-actions.js` | 234 | Renders the next-actions button row attached to assistant messages. |
| `js/prompts.js` | 429 | Prompts modal. Loads `.md` files from `/prompts/*`, composes the system prompt per agent+mode, saves back via `PUT /api/prompts/file/:filename`. |
| `js/ui.js` | 1752 | Sidebars, state panel, debug panel, message rendering primitives. |
| `js/qa.js` | 479 | QA widget — used for resolve-assumptions and language startup. |
| `js/llm.js` | 178 | `callAgent()`, `_callProvider()` per-provider fetch, `parseJSON()`, token tracking. |
| `js/response-handler.js` | 2433 | Dispatch LLM JSON → state mutations + UI (structure card, diff card, message). |
| `js/chat.js` | 458 | Send/receive lifecycle, file attachment handling, `buildPayload()`. |
| `js/provider.js` | 147 | Provider & model selection, per-agent model overrides. |
| `js/sidebar-resize.js` | 63 | Left-nav resize handle. |

### State ownership

All state lives in the `state` object returned by `freshState()` (`state.js`). There is **one state per provider** — switching provider loads that provider's state.

Persistence is `localStorage` for:
- API keys (`ms_api_*`)
- Selected model per provider (`ms_model_*`) and per agent (`ms_agent_model_*_*`)

The project state itself (inputs, summary, context, structure) is **not persisted** — a full reload clears it.

### Request path

```
chat.js:sendMessage()
  → buildPayload(text)                      # chat.js:447
  → callAgent('agent_chat', payload)        # llm.js:137
  → _callProvider(key, userMsg, ...)        # llm.js:46
  → response-handler.js::handleResponse()   # dispatches on `action`
```

---

## 3. Backend (`server.js`)

111 lines. Express. Three jobs only:

| Route | Purpose |
|---|---|
| `GET /` | Serves `public/index.html`. |
| `GET /prompts/*` | Static serve of the `prompts/` directory so the frontend can fetch `.md` files. |
| `PUT /api/prompts/file/:filename` | Writes edited prompt text back to disk. Filename is validated against a whitelist in `ALLOWED_PATHS`. |
| `POST /openai` | CORS proxy to `api.openai.com/v1/chat/completions`. |
| `POST /kimi` | CORS proxy to `api.moonshot.ai/v1/chat/completions`. |

**Anthropic and Gemini are called directly from the browser** (they allow CORS / accept browser access), so the server is not involved in those calls. The API key goes over the wire from the browser.

No auth, no rate limiting, no request logging. This is a playground.

---

## 4. Database (`metastory.db`)

SQLite file committed to the repo. **The schema exists but `server.js` never reads or writes it.** Treat the DB as a parked design, not active infrastructure.

Schema (as-is):

| Table | Purpose (intended) |
|---|---|
| `projects` | `id`, `name`, `created_at` |
| `project_messages` | Chat history — `role`, `content`, `action` |
| `project_documents` | Uploaded docs — `name`, `original_summary`, `source` |
| `project_manual_inputs` | Manually captured `topic` + `detail` |
| `project_free_inputs` | Free-form note summaries |
| `project_summary` | The combined `project_summary` text per project |
| `project_context` | `summary`, `confidence`, `entities` / `covered` / `gaps` (JSON) |
| `project_structure` | `pages` (JSON), `modules` (JSON), `inserted_at` |
| `prompts` | Prompt text keyed by `key` |

If we want persistence, this schema maps cleanly to the current in-memory `state` shape — mostly a serialize-on-change job.

---

## 5. Prompts (`prompts/`)

Prompts are **files on disk**, loaded by the frontend at runtime.

```
prompts/
├── agents/                         # top-level system prompt per agent
│   ├── agent-chat.md
│   ├── agent-builder.md
│   └── agent-interviewer.md
└── modes/
    ├── chat/
    │   ├── actions/                # one file per chat action (analyze-document, route, answer, …)
    │   ├── rules/                  # input-detection, command-routing, project-context, next-actions-tags
    │   └── templates/              # chat-responses.md (shared phrasing scaffolds)
    ├── builder/
    │   ├── generate/               # modules.md, modules-features.md, pages.md
    │   ├── compare/                # diff.md
    │   ├── edit/                   # resolve.md
    │   └── rules/                  # confidence, context-enrichment, module-grouping, gaps
    └── interviewer/
        ├── solve-open-points.md
        └── enrich-context.md
```

### How the system prompt is composed

`prompts.js::getPromptForAgent(agentKey, mode)` builds the system prompt by concatenating:

1. `agents/agent-<name>.md` (always)
2. The mode-specific sub-prompt (if a `mode` is present in the payload)
3. Rule files that always apply for that agent

The composed text is passed as `system` to every provider except Gemini, which takes it as `system_instruction`.

### Editing prompts

The Prompts modal (button in the chat panel) writes edits back through `PUT /api/prompts/file/:filename`. Only filenames in `server.js::ALLOWED_PATHS` are accepted. Changes take effect on the **next** LLM call — no reload needed.

---

## 6. State shape sent to the LLM

`chat.js::buildPayload()` constructs this JSON on every call, then `llm.js::_callProvider()` serializes it as the user message:

```json
{
  "inputs":             [/* { id, source, text|topic|detail, … } */],
  "project_summary":    "combined text of all docs + inputs",
  "project_context":    { "summary", "confidence", "entities", "covered", "gaps" },
  "existing_structure": { "pages": [], "sections": [], "modules": [], "inserted_at": "…" },
  "captured_topics":    [/* topics locked in from first analyze_* */],
  "open_points":        [/* unresolved decisions */],
  "project_notes":      [/* PM / planning items */],
  "user_input":         "what the user typed",
  "project_language":   "en" // or null before the startup QA
}
```

Attached documents are prepended to the user message as `[DOCUMENT: filename]\n\n<text>` blocks (pdf.js extracts text client-side — PDFs are **never** sent as binary).

---

## 7. What we should do next

Prioritized from highest leverage first. Each item is one decision, not a design.

1. **Decide the DB question.** Either wire `server.js` to `metastory.db` so state survives reloads (the schema already matches), or delete the DB file + WAL and stop shipping dead weight. Right now it's neither.
2. **Agent Inspector.** Replace the removed Guide modal with a live panel showing `{agent, mode, prompt files, payload}` for the last N LLM calls. 10-line hook in `llm.js::_callProvider` + a subscriber. This is the single most useful dev tool given how much agent routing the app does.
3. **Lift the frontend API keys out of localStorage.** Anthropic and Gemini run direct-from-browser with the key in plain `localStorage`. Fine for a solo playground, not for anything shared. Move those calls behind a server proxy like `/openai` and `/kimi` already do.
4. **Extract `response-handler.js`.** 2433 lines in one file. Split per action (`analyze-document.js`, `route.js`, `structure.js`, `diff.js`) — it's the hottest file to touch and the hardest to navigate.
5. **Write integration tests for the agent flow.** The prompts evolve constantly; there is no regression safety net. Minimum: a fixture runner that replays canned user inputs through `callAgent` against a mock provider and asserts the state mutations.
6. **`SUMMARY STYLE` coverage.** The sentence-role rule is in the five builder/diff prompts. Port it to the chat `actions/*` and interviewer prompts so summaries are consistent everywhere.
7. **Package the prompts.** Right now the frontend hardcodes which files belong to which agent in `prompts.js`. If we introduce a `prompts/manifest.json` describing `{agent → mode → files[]}`, (2) gets cheaper and the server whitelist in `ALLOWED_PATHS` can be generated from the same source.

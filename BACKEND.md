# Backend Architecture

## Overview

Node.js / Express server (`server.js`) + SQLite database (`metastory.db`).  
All LLM calls are made **server-side** from `llm.js` — the frontend does its own direct LLM calls separately (see note at bottom).

---

## Stack

| Layer | Technology |
|---|---|
| Server | Express (Node.js) |
| Database | SQLite via `better-sqlite3` |
| LLM providers | Anthropic Claude, OpenAI GPT, Google Gemini |
| File | `server.js` → `agents.js` → `llm.js` → `db.js` |

---

## Database Schema (`db.js`)

| Table | Purpose |
|---|---|
| `projects` | id, name, created_at |
| `project_messages` | All chat messages (user + assistant) per project |
| `project_documents` | Uploaded docs with `original_summary` |
| `project_manual_inputs` | Manual text inputs (topic + detail) |
| `project_summary` | Recomputed text from all docs + manual inputs |
| `project_context` | Built context: summary, confidence, entities, covered, gaps |
| `project_structure` | Generated pages + modules (JSON) |
| `prompts` | Agent system prompts stored by key |

---

## API Endpoints (`server.js`)

### `POST /api/projects/:id/chat`
Main chat entry point.

**Request body:**
```json
{
  "user_input": "string",
  "file_base64": "base64 string | null",
  "file_name": "string | null",
  "provider": "claude | openai | gemini",
  "api_key": "string"
}
```

**Flow:**
1. Calls `handleChatAgent(projectId, provider, apiKey, userInput, fileBase64, fileName)`
2. Builds state JSON from DB
3. Calls LLM with Chat Agent prompt
4. Routes result by `action` field
5. Returns result + debug info

---

### `POST /api/projects/:id/agent/route`
Directly trigger a specific agent (bypasses Chat Agent routing).

**Request body:**
```json
{
  "agent": "context_builder | structure_generator",
  "generation_type": "modules | modules_features | full_structure | null",
  "mode": "default | resolve_assumptions | null",
  "include_manual_inputs": true,
  "provider": "string",
  "api_key": "string"
}
```

---

### `POST /api/projects/:id/context/apply`
Apply a context updater diff after user review.

**Request body:**
```json
{ "updated_context": { "summary": "...", "confidence": 85, "entities": [], "covered": [], "gaps": [] } }
```

---

### `GET /api/projects/:id/messages`
Load chat history. Supports cursor-based pagination via `?before=<created_at>&limit=30`.

### `GET /api/projects/:id/state`
Full project state: documents, manual_inputs, project_summary, project_context, existing_structure, has_pending_inputs.

### `GET /api/projects`
List all projects.

### `PUT /api/prompts/file/:filename`
Save a prompt `.md` file to disk. Only allows the 4 known prompt files.

### `POST /openai` / `POST /kimi`
CORS proxies — forward requests to OpenAI / Moonshot AI with the provided API key.

---

## LLM Call Flow (`llm.js`)

### `buildStateJSON(projectId, userInput, fileBase64, fileName)`

Reads from DB and assembles the full state object sent to every LLM:

```json
{
  "documents": [{ "id": "...", "name": "...", "original_summary": "...", "uploaded_at": "..." }],
  "manual_inputs": [{ "id": "...", "topic": "...", "detail": "...", "added_at": "..." }],
  "project_summary": "...",
  "project_context": { "summary": "...", "confidence": 85, "entities": [], "covered": [], "gaps": [], "built_at": "..." },
  "existing_structure": { "pages": [], "modules": [], "inserted_at": "..." },
  "user_input": "...",
  "file_base64": "...",
  "file_name": "..."
}
```

### `callLLM({ provider, apiKey, agentPromptKey, stateJSON, fileBase64, fileName })`

1. Loads system prompt from `prompts` table by `agentPromptKey`
2. Serializes `stateJSON` to string
3. Calls the correct provider function
4. Returns parsed JSON

| Provider | Endpoint | File support |
|---|---|---|
| `claude` | `api.anthropic.com/v1/messages` | PDF as base64 `document` block |
| `openai` | `api.openai.com/v1/chat/completions` | No native file — text only |
| `gemini` | `generativelanguage.googleapis.com/...` | PDF as `inline_data` |

---

## Agent Routing (`agents.js`)

### Chat Agent → `handleChatAgent()`

Receives LLM response and routes by `action`:

| LLM `action` | What backend does |
|---|---|
| `answer` | Saves assistant message, returns `chat_response` |
| `clarify` | Saves assistant message, returns `chat_response` + `next_actions` |
| `analyze_document` | Inserts row into `project_documents`, recomputes `project_summary`, saves message |
| `analyze_input` | Inserts row into `project_documents` (source: `user_input`), recomputes `project_summary`, saves message |
| `add_to_manual_input` | Inserts into `project_manual_inputs`, recomputes `project_summary`, saves message |
| `modify_manual_input` | Updates existing `project_manual_inputs` row, recomputes `project_summary`, saves message |
| `route_to_agent` | Calls `handleRouteToAgent()` → runs the target agent |

### `recomputeProjectSummary(projectId)`

Called after any document or manual input change. Joins all `original_summary` + `detail` values into one `project_summary` text.

---

### Context Builder → `handleContextBuilderOutput()`

| LLM `type` output | What backend does |
|---|---|
| `question` | Returns questions to frontend — no DB write |
| `phase3` | Returns generation options to frontend — no DB write |
| `handoff` | Saves `project_context` to DB → immediately calls Structure Generator |

---

### Structure Generator → `handleStructureGeneratorOutput()`

| LLM `status` output | What backend does |
|---|---|
| `completed` | Upserts `project_structure` (pages + modules as JSON), optionally triggers Chat Agent with `[trigger:generation_completed]` |
| `diff_completed` | Merges `updated_modules` into existing structure row — unchanged modules kept |

If `store_project_context: true` is in the response → also saves `project_context`.

---

### Context Updater → `handleContextUpdaterOutput()`

Returns the `diff[]` array to the frontend for user review. Does **not** write to DB automatically.  
DB write only happens when the frontend calls `POST /api/projects/:id/context/apply`.

---

## LLM Output Shape (what each agent must return)

### Chat Agent
```json
{
  "action": "answer | clarify | analyze_document | analyze_input | add_to_manual_input | modify_manual_input | route_to_agent",
  "chat_response": "string | null",
  "next_actions": { "label": "...", "buttons": [], "groups": [] },
  "document": { "id": "...", "name": "...", "original_summary": "..." },
  "manual_input": { "topic": "...", "detail": "..." },
  "manual_input_modification": { "target_id": "...", "topic": "...", "new_detail": "..." },
  "agent": "context_builder | structure_generator",
  "handoff": { "to_agent": "...", "generation_type": "...", "mode": "..." }
}
```

### Context Builder
```json
{
  "type": "question | phase3 | handoff",
  "questions": [{ "id": "...", "text": "..." }],
  "options": [{ "id": "...", "label": "...", "generation_type": "..." }],
  "project_context": { "summary": "...", "confidence": 80, "entities": [], "covered": [], "gaps": [] },
  "handoff": { "to_agent": "structure_generator", "generation_type": "modules" }
}
```

### Structure Generator
```json
{
  "status": "completed | diff_completed",
  "store_project_context": true,
  "project_context": { "summary": "...", "confidence": 90, "entities": [], "covered": [], "gaps": [] },
  "pages": [{ "id": "...", "name": "...", "summary": "..." }],
  "modules": [{ "id": "...", "name": "...", "summary": "...", "assumptions": [], "features": [] }],
  "confidence": 85,
  "assumption_label": "with assumptions",
  "updated_modules": [],
  "unchanged_count": 3
}
```

### Context Updater
```json
{
  "diff": [
    { "tag": "new | updated | additional | conflict", "module_name": "...", "summary": "...", "before": "...", "after": "...", "existing": "...", "added": "...", "new": "..." }
  ],
  "project_context_updated": { "summary": "...", "confidence": 88, "entities": [], "covered": [], "gaps": [] }
}
```

---

## Note: Frontend vs Backend LLM calls

The frontend (`public/js/llm.js`) makes its **own direct LLM calls** and manages state in `localStorage`. The backend endpoints (`/api/projects/:id/chat` etc.) are a **separate, parallel system** that uses the DB. The two systems currently run independently — the frontend does not call the backend chat/agent endpoints.

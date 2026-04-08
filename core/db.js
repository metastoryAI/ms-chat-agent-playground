const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'metastory.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_messages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    action TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_project ON project_messages(project_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS project_documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    original_summary TEXT,
    source TEXT,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_free_inputs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    summary TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_manual_inputs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    topic TEXT NOT NULL,
    detail TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_summary (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_context (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    summary TEXT,
    confidence REAL,
    entities TEXT, -- JSON
    covered TEXT,  -- JSON
    gaps TEXT,     -- JSON
    built_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_structure (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    pages TEXT,    -- JSON
    modules TEXT,  -- JSON
    inserted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prompts (
    key TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const upsertPrompt = db.prepare(`INSERT OR IGNORE INTO prompts (key, text) VALUES (?, ?)`);

const seedPrompts = db.transaction(() => {
  for (const [key, text] of [
    ['chat_agent_v1.0',          'You are the Chat Agent. Respond in JSON.'],
    ['context_builder_v1.0',     'You are the Context Builder. Respond in JSON.'],
    ['structure_generator_v1.0', 'You are the Structure Generator. Respond in JSON.'],
  ]) {
    upsertPrompt.run(key, text);
  }
});
seedPrompts();

db.prepare(`INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)`).run('default', 'Test Project');

module.exports = db;

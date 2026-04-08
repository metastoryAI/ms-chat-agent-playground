const db = require('./db');

// ---------------------------------------------------------------------------
// Builds the state JSON sent to every LLM call.
// Reads all relevant project data from DB and assembles into a single object.
// ---------------------------------------------------------------------------

function buildStateJSON(projectId, userInput, fileBase64, fileName) {
  const documents = db.prepare(
    'SELECT id, name, original_summary, uploaded_at FROM project_documents WHERE project_id = ? ORDER BY uploaded_at'
  ).all(projectId);

  const freeInputs = db.prepare(
    'SELECT id, summary, added_at FROM project_free_inputs WHERE project_id = ? ORDER BY added_at'
  ).all(projectId);

  const manualInputs = db.prepare(
    'SELECT id, topic, detail, added_at FROM project_manual_inputs WHERE project_id = ? ORDER BY added_at'
  ).all(projectId);

  const summaryRow = db.prepare('SELECT text FROM project_summary WHERE project_id = ?').get(projectId);

  const contextRow = db.prepare(
    'SELECT summary, confidence, entities, covered, gaps, built_at FROM project_context WHERE project_id = ?'
  ).get(projectId);

  const structureRow = db.prepare(
    'SELECT pages, modules, inserted_at FROM project_structure WHERE project_id = ?'
  ).get(projectId);

  const projectContext = contextRow ? {
    summary:    contextRow.summary,
    confidence: contextRow.confidence,
    entities:   JSON.parse(contextRow.entities || '[]'),
    covered:    JSON.parse(contextRow.covered  || '[]'),
    gaps:       JSON.parse(contextRow.gaps     || '[]'),
    built_at:   contextRow.built_at,
  } : null;

  const existingStructure = structureRow ? {
    pages:       JSON.parse(structureRow.pages   || '[]'),
    modules:     JSON.parse(structureRow.modules || '[]'),
    inserted_at: structureRow.inserted_at,
  } : null;

  return {
    documents,
    free_inputs:        freeInputs,
    manual_inputs:      manualInputs,
    project_summary:    summaryRow ? summaryRow.text : '',
    project_context:    projectContext,
    existing_structure: existingStructure,
    user_input:         userInput  || '',
    file_base64:        fileBase64 || null,
    file_name:          fileName   || null,
  };
}

module.exports = { buildStateJSON };

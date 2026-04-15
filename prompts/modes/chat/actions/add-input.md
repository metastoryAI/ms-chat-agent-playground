## ACTION: add_input
Triggered when the user adds new information. Default target is `input`; the user may also explicitly ask to add an open point or a project note.

## OUTPUT
```json
{
  "action": "add_input",
  "target": "input | open_point | project_note",
  "input":    { "topic": "...", "detail": "..." },
  "new_item": { "title": "max 4 words", "summary": "1-2 short sentence" },
  "captured_topics": [{ "title": "max 4 words", "summary": "1-2 short sentence", "status": "new | updated | null" }],
  "project_summary": "1-2 sentences synthesized from ALL inputs including the new input.",
  "project_context": { "confidence": 0, "platform_type": "app | platform | website | api_service", "market_type": "b2c | b2b | internal" },
  "chat_response": { "text": "...", "hint": "..." },
  "next_actions": "[NA:GENERATE|CONFIDENCE:XX]"
}
```

## RULES
- `target` — default `input`. Pick `open_point` or `project_note` when the user's wording points to that list:
  - `open_point` — user says "open point", "offene Frage", "open question", "unresolved decision", "noch offen".
  - `project_note` — user says "project note", "project notes", "note", "Notiz", "Projekt-Notiz", "planning item", "organizational".
  - Both words appear equally likely in EN and DE; detect regardless of language. Never conflate — `project_note` is planning/organizational, `open_point` is a technical/system decision still open.
- When `target: "input"` — populate `input: { topic, detail }`; frontend adds `source: "additional"`, `id`, `added_at` automatically. Omit `new_item`.
- When `target: "open_point"` or `target: "project_note"` — populate `new_item: { title, summary }` only. Leave `input` unset. Do NOT touch `captured_topics`.
- `captured_topics` — only relevant for `target: "input"`. Full growing list, new topic with `status: "new"`, others `null`. Dedup by lowercased `title`.
- `project_summary` — re-synthesize only when `target: "input"`. Otherwise pass through unchanged.
- `project_context.confidence` — must match XX in `next_actions`.
- `chat_response.text` uses Template B opening line: `"**✅ [Title] added.**"`

## ACTION: modify_input
Triggered when the user corrects or updates an existing item in the project context. Can target one of four lists — `target` disambiguates which.

## OUTPUT
```json
{
  "action": "modify_input",
  "target": "input | captured_topic | open_point | project_note",
  "target_title": "exact title/topic of the item being updated",
  "new_title":    "optional — only if the title itself changes",
  "new_summary":  "updated summary text (1-2 short sentence)",
  "input_modification": { "target_id": "...", "topic": "...", "old_detail": "...", "new_detail": "..." },
  "captured_topics": [{ "title": "max 4 words", "summary": "1-2 short sentence", "status": "new | updated | null" }],
  "open_points":    [{ "title": "...", "summary": "..." }],
  "project_notes":  [{ "title": "...", "summary": "..." }],
  "project_summary": "1-2 sentences synthesized from ALL inputs with the modification applied.",
  "project_context": { "confidence": 0, "platform_type": "app | platform | website | api_service", "market_type": "b2c | b2b | internal", "language": "en" },
  "chat_response": { "text": "...", "hint": "..." },
  "next_actions": "[NA:GENERATE|CONFIDENCE:XX]"
}
```

## RULES
- `target` — pick the list the item lives in:
  - `input` — user-added context in `inputs[]`.
  - `captured_topic` — Covered Topics tab entry.
  - `open_point` — keywords: "open point", "offene Frage", "open question", "unresolved decision", "noch offen".
  - `project_note` — keywords: "project note", "project notes", "note", "Notiz", "Projekt-Notiz", "planning item", "organizational".
  Detect in EN and DE equally. If only a title is given, match it case-insensitively against existing list titles to decide.
- `target_title` — REQUIRED. The current title of the item (case-insensitive match).
- `new_title` / `new_summary` — the updated values. Either or both may change. Use this for `target` ≠ `input`.
- `input_modification` — REQUIRED only when `target: "input"` (legacy path — describes how an additional-input entry changes).
- **Always return all four list fields** — frontend uses the returned lists as source of truth for lists other than the targeted one. For the TARGETED list: frontend applies the `new_title` / `new_summary` update by matching `target_title`.
- `captured_topics` — set `status: "updated"` on the changed topic, `null` elsewhere. Only when `target: "captured_topic"` or when a `modify_input` on an `input` also changes its captured topic.
- `project_summary` — re-synthesize only when `target: "input"`. Otherwise pass through unchanged.
- `project_context.confidence` — must match XX in `next_actions`.
- `chat_response.text` uses Template B opening line: `"**✏️ [Title] updated.**"`

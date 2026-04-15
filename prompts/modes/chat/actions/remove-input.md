## ACTION: remove_input
Triggered when the user asks to remove, delete, or exclude an existing item from the project context. Can target one of four lists — `target` disambiguates which.

## OUTPUT
```json
{
  "action": "remove_input",
  "target": "input | captured_topic | open_point | project_note",
  "target_title": "exact title/topic of the item being removed",
  "target_id": "optional — only for target=input when you know the id",
  "captured_topics": [{ "title": "max 4 words", "summary": "1-2 short sentence" }],
  "open_points": [{ "title": "...", "summary": "..." }],
  "project_notes": [{ "title": "...", "summary": "..." }],
  "project_summary": "1-2 sentences synthesized from remaining state.",
  "project_context": { "confidence": 0, "platform_type": "app | platform | website | api_service", "market_type": "b2c | b2b | internal", "language": "en" },
  "chat_response": { "text": "...", "hint": "..." },
  "next_actions": "[NA:GENERATE|CONFIDENCE:XX]"
}
```

## RULES
- `target` — pick the list the item lives in:
  - `input` — user-added context in `inputs[]`.
  - `captured_topic` — an item in the Covered Topics tab.
  - `open_point` — keywords: "open point", "offene Frage", "open question", "unresolved decision", "noch offen".
  - `project_note` — keywords: "project note", "project notes", "note", "Notiz", "Projekt-Notiz", "planning item", "organizational".
  Detect in EN and DE equally. If the user only gives a title, match it (case-insensitively) against existing list titles to decide which list it belongs to.
- `target_title` — REQUIRED. The title/topic string of the item, matched case-insensitively against the correct list.
- `target_id` — optional fallback for `target: "input"` when you know the id.
- **Always return all four list fields** (`captured_topics`, `open_points`, `project_notes`, `inputs` via `project_summary`) — frontend uses the returned lists as the new source of truth for lists other than the targeted one. The TARGETED list's removal is handled frontend-side — do NOT omit the item from the returned list yourself if you're unsure; frontend filters by `target_title`.
- `project_summary` — re-synthesize only when removing an `input`. For `captured_topic` / `open_point` / `project_note`: pass through the existing summary unchanged.
- `project_context.confidence` — re-evaluate only when removing an `input`. Otherwise unchanged. Must match XX in `next_actions`.
- `chat_response.text` uses Template B opening line: `"**🗑️ [Title] removed.**"`

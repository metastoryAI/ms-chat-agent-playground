## ACTION: analyze_input
Triggered when the user types free text describing their project (no file attached).

## OUTPUT
```json
{
  "action": "analyze_input",
  "input": {
    "summary": "2-3 concise sentences. Focus on what is being built or configured. Never start with company name."
  },
  "captured_topics": [{ "title": "max 4 words", "summary": "1 short sentence" }],
  "open_points": [],
  "project_summary": "1-2 sentences synthesized from ALL available inputs including this input.",
  "project_context": { "confidence": 0, "platform_type": "app | platform | website | api_service", "market_type": "b2c | b2b | internal", "language": "en" },
  "chat_response": { "text": "...", "hint": "..." },
  "next_actions": "[NA:GENERATE|CONFIDENCE:XX]"
}
```

## RULES
- `input` — the new text input item. Frontend adds `source`, `id`, `added_at` automatically.
- `captured_topics` — array of objects: `{ "title": "max 4 words", "summary": "1-2 short sentence" }`. Always return the full growing list.
- `project_summary` — synthesized from all available inputs. Frontend stores directly.
- `project_context.confidence` — must match the XX value in `next_actions` tag exactly.
- `chat_response.text` uses Template A opening line (default / switch / keep variants).
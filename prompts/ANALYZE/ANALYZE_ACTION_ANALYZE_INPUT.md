## ACTION: analyze_input
Triggered when the user types free text describing their project (no file attached). Runs **in parallel** with `extract_details` on the same input; merge happens by `inputs[].id`.

## OUTPUT
```json
{
  "status": "ok",
  "chat_response": { "text": "...", "hint": "..." },
  "next_actions": [ "[NA:GENERATE|CONFIDENCE:XX]" ],
  "project_summary": "1-2 sentences synthesized from ALL available inputs including this input.",
  "project_context": { "confidence": 0, "platform_type": "app | platform | website | api_service | marketplace | ecommerce | saas_config | automation", "market_type": "b2c | b2b | internal" },
  "inputs": [
    {
      "name": "",
      "title": "",
      "summary": "2-3 concise sentences. Focus on what is being built or configured. Never start with company name.",
      "type": "",
      "source_date": "",
      "captured_topics": [ { "title": "max 4 words", "summary": "1-2 short sentence" } ],
      "decisions":     [],
      "open_points":   [],
      "project_notes": [],
      "entities":      []
    }
  ]
}
```

If the free text is off-topic / not a project description, emit the discarded envelope instead (see the ENVELOPE rules above).

## RULES
- `status` is `"ok"` for a successful analysis, `"discarded"` if the text is off-topic (then omit all domain slots).
- `next_actions` is an **array** — exactly one `[NA:GENERATE|CONFIDENCE:XX]` tag for this action. Never a bare string.
- `inputs[]` — exactly one entry describing the new text input.
- For `source: "text"` inputs: `name`, `title`, `type`, `source_date` are always empty strings `""`. Only `summary` and `captured_topics` carry content here.
- `inputs[].decisions / open_points / project_notes / entities` — always `[]` here. The parallel `extract_details` call fills them on the same `inputs[].id`.
- `project_summary` — synthesized from all available inputs. Frontend stores directly.
- `project_context.confidence` — must match the XX value in the `next_actions` tag exactly.
- `chat_response.text` uses Template A opening line (default / switch / keep variants).

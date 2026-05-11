## ACTION: add_input
Triggered when the user adds new information. **Every `add_input` creates a new `text` input** in `inputs[]`. The `target` field decides **which nested field** of that new input is populated:
- `target: "input"` → general project info → fills `captured_topics[]`
- `target: "captured_topic"` → user flags a specific topic to capture → fills `captured_topics[]`
- `target: "decision"` → user explicitly records a made decision → fills `decisions[]` (`quote` is `null` because there's no source quote — this is user-explicit)
- `target: "open_point"` → user flags an unresolved decision → fills `open_points[]`
- `target: "project_note"` → user flags a planning/organizational item → fills `project_notes[]`
- `target: "entity"` → user names an entity (person, system, tool, …) → fills `entities[]`

Documents are never created by this action — file uploads route to `analyze_document`.

## OUTPUT
```json
{
  "status": "ok",
  "chat_response": { "text": "...", "hint": "..." },
  "next_actions": [ "[NA:GENERATE|CONFIDENCE:XX]" ],
  "target": "input | captured_topic | decision | open_point | project_note | entity",
  "project_summary": "1-2 sentences synthesized from ALL inputs including the new input.",
  "project_context": { "confidence": 0, "platform_type": "app | platform | website | api_service | marketplace | ecommerce | saas_config | automation", "market_type": "b2c | b2b | internal" },
  "inputs": [
    {
      "name": "",
      "title": "",
      "summary": "1-2 sentences synthesizing what the user just typed. Never copy user_input verbatim.",
      "type": "",
      "source_date": "",
      "captured_topics": [ { "title": "max 4 words", "summary": "1-2 short sentence" } ],
      "decisions":       [ { "title": "max 4 words", "quote": null, "stakeholder": "name or role | null", "rationale": "1-2 short sentence" } ],
      "open_points":     [ { "title": "max 4 words", "summary": "1-2 short sentence" } ],
      "project_notes":   [ { "title": "max 4 words", "summary": "1-2 short sentence", "category": "launch | migration | meeting | follow_up | documentation | training | other" } ],
      "entities":        [ { "name": "...", "type": "person | role | system | tool | product | org | other", "summary": "1 short sentence" } ]
    }
  ]
}
```

If the user's addition is off-topic / not about the project, emit the discarded envelope instead (see the ENVELOPE rules above).

## RULES
- `status` is `"ok"` for a successful addition, `"discarded"` when the text is off-topic.
- `next_actions` is an **array** with exactly one `[NA:GENERATE|CONFIDENCE:XX]` tag. Never a bare string.
- `target` — default `input`. Pick another value based on user wording (see the Target Keyword Dictionary rule).
- `inputs[]` — exactly one new entry. `name`, `title`, `type`, `source_date` are always `""` (text inputs never carry document metadata).
- `inputs[].summary` — short synthesis of what the user typed. Required for every `target`.
- **Per-target population** — exactly ONE nested list is populated with one entry; the other four are `[]`:

| `target` | Populated list | Notes |
|---|---|---|
| `input` | `captured_topics` | Default. General project info. |
| `captured_topic` | `captured_topics` | User explicitly names the topic. |
| `decision` | `decisions` | `quote: null` (user-explicit, no source quote). `stakeholder` and `rationale` may also be null if not provided. |
| `open_point` | `open_points` | Unresolved decision. |
| `project_note` | `project_notes` | `category` is REQUIRED, from: `launch \| migration \| meeting \| follow_up \| documentation \| training \| other`. |
| `entity` | `entities` | `type` REQUIRED from enum: `person \| role \| system \| tool \| product \| org \| other`. |

- `project_summary` — re-synthesize for every `target` (the new input is always part of the corpus).
- `project_context.confidence` — must match XX in `next_actions`.
- `chat_response.text` uses Template B opening line: `"**✅ [Title] added.**"`

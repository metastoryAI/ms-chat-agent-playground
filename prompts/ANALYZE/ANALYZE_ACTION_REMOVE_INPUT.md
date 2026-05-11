## ACTION: remove_input
Triggered when the user asks to remove, delete, or exclude an existing item from the project context. Targets either:
- a `text` input directly (`target: "input"`) — only `source: "text"` is removable here. Removing the input cascades — all nested `captured_topics / decisions / open_points / project_notes / entities` go with it. Document removal happens outside this agent.
- a **derived item nested inside a `text`-source input** (`target: "captured_topic" | "decision" | "open_point" | "project_note" | "entity"`) — backend locates the item by `target_title` across all `inputs[]` **whose `source` is `"text"`** and removes it from its parent input's nested list.

**Document-source data is fully immutable via this agent** — neither the document input itself nor any item nested inside a document-source input can be removed here. To get rid of document-derived data, the user must remove the document via the source list (handled outside this agent).

## OUTPUT
```json
{
  "status": "ok",
  "chat_response": { "text": "...", "hint": "..." },
  "next_actions": [ "[NA:GENERATE|CONFIDENCE:XX]" ],
  "target": "input | captured_topic | decision | open_point | project_note | entity",
  "target_title":    "exact title/name of the item being removed (case-insensitive match)",
  "target_input_id": "optional — pass when you know which input owns the item (or which text input to delete)",
  "project_summary": "1-2 sentences synthesized from remaining state.",
  "project_context": { "confidence": 0, "platform_type": "app | platform | website | api_service | marketplace | ecommerce | saas_config | automation", "market_type": "b2c | b2b | internal" }
}
```

If the user wants to remove a **document** input or any item inside a document-source input, emit:
```json
{
  "status": "discarded",
  "chat_response": { "text": "That item came from a document, which is read-only. To remove document-derived data, remove the document from the source list.", "hint": null }
}
```

If the removal instruction cannot be matched to any existing item, emit the discarded envelope (see the ENVELOPE rules above).

## RULES
- `status` is `"ok"` when the item is identified and removed, `"discarded"` when the target is in a document-source input, has no match, or is off-topic.
- `next_actions` is an **array** with exactly one `[NA:GENERATE|CONFIDENCE:XX]` tag. Never a bare string.
- `target` — pick the list the item lives in. Use the Target Keyword Dictionary rule for disambiguation.
- **Source restriction**: regardless of `target`, the item must live in (or be) an `inputs[]` entry with `source: "text"`. If the matched item is in a `source: "document"` parent, reject with the discarded envelope above.
- `target_title` — REQUIRED. Case-insensitive title match. For `target: "entity"`, match against `name` instead of `title`.
- `target_input_id` — optional. For `target: "input"`: pass the id of the text input being removed when you can identify it. For nested targets: pass when you can scope the lookup to one parent input.
- Do NOT echo `inputs[]` — backend applies the removal in-place by `target_title` (and `target_input_id` if provided), then cascades for `target: "input"`.
- `project_summary` — re-synthesize only when removing a `text` input. For nested targets: pass through the existing summary unchanged.
- `project_context.confidence` — re-evaluate only when removing a `text` input. Otherwise unchanged. Must match XX in `next_actions`.
- `chat_response.text` uses Template B opening line: `"**🗑️ [Title] removed.**"`

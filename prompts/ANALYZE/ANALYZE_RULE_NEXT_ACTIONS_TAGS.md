## NEXT ACTIONS TAGS
`next_actions` is always an **array of tag strings** — never a bare string, never `null`, never a JSON object. Use `[]` when no follow-up is defined for the action.

Each entry inside the array is one tag string in the format below. Most actions emit exactly one tag (array of length 1); when no tag applies, use `[]`.

### Global next_actions state selection

| State | Tag to place inside `next_actions[]` |
|---|---|
| No input yet | `[NA:EMPTY]` |
| Input exists, no existing_structure | `[NA:GENERATE\|CONFIDENCE:XX]` |
| `existing_structure.inserted_at != null` | `[NA:REFINE|CONFIDENCE:XX]` |
| Generate without explicit type | `[NA:GENERATE_TYPE\|DIRECT:XX]` |

`[NA:GENERATE|CONFIDENCE:XX]` — the main CTA after any input. Always shown after `analyze_document`, `analyze_input`, `add_input`, `modify_input`, `remove_input`. The frontend interprets the tag and renders appropriate UI.

### Tag format
```
[NA:TAG_NAME]
[NA:TAG_NAME|PARAM:VALUE]
```

Usage inside the envelope:
```json
"next_actions": [ "[NA:GENERATE|CONFIDENCE:75]" ]
"next_actions": [ "[NA:REFINE|CONFIDENCE:80]" ]
"next_actions": [ "[NA:EMPTY]" ]
"next_actions": []
```

### CONFIDENCE value rules
- Always a single number rounded to nearest 5
- Derived from the confidence estimation rules
- `project_context.confidence` and the XX in the tag must be identical

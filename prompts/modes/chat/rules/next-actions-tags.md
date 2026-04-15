## NEXT ACTIONS TAGS
`next_actions` is always a tag string, never a JSON object. Always included except for `route_to_agent` and `answer` (both always `null`).

### Global next_actions state selection

| State | Tag |
|---|---|
| No input yet | `[NA:EMPTY]` |
| Input exists, no existing_structure | `[NA:GENERATE\|CONFIDENCE:XX]` |
| existing_structure inserted | `[NA:BUILDER_INSERTED]` |
| Project conflict | `[NA:CONFLICT]` |
| Document selection (multi-project upload) | `[NA:DOC_SELECT]` |
| Generate without explicit type | `[NA:BUILDER_TYPE\|DIRECT:XX]` |

`[NA:GENERATE|CONFIDENCE:XX]` — the main CTA after any input. Always shown after `analyze_document`, `analyze_input`, `add_input`, `modify_input`, `remove_input`. The frontend interprets the tag and renders appropriate UI.

### Tag format
```
[NA:TAG_NAME]
[NA:TAG_NAME|PARAM:VALUE]
```

### CONFIDENCE value rules
- Always a single number rounded to nearest 5
- Derived from the confidence estimation rules
- `project_context.confidence` and the XX in the tag must be identical
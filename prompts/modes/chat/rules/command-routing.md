## COMMAND ROUTING

```
Generate command WITH explicit type:
  → route_to_agent: agent_builder
  → generation_type: modules | modules_features
  → pass project_summary + project_context (null if not built) + existing_structure

Generate command WITHOUT explicit type:
  → clarify → [NA:BUILDER_TYPE|DIRECT:XX]

"keep_existing_project":
  → inputs[] has text entries → analyze_input (keep opening)
  → inputs[] has document entries → analyze_document
  → next_actions: [NA:GENERATE|CONFIDENCE:XX]

"switch_to_new_project":
  → file present → analyze_document (switch opening)
  → no file → analyze_input (switch opening)

New doc uploaded:
  → always analyze_document first
  → next_actions: [NA:GENERATE|CONFIDENCE:XX]
```
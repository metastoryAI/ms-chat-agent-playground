## ACTION: route_to_agent
Hand off to a specialist agent. Used when the user issues an explicit generate command with enough context.

## OUTPUT
```json
{
  "action": "route_to_agent",
  "agent": "agent_builder",
  "handoff": {
    "to_agent": "agent_builder",
    "generation_type": "...",
    "project_summary": "...",
    "project_context": null,
    "existing_structure": null
  },
  "chat_response": { "text": null, "hint": null },
  "next_actions": null
}
```

## RULES
- `next_actions` is always `null` for route_to_agent.
- `chat_response.text` and `chat_response.hint` are both `null` — the target agent produces the user-visible output.
- `generation_type` must be one of: `modules` | `modules_features`
- Always pass `project_summary`, `project_context` (nullable), and `existing_structure` (nullable) in the handoff.
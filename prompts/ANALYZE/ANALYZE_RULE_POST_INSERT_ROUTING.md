## POST-INSERT ROUTING
Loaded by `agent-analyze` only when `existing_structure` is present. Governs how user input is interpreted relative to whether the builder's output has been inserted into the live project tree.

The runtime loads this file when `existing_structure != null`. Ignore it otherwise.

**Inserted state check:** `existing_structure.inserted_at` is the ISO-8601 timestamp set by the backend when the structure is committed. `inserted_at == null` (or absent) means the builder card is still in preview; `inserted_at != null` means the structure is live.

### Card preview (`inserted_at == null`) — not yet inserted
The builder produced a structure that is previewed in a card but not committed to the project. User feedback in this state:

- User asks to **modify the builder output** ("rename this module", "combine these features") → intent-router classifies as `builder` with `variant_key: resolve` or `diff`; orchestrator routes to `agent-builder`. `agent-analyze` does NOT handle modifications to the card.
- User asks a **question about the builder output** ("why is Auth a module?", "what's in Payments?") → intent-router classifies as `answer`; orchestrator routes to `agent-answer`. `agent-analyze` does NOT emit `answer`.
- User adds **new project info** unrelated to the card → emit `add_input` as usual.

### Live structure (`inserted_at != null`) — inserted into the project
The structure is now live.

- User issues a new **generate command** → intent-router routes directly to `agent-builder`; `agent-analyze` does NOT emit a handoff.
- User adds **new project info** → emit `add_input` as usual.
- User asks a **question about the inserted structure** → intent-router classifies as `query` or `answer`; `agent-analyze` does not handle it.

### Next actions tag
When `existing_structure.inserted_at != null` and no new action is being performed, the envelope emits:

```json
"next_actions": [ "[NA:REFINE|CONFIDENCE:XX]" ]
```

Otherwise use the standard tag rules from the NEXT ACTIONS TAGS rule. Remember: `next_actions` is always an array, never a bare string.

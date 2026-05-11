## PROJECT CONTEXT ENRICHMENT
When `mode` is `generate_modules` or `generate_modules_features`, return the **full** `project_context` object alongside the structure. This is a byproduct of the input analysis — NOT an extra task and NOT a change to strict generation.

`mode: resolve` uses a different convention — it emits a **partial** `project_context` containing only the updated `confidence` number; the frontend merges it over the existing context. `mode: diff` and `mode: generate_pages` do not emit `project_context` at all.

```json
"project_context": {
"confidence": 0,
"entities": [],
"covered": [],
"covered_concepts": [],
"gaps": [],
"built_at": "auto"
}
```

- `confidence` — pass through `project_context.confidence` from input exactly as-is. The Builder does NOT change confidence — it only generates structure. Confidence is updated only by `agent-analyze` when new input is added or by Enrich Context.
- `entities` — only **named, proper-noun entities** explicitly in the input: third-party tool names, technology stack names, company names, API names, product names. Generic descriptors like "Mobile App", "Passengers", "Drivers" are NOT entities. If the input contains no named entities, return `entities: []`.
- `covered` — topic_ids from the GAPS rule (based on `platform_type`) that the input describes functionally — not just mentions. Naming "passengers and drivers" does NOT cover `user_roles`; describing role permissions, access levels, or separate flows does. Used internally for gap matching — always emit the raw ids.
- `covered_concepts` — 2–4 word labels describing **what aspects of the project are understood**. Free-form, project-specific, NOT from the taxonomy. 3–8 entries. **Every entry MUST be in Title Case** (e.g. "App Concept", "Matching Logic" — not "app concept" or "APP CONCEPT").
- `gaps` — topic_ids from the GAPS rule NOT addressed by the input. Only include topic_ids that exist in the matching platform_type list.
- `built_at` — always set to `"auto"` (frontend replaces with timestamp)

`covered` + `gaps` together should account for all relevant topic_ids for the `platform_type`. Never mark a topic as covered if the input does not mention it. Modules are still generated only from what is explicitly in the input — context enrichment is observational.

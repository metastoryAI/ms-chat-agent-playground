## CONFIDENCE
- Always return `project_context.confidence` from input unchanged
- The Builder never raises or lowers confidence — it only generates structure
- Confidence is owned by `agent-analyze` (on new input) and Enrich Context (on scope expansion)
- **Exception: `resolve` mode** — when open points are confirmed, confidence increases. Scoring rules defined in the resolve mode prompt.

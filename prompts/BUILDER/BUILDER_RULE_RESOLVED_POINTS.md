## RESOLVED POINTS

`resolved_points[]` are decisions the user has explicitly confirmed (e.g. via the interview or builder card).

- Apply BEFORE generating or updating modules
- Incorporate each resolved point into the relevant module's `summary`
- The confirmed value must appear in the summary sentence
- NEVER add them as `open_points[]` — they are confirmed, not open
- NEVER leave a resolved point unmentioned in the output

### Priority over `inputs[*].decisions`

`resolved_points[]` (user-explicit) and `inputs[*].decisions` (extracted from source by `extract_details`) can both describe a made decision. When both refer to the same topic and disagree:

- **`resolved_points` wins** — user-explicit confirmation overrides source-extracted decisions.
- The source-extracted `decisions` entry is silently dropped from the summary.
- This applies whenever wording, value, or implication conflicts. When they agree (just rephrased), use the resolved-point wording in the summary.

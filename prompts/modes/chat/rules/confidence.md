## CONFIDENCE ESTIMATION
After every action that produces `project_context`, estimate a confidence score based on available input quality. This is a lightweight internal estimate — no Q&A, no discovery.

| Input quality | Estimated confidence |
|---|---|
| Single vague sentence (5 words or less) | 5–10% |
| Single sentence, basic idea | 10–15% |
| Single sentence with some context | 15–20% |
| Short paragraph (2–4 lines) | 20–30% |
| Detailed description or short doc | 30–50% |
| Full spec or transcript | 50–70% |
| Multiple detailed docs | 65–85% |

**CRITICAL: "I want to create a [X] app" = single sentence, basic idea → 10–15% max.**

For `add_input`, `modify_input`, `remove_input`: re-evaluate confidence based on the total accumulated input after the change — do not just carry forward the previous value.

Always round to nearest 5. The value in `project_context.confidence` must match XX in `[NA:GENERATE|CONFIDENCE:XX]` exactly.
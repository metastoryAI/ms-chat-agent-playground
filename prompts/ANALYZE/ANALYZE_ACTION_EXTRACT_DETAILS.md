## ACTION: extract_details

Runs **in parallel** to `analyze_document` / `analyze_input` on the same input(s). Mines each input for four nested derived lists: `decisions`, `open_points`, `project_notes`, `entities`. Writes back **per `inputs[].id`** — backend merges with the analyze call without racing on top-level lists.

This action does **not** touch `name`, `title`, `summary`, `type`, `source_date`, or `captured_topics` — those belong to the analyze call.

## CRITICAL CONSTRAINTS

These rules override all other classification logic. Apply them BEFORE the bucket rules below.

1. **Launch/rollout/go-live strategy** → ALWAYS `project_notes`, NEVER `open_points`. This includes phased rollout, big-bang vs. gradual, pilot strategy, go-live timing.
2. **Meeting scheduling and attendees** → ALWAYS `project_notes`, NEVER `open_points`.
3. **Current operational practice** — pure descriptive narration of an existing workflow → fact (skip) or `captured_topics`. BUT if the source explicitly confirms the current practice as the chosen path forward AND a specific alternative is raised and rejected (or implied as rejected) in the same exchange → that IS a `decision`. Without a stated/implied rejected alternative → fact (skip). The rejected-alternative test distinguishes a real choice from background description.
4. **Proposal without acceptance** → `open_points` (if technical) or `captured_topics` (if just discussed), NEVER `decisions`. See STEP 3 for what counts as acceptance.
5. **Compliance / data-privacy / anonymization requirements** that affect the data model or feature design → `open_points` (Builder needs to know), NOT `project_notes`.
6. **NO DUPLICATES across buckets** — every item belongs to exactly ONE bucket. Before finalizing, scan your output: if the same topic appears in two buckets (e.g. `open_points` AND `project_notes`), REMOVE it from the bucket that violates the CRITICAL constraints above and keep it only where it belongs. The first 5 constraints win — never let the same topic live in two places "to be safe".

## THE FOUR BUCKETS

- **FACT** → skip entirely. Confirmed system behavior with no uncertainty and no pending action. Belongs in module summaries, not here. Example: *"System saves X in CRM."*
- **`decisions`** → choices already made with a clear preference recorded in the source. Example: *"We will use OAuth, not session tokens."*
- **`open_points`** → anything that BLOCKS module/feature design — undecided technical/system choices OR required deliveries the Builder needs to model the structure. Example: data model, integration approach, threshold values, missing schema/sample data.
- **`project_notes`** → planning/organizational items that do NOT block requirements design — meetings, attendees, scheduling, status updates, strategy/launch, post-launch documentation (categorized — see PROJECT NOTE CATEGORIES below).
- **`entities`** → named entities in the source: people, roles, systems, tools, products, organizations.

## STEP 1 — IS IT OPEN?

An item is OPEN if it BLOCKS development of modules or features. Two patterns qualify as `open_points`:

1. **Undecided technical/system choice** — data model, integration approach, matching logic, threshold values, integration scope, configuration value, implementation method.
2. **Required input the Builder needs to design the structure** — file/template/schema/sample-data delivery from a stakeholder, unspecified data formats, missing source examples that the Builder needs to model fields or features.

**Everything else** that is "pending" but does NOT block requirements design — meetings, attendees, scheduling, status updates, strategy/launch decisions, post-launch documentation, reference material — is `project_notes`, NOT `open_points`.

If it describes confirmed system behavior with no pending human action → check if it's a `decision` (made choice with rationale) or a `fact` (skip).

## STEP 2 — WHICH BUCKET?

| Question | Bucket |
|---|---|
| Is this an undecided technical/system choice the Builder needs to design modules/features? | `open_points` |
| Is this a required delivery (file, template, schema, sample, source data) the Builder needs to model the structure? | `open_points` |
| Is this a meeting / attendee / scheduling item? | `project_notes` |
| Is this a follow-up that doesn't block module/feature design (status update, reference material, post-launch doc)? | `project_notes` |
| Is this a strategy / rollout / launch / go-live decision? | `project_notes` |

**Hard rules (no exceptions):**
- Launch/rollout/go-live strategy → ALWAYS `project_notes`, never `open_points`. Includes go-live timing, phased rollout, pilot strategy.
- Meeting scheduling and attendees → ALWAYS `project_notes`.
- Document/data delivery → ANY of {schema, sample data, format examples, lists of entities/items to model, Excel/Word templates being migrated, dashboard field specs, integration source examples} → ALWAYS `open_points` (Builder needs the structure). ONLY when the delivery is reference material with no impact on the design (meeting summaries, status reports, post-launch docs, organizational handoff) → `project_notes`. When in doubt: if the Builder would need to read it to model fields/features → `open_points`.

## STEP 3 — DECISIONS

A `decision` requires:
- A clear choice was made and **explicitly accepted** (not just suggested, proposed, or considered)
- The choice is grounded in the source — quote the supporting line in `quote`
- Optional: who made/owns it (`stakeholder`) and why (`rationale`)

**Field semantics for a `decision` entry:**

| Field | What goes in |
|---|---|
| `title` | The decision itself in 4 words max — what was chosen |
| `quote` | Verbatim line from the source that records the choice (or `null` if user-added via `add_input`) |
| `stakeholder` | Who made or owns this decision (name or role) — `null` if not identifiable |
| `rationale` | The **WHY** behind the decision in 1-2 short sentences — the reasoning that justifies it: a constraint, a stakeholder concern, a trade-off, or a context that makes this choice the right one. NOT a paraphrase of the decision itself, NOT a description of what was decided — answer "why this choice and not the alternative?" |

**Proposal markers (NEVER decisions — route to `open_points` if technical, or `captured_topics` if just discussed):**
Verbs/phrases that indicate a SUGGESTION or CONSIDERATION, not a commitment — e.g. *"suggested"*, *"proposed"*, *"could"*, *"might"*, *"let's consider"*, *"to be reviewed"*, *"we should consider"*, *"concluded"*, *"observed"*, *"stated"*. Recognize equivalents in any language — the **concept** matters, not the exact word.

**Acceptance markers (REQUIRED for a decision) — recognize multiple forms:**

1. **EXPLICIT verbal acceptance** — direct agreement/confirmation words.
2. **COLLECTIVE acceptance** — the source records that participants/group settled on or agreed on the choice.
3. **MUTUAL confirmation** — one party proposes; another party expands on or refines the proposal as if it were the chosen path (no objection raised, conversation moves forward as if decided).
4. **STAKEHOLDER declaration** — a stakeholder with decision authority states the choice as the path forward AND no objection is raised in the same exchange. The conversation moves on as if the choice is settled (subsequent exchanges treat it as given).
5. **RECORDED outcome** — listed as a decided next step in a meeting summary, action list, or recap section.
6. **CONTINUATION TEST** — after a stakeholder states a choice or architectural call, the conversation immediately moves into implementation details, consequences, or next steps based on that choice (no one questions or objects, no alternative is re-opened). The continuation IS the acceptance — even without an explicit "OK" word.

Recognize equivalents in any language — the **concept of commitment** matters, not the exact word or phrasing.

**Pattern:** A proposal becomes a decision ONLY when one of the acceptance forms above follows. Without acceptance: `open_points` (if technical) or `captured_topics` (if just a topic discussed).

If the source only lists alternatives without picking one → `open_points`, not `decisions`.
If the source describes existing system behavior with no implication of choice → fact (skip).
If the source describes current operational practice as pure background → fact (skip). But if it is explicitly confirmed as the chosen path forward (vs. alternatives raised in the same exchange) → `decision` (per CRITICAL #3).

**Active scanning approach — read the source TWICE:**
- **First pass:** identify all stakeholder statements about HOW something will work — architecture, format, process, ownership, technical approach.
- **Second pass:** for each statement, check if the conversation accepted it via any of the 6 acceptance forms above. If yes → `decision`. If no → `open_points` or `captured_topics`.

Do NOT default to `open_points` when uncertain — apply the acceptance forms first. Many decisions in discovery meetings are architectural calls from the implementer that the customer accepted by not objecting and moving on with implementation details (Form 6: CONTINUATION).

**Volume self-check:** A typical discovery / kickoff / requirements meeting yields **5–10 decisions**. If you found 5 or fewer, you almost certainly missed continuation-acceptances and stakeholder declarations. Do a **third pass** focused specifically on:
- **Form 4 (STAKEHOLDER declaration)** — every architectural call from a stakeholder where no objection was raised
- **Form 6 (CONTINUATION TEST)** — every choice followed by implementation-detail discussion (the conversation moving on IS the acceptance)

Do not stop at 5 — push to find the missed Form 4 / Form 6 cases. Stop only when no further unobjected stakeholder calls remain in the source.

## STEP 4 — ENTITIES

Extract every distinct named entity that appears in the source. `type` is from a closed enum:

| type | Matches |
|---|---|
| `person` | Named individual (a specific person mentioned by name) |
| `role` | Job title or function — see GENERIC ROLE FILTER below |
| `product` | Software/SaaS being **built, configured, or implemented** as part of THIS project's scope. The deliverable. |
| `system` | A **pre-existing** software/database/platform that the project integrates with, migrates from, or replaces — NOT being built. |
| `tool` | Software/service the team uses for **daily operations** (communication, file sharing, productivity) — neither in build scope nor a system being integrated. |
| `org` | Company, department, or team referenced by name |
| `other` | Does not clearly fit any category above — use sparingly |

Same entity referenced multiple times → one entry. Use the most descriptive form as `name`.

**Multi-instance rule:** When several distinct named tools/services serve the same function (e.g. multiple messaging platforms, multiple file-storage services, multiple analytics products used in parallel), include EACH as a SEPARATE entity. Do NOT collapse them into a generic group entry. Each named instance is its own entity.

### PRODUCT vs SYSTEM vs TOOL — decision order

Apply top to bottom — first match wins:

1. Is this being **built, configured, or implemented** in THIS project? → `product`
2. Does this **already exist** and the project integrates with / migrates from / replaces it? → `system`
   *(Applies regardless of how generic the tool appears — what matters is its role in this project's scope, not the tool's general nature. If the source describes the tool being phased out, replaced, migrated away from, or used as a legacy data store, it is `system`, not `tool`.)*
3. Does the team just **use this for daily work**, untouched by the build? → `tool`

Examples to disambiguate:

| Item | Project context | Type |
|---|---|---|
| `<CRM SaaS X>` | Project sets up X for the customer | `product` |
| `<CRM SaaS X>` | Project builds a connector to existing X | `system` |
| `<spreadsheet tool>` | Replaced by the new system | `system` |
| `<spreadsheet tool>` | Stays in use as side reporting tool | `tool` |
| `<chat platform>` | Team uses for internal communication | `tool` |
| `<chat platform>` | Project builds a bot inside the platform | `tool` (the platform) **and** `product` (the bot, as a separate entity) |

### GENERIC ROLE FILTER

**Skip generic domain roles** inherent to the project type — these are not distinguishing entities, just domain actors any project of this type would have.

Examples to skip:
- `<patient>` in a healthcare project
- `<customer>` in an e-commerce project
- `<user>` in any product
- `<driver>` in a mobility project

Include a `role`-typed entity ONLY when:
- Tied to a specific named person (e.g. "<Person> (accountant)")
- A distinguishing operational/team function being modeled (e.g. an internal coordinator role specific to how this team operates)

Generic role nouns belong in `captured_topics` (as discussion themes) or in feature descriptions — not in `entities`.

## PROJECT NOTE CATEGORIES

Every `project_notes` entry MUST include a `category` field. Pick the best fit from this closed enum:

| category | Matches |
|---|---|
| `launch` | Rollout strategy, go-live timing, phased release, pilot, launch plan |
| `migration` | Data migration, legacy system cutover, export/import of existing records |
| `meeting` | Scheduled sync-up, alignment session, review meeting, retrospective |
| `follow_up` | Pending action waiting on someone, unreturned response, external dependency |
| `documentation` | Docs/guides/templates to be written, deliverables to prepare |
| `training` | User or team training plans, onboarding sessions, enablement |
| `other` | Does not clearly fit any category above |

Use `other` sparingly — prefer a specific category when possible.

## WHAT TO ACTIVELY SCAN FOR

Patterns that often indicate `open_points` (even without explicit markers):

- **Alternatives stated without a choice** — "X or Y", "manual or automated", "approach A, B, or C"
- **Integration scope ambiguity** — multiple channels/tools listed without clarifying which are actually supported
- **Matching/linking logic** — how records connect, how payments match, entity resolution
- **Manual/automation boundaries** — "for now manual, later automated"
- **Hedging or placeholder markers** — "possibly", "maybe", "XXX", "[value]"

## RULES

- Preserve exact numbers, names, and terms from the document.
- Never put the same item in more than one bucket.
- When in doubt whether an item is a fact or a pending activity — if it names an action that must happen (delivery, migration, testing), classify per STEP 2: `open_points` if the Builder needs it to design modules/features, otherwise `project_notes`. If it describes system behavior, it's a fact (skip).
- Duplicates **across** inputs are allowed (same entity in two documents = two entries, one per input). Within a single input, dedup by lowercased `title` / `name`.
- **All `title` fields** (in `decisions`, `open_points`, `project_notes`) and `name` fields (in `entities`) MUST start with a **capital letter**. Follow the language's standard capitalization conventions for the rest (German nouns capitalized, English minor words lowercase). Never emit titles in all-lowercase like *"matching manuell abwickeln"* — write *"Matching manuell abwickeln"*.

## LANGUAGE

- **Default**: respond in the language of `user_input`. If `user_input` is empty (e.g. doc-only upload), fall back to the document's language. Never mix languages mid-output.
- **Exception — `quote`**: ALWAYS verbatim from the source. Never translate. The quote stays in whatever language the document is in, even if the rest of the output is in `user_input` language.
- **Exception — enum keys** (`category`, `type`): ALWAYS lowercase English (`launch`, `migration`, `person`, `tool`, …) regardless of any other language.

## OUTPUT

```json
{
  "status": "ok",
  "chat_response": { "text": "", "hint": null },
  "next_actions": [],
  "inputs": [
    {
      "id": "<input id from the input payload>",
      "decisions": [
        { "title": "max 4 words — what was chosen", "quote": "exact source quote", "stakeholder": "name or role | null", "rationale": "1-2 short sentences — the WHY behind the choice (reasoning/justification, not a paraphrase of the decision)" }
      ],
      "open_points": [
        { "title": "max 4 words", "summary": "1-2 short sentences" }
      ],
      "project_notes": [
        { "title": "max 4 words", "summary": "1-2 short sentences", "category": "launch" }
      ],
      "entities": [
        { "name": "...", "type": "person | role | system | tool | product | org | other", "summary": "1 short sentence" }
      ]
    }
  ]
}
```

- `status` is always `"ok"`. If an input has no extractable items, emit the input entry with all four lists as `[]`.
- `chat_response` is always `{ "text": "", "hint": null }` — this action does not speak to the user directly. The message comes from the parallel `analyze_document` / `analyze_input` call.
- `next_actions` is always `[]`. This action does not trigger further chaining.
- `inputs[].id` — REQUIRED. Must match the id of the input being analyzed. Backend merges by this id.
- Do NOT emit `name`, `title`, `summary`, `type`, `source_date`, `captured_topics` — those are owned by `analyze_document` / `analyze_input`. Backend ignores them if present.
- Do NOT emit `project_summary` or `project_context` — those belong to the parallel analyze call.

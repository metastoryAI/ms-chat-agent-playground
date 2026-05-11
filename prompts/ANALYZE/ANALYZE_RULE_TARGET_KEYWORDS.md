## TARGET KEYWORD DICTIONARY

When disambiguating the `target` field in `add_input`, `modify_input`, and `remove_input` actions, use these keywords to detect which list the user means. Match the **concept**, not the exact string — the LLM is multilingual and should recognize equivalent phrases in any user language.

### `captured_topic`
User mentions: "topic", "covered topic", "captured topic", or names a specific topic from the project ("the login topic", "the auth area").

### `decision`
User mentions: "decision", "decided", "we'll use X", "chose", "confirmed choice", "ruling".

### `open_point`
User mentions: "open point", "open question", "unresolved decision", "still open", "not decided yet", "TBD".

### `project_note`
User mentions: "project note", "note", "planning item", "organizational", "to-do", "follow-up item".

### `entity`
User mentions an entity by name in a managing way (e.g. "rename `<entity>`", "remove `<entity>` from the entities", "add `<entity>` as an entity"). When the user just mentions the entity in passing while describing something else, treat as `input` instead.

### `input`
Default when none of the above match — the user is contributing general context. Also when the user explicitly references a `text` input by name (e.g. "remove that note I added yesterday").

### Disambiguation rule
Never conflate — keep boundaries clean:
- `decision` = made choice (with rationale)
- `open_point` = technical/system decision still open
- `project_note` = planning/organizational item, has a `category`
- `entity` = a named person/system/tool/product/org
- `captured_topic` = a topic/area name in the project context
- `input` = the parent text input itself

### Title matching when no keyword is given
If the user provides only a title/name (no list keyword), match it case-insensitively against existing titles in:
1. `inputs[].title` of `text` inputs themselves
2. `inputs[*].captured_topics[].title`
3. `inputs[*].decisions[].title`
4. `inputs[*].open_points[].title`
5. `inputs[*].project_notes[].title`
6. `inputs[*].entities[].name`

Decide which list (and which parent input) the title belongs to. When a match is found, set `target_input_id` to the parent input's id so backend can scope the operation.

### Source restriction (modify/remove only)
For `modify_input` and `remove_input`, only items inside `inputs[]` entries with `source: "text"` are eligible. If the title-matched item lives in a `source: "document"` input, reject with the discarded envelope (see the action file). `add_input` always creates a new `text` input and is never blocked by this restriction.

## MODULE NAMING

### Conventions
- Max 3 words, Title Case
- No role names as module name ("Passenger", "Driver")
- No suffixes ("Module", "System", "Service", "Manager")
- Prefer nouns over verbs ("Authentication" not "Manage Auth")

### Canonical names — naming standard only, NOT a module suggestion list

This list is a **naming convention**, not a shopping list. It does **not** authorize you to add any of these modules. A module only exists if the input explicitly justifies it. **Only after** you have decided — based strictly on the input — that a module of a given function is needed, use the exact name from this list if one applies:

`Authentication` · `User Profile` · `Notifications` · `Dashboard` · `Settings` · `Payments` · `Reporting` · `Admin Panel` · `Onboarding` · `Search` · `Analytics` · `File Management` · `Integrations` · `Billing`

**Critical:** Never scan this list looking for modules to add. The direction is one-way: input → module decision → name lookup. Never: list → "does this fit?" → add.

**Do NOT auto-add** any of these modules unless the input explicitly describes their functionality:

| Module | Requires the input to explicitly mention |
|---|---|
| `Authentication` | login, sign-up, password, account creation |
| `User Profile` | user profile, bio, avatar, profile page |
| `Notifications` | notify, alerts, email/push notifications |
| `Dashboard` | home screen, overview, dashboard |
| `Settings` | preferences, configuration, user settings |
| `Onboarding` | welcome flow, first-time user experience |
| `Search` | search, find, filter |
| `Admin Panel` | admin, back-office, moderation |

These are the most commonly hallucinated modules. If you add one of them without a supporting phrase from the input, you have violated the strict rule.

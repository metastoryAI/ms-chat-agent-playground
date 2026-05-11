## PROJECT CONTEXT

`agent-analyze` sets `project_context.confidence`, `project_context.platform_type`, and `project_context.market_type` on every action that includes `project_context`. This file defines how each value is determined.

## CONFIDENCE ESTIMATION
After every action that produces `project_context`, `agent-analyze` estimates a confidence score based on available input quality. This is a lightweight internal estimate — no Q&A, no discovery.

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

## PLATFORM_TYPE SELECTION

Select based on what the project fundamentally is:

- `app` — building a new application from scratch (mobile app, web app, desktop app)
- `platform` — building a multi-user platform or portal from scratch
- `website` — building a website, landing page, or content site
- `api_service` — building an API, backend service, or microservice
- `marketplace` — building a two-sided marketplace (buyers + sellers)
- `ecommerce` — building an online shop or storefront
- `saas_config` — configuring/customizing an existing third-party SaaS tool (CRM, ITSM, project management, helpdesk, etc.). Keywords: setup, configuration, implementation, migration, workflows on existing platform.
- `automation` — building workflow automations on an automation platform (workflow builders, low-code triggers/actions, scripting in an existing tool's automation engine)

When in doubt between `app` and `saas_config`: if the input mentions an existing third-party SaaS product by name as the platform being configured, it is `saas_config`.

## MARKET_TYPE SELECTION

Select based on who the end users are:

- `b2c` — consumers / general public (ride-hailing, food delivery, social apps, e-commerce for consumers)
- `b2b` — businesses / other companies as customers (CRM, sales tools, B2B SaaS, agency tools)
- `internal` — company's own employees / internal use only (internal dashboards, team tools, operations)

When in doubt: if the project is paid for by businesses and used by businesses → `b2b`. If used only by the building company's own staff → `internal`.

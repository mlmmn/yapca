# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Extract generic helpers to src/lib, don't duplicate them in components

- **Context**: Entire codebase under `src` — any module (components, actions, pages) that needs a small utility function.
- **Problem**: Duplicated helpers — generic, state-free helper functions (date formatting, browser feature checks, etc.) get copy-pasted into multiple components instead of being shared, causing drift and duplicate bugfixes. E.g. `todayLocalDateString()` was independently defined in both `today-list.tsx` and `add-plant-form.tsx`.
- **Rule**: When writing a helper function, check whether it is generic (no dependency on the enclosing component's state/props/closures) — if so, place it in `src/lib/` (grouped by concern, e.g. `date.ts`, `utils.ts`) instead of defining it locally, even on first use.
- **Applies to**: implement, impl-review

## Keep local seed data aligned with the database shape

- **Context**: Supabase local development, migrations, seed files.
- **Problem**: An outdated or missing local seed impairs developer experience after migrations reset the database.
- **Rule**: Ensure the local seed is kept up to date with migrations and the database shape. Never apply local seed data to production.
- **Applies to**: plan, plan-review, implement, impl-review

## Always verify command status codes

- **Context**: Entire codebase
- **Problem**: Automated checks, including CI, can fail even when command output appears successful if the command’s non-zero exit status is overlooked.
- **Rule**: Always check the command’s status code and treat any non-zero result as an error.
- **Applies to**: implement, impl-review

## Name test describe blocks after the function under test, not the module

- **Context**: Unit tests for utility/helper modules under `src`. Not component tests.
- **Problem**: A top-level `describe` named after the module repeats what the filename already says: it adds a level to every reporter line and every failure name while discriminating nothing. In a file covering several exports it also flattens distinct functions into one undifferentiated list of `it`s.
- **Rule**: Name `describe` blocks after the function under test. A file covering several exports has several **sibling top-level** `describe`s — one per function — and no module-level wrapper around them. Reserve nesting for grouping cases *within* one function, never for the module.
- **Applies to**: plan, plan-review, implement, impl-review

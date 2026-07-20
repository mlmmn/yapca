# Plant Detail and Watering Journal Design Brief

## 1. Feature Summary

This is a production-ready responsive flow that lets a signed-in plant owner browse their entire collection, open a plant, and inspect its exact watering history. It extends YAPCA's trusted daily loop without adding editing, watering actions, notes, or decorative plant metadata.

The feature spans navigation from Today, the All Plants collection, the plant detail page, and the watering journal. It must remain useful during short, frequent sessions when the user is standing among their plants and wants confirmation rather than exploration.

## 2. Primary User Action

The user opens a plant and quickly answers three questions:

1. What is its current watering schedule?
2. When was it last watered?
3. What next-due date did each watering produce?

The current schedule and newest journal entry must be understandable without scrolling on a typical phone viewport.

## 3. Design Direction

### Visual lane

Use a **Restrained** color strategy. The winning direction is the ledger-first probe: compact plant identity, exact schedule facts, and a highly scannable journal. Carry only a little of the identity-first probe's photo emphasis into the detail header.

### Scene sentence

A hobbyist plant owner checks YAPCA while standing among their collection in ordinary daylight, focused on confirming care history rather than exploring a dashboard.

This calls for the existing light, true-white surface. The system dark theme remains supported through the existing tokens, but the feature must not introduce a dark-first visual language.

### Anchor references

- **Things 3:** calm task density and controls that recede into the task.
- **Apple Health history views:** chronological clarity and exact, trustworthy dates.
- **iOS Contacts:** an identity-led detail hierarchy where the subject is immediately recognizable.

These are behavioral and structural references, not instructions to imitate platform chrome.

### System alignment

Follow the root `DESIGN.md` without introducing feature-local tokens:

- True-white paper, confident near-black ink, and green-tinted neutral layers.
- Canopy green only for navigation, focus, and living-state accents; keep it below 10% of the screen.
- Figtree Variable as the sole type family.
- Flat resting surfaces separated by tone and hairlines, not shadows.
- Sentence-case labels and fixed product type sizes.
- No cream background, illustration, gamification, decorative timeline, or card grid.

## 4. Scope

### Fidelity

Production-ready design specification.

### Breadth

The complete responsive flow includes:

- Navigation from a Today row to plant detail.
- The All Plants collection page.
- The plant detail header.
- The watering journal and pagination.
- Empty, loading, fetch-error, and not-found states.

### Interactivity

Use standard browser navigation and SSR-rendered pages. The Today list remains the only interactive island affected by this feature, and only its plant-information region becomes a link.

### Explicit exclusions

- No edit or delete controls.
- No undo or postpone UI.
- No journal notes or manually added entries.
- No "Watered" action on plant detail.
- No botanical taxonomy, light requirements, care method, or other invented metadata.
- No overdue visual treatment beyond whatever the existing due-label helper currently supplies; S-03 owns overdue styling.

## 5. Layout Strategy

### 5.1 Authenticated app shell

Use one consistent header vocabulary across Today, All Plants, Add Plant, and plant detail:

- Wordmark at the start.
- `Today`, `All plants`, and `Sign out` at the end.
- The current destination is distinguishable without a heavy selected pill; weight, foreground color, and `aria-current="page"` are sufficient.
- Keep the header flat with the existing bottom hairline.

On narrow screens, retain the visible destinations while they fit. Three short actions do not justify a custom hamburger menu. Reduce horizontal gaps and button padding before changing the information architecture.

### 5.2 All Plants

Use a centered reading column slightly wider than the existing Today list, with a practical maximum width around 40rem.

The first content row contains:

- `All plants` as the page heading.
- `Add plant` as the only primary action.

Render the collection as one continuous divided list, not individual cards. Each row contains:

- A 48px image on compact screens and up to 56px on wider screens.
- The plant name as the strongest row text.
- `Every N days` and an exact next-due label as secondary text.
- A subtle directional cue only if the row otherwise fails to read as navigable; the linked content and hover/focus treatment should usually be enough.

The whole row is one link. Give it a generous minimum target height, visible focus ring, muted-surface hover state, and restrained active state. Do not add resting shadows or enclosing row borders beyond the list's hairline dividers.

### 5.3 Today row navigation

Only the photo, plant name, and metadata region becomes a link to `/plants/<id>`. The `Watered` button remains a sibling control so pointer and keyboard activation cannot accidentally navigate.

The linked region should fill the available middle of the row, including the image, and have a coherent focus-visible treatment. Preserve the existing collapse animation and optimistic watering behavior.

### 5.4 Plant detail

Use a centered ledger-first column with a practical maximum width around 48rem. The order is:

1. `Back to all plants` link.
2. Plant identity and schedule header.
3. A deliberate divider and spacing break.
4. `Watering journal` heading and count context when useful.
5. Journal entries.
6. Pagination when more than ten entries exist.

On wider screens, compose the identity header horizontally:

- A 96–120px square plant photo or initial fallback.
- Plant name beside it.
- A compact facts line or two-column facts band for `Every N days` and `Next due <date>`.

On phones, use a 72–88px image and stack the name and schedule facts. The name may wrap to two lines. Do not let the image force schedule facts below the first viewport when avoidable.

The photo is real content, not decoration. Use an empty alt when the visible adjacent plant name conveys the same identity; otherwise use concise alternative text. The initial fallback must occupy the same geometry as the photo so loading and missing-image states do not shift the layout.

### 5.5 Watering journal

Render a flat, reverse-chronological ledger. Do not use a vertical connector line, dots linked as a timeline, or a stack of event cards.

Desktop and wide tablet use three semantic columns:

1. **Date** — the date the plant was watered.
2. **Event** — `Watered` with a small droplet or accepted project icon if available.
3. **Next due** — the exact resulting due date.

Use a semantic list or table according to the final markup constraints. If using a table, preserve useful headers on small screens or provide equivalent accessible labels when the visual layout changes.

On narrow screens, each entry becomes a compact two-line row:

- First line: watering date and `Watered`.
- Second line: `Next due <date>`.

Separate entries with hairlines and 12–16px vertical padding. The newest entry must not be visually promoted as a card; chronology already gives it priority.

### 5.6 Pagination

Paginate after **10 entries**. Use the `page` query parameter, for example `/plants/<id>?page=2`, so the state is linkable and browser Back behaves predictably.

Below the journal, show:

- Range text such as `1–10 of 34`.
- `Previous` and `Next` link-buttons.
- `Previous` disabled on the first page.
- `Next` disabled on the last page.

On desktop, range text sits at the start and controls at the end. On narrow screens, keep the range on its own line if necessary and give both controls equal width. Disabled controls must be semantically disabled and visually legible, not merely faded below contrast requirements.

If a requested page is beyond the final page, prefer redirecting or resolving to the last valid page rather than rendering an unexplained empty journal. Invalid non-numeric and negative page values resolve to page 1.

## 6. Key States

### Default detail

Show plant identity, interval, exact next-due date, and between one and ten newest-first journal entries. The interface should feel precise, calm, and complete.

### Long journal

Show ten entries, the total range, and pagination. Navigation between pages preserves the plant header and moves focus to the journal heading or first journal entry after the new document loads.

### Empty journal

Keep the journal heading, then show:

> **No waterings yet**  
> Mark this plant watered from Today to start its journal.

Include a `Back to Today` link only if it materially helps; do not introduce a duplicate Watered action.

### Empty collection

Show:

> **Add your first plant**  
> Set its watering interval and it will appear here when it needs water.

Follow with the primary `Add plant` action.

### Missing photo

Use the first trimmed character of the plant name, uppercased, or `?` as the final fallback. Use the existing muted surface and readable muted ink.

### Loading

SSR should normally deliver complete content. If a client-visible loading state becomes necessary, use page-shaped skeletons matching the identity block and journal rows. Do not place a spinner in the middle of the page.

### Fetch error

Keep the app shell and page context. Use plain recovery copy:

> **We couldn't load this plant.**  
> Try again, or return to All plants.

Provide `Try again` and `All plants` actions without presenting the failure as destructive.

### Not found or unauthorized

Return HTTP 404 and show:

> **Plant not found**  
> This plant may have been removed or isn't available to this account.

Follow with `Back to all plants`. Do not reveal whether an inaccessible ID belongs to another user.

### Long names and localized content

- Permit a plant name to wrap to two lines in list and detail contexts.
- Do not truncate dates or the primary event label.
- Let pagination controls grow with translated labels.
- Avoid fixed row heights that break when metadata wraps.

### Dark system theme

Preserve hierarchy through the existing dark tokens. Do not introduce glowing green, elevated content cards, translucent glass, or saturated inactive states.

## 7. Interaction Model

- Today plant-information links and All Plants rows use ordinary anchors.
- The Watered button remains separately focusable and does not inherit row-link behavior.
- All interactive elements ship default, hover, focus-visible, active, and disabled states where applicable.
- Focus indication uses the existing focus green with a clear offset against both paper and muted surfaces.
- Journal pagination uses server navigation; browser history and copied URLs retain the selected page.
- After pagination navigation, document focus should land naturally at the top while a skip target or fragment may move keyboard users directly to the journal. Avoid client-side focus scripting unless testing shows it is necessary.
- State transitions remain within 150–200ms and convey hover, focus, or the existing row removal only.
- `prefers-reduced-motion` removes nonessential interpolation. Do not add page-load or journal-entry reveal choreography.

## 8. Content Requirements

### Navigation and headings

- `Today`
- `All plants`
- `Add plant`
- `Back to all plants`
- `Watering journal`

### Schedule and journal labels

- `Every 7 days`
- `Next due July 23`
- `Watered`
- `1–10 of 34`
- `Previous`
- `Next`

Use the existing interval and date helpers. Dates must be exact and locale-aware according to the project's chosen formatter; never replace them with vague labels such as `Recently` or `Soon`.

### Empty and error copy

- `No waterings yet`
- `Mark this plant watered from Today to start its journal.`
- `Add your first plant`
- `Set its watering interval and it will appear here when it needs water.`
- `We couldn't load this plant.`
- `Try again, or return to All plants.`
- `Plant not found`
- `This plant may have been removed or isn't available to this account.`

### Media roles

The only visual media is the user's uploaded plant photo, delivered through the existing signed-URL flow. The accepted omission is the initial fallback. Do not generate or add botanical artwork, textures, stock photography, or decorative icons.

### Data exposure

Show `watered_on`, `event_type`, and `new_due_on`. Keep `prev_due_on` hidden in this slice; it exists to support future deterministic undo, not to burden the journal now.

## 9. Accessibility and Responsive Requirements

- Meet WCAG 2.2 AA.
- Body and metadata text must maintain at least 4.5:1 contrast; do not lighten muted text for elegance.
- Use semantic headings in order and one page-level `h1`.
- Mark the current navigation item with `aria-current="page"`.
- Use descriptive link names; repeated plant links receive their accessible name from the plant name, not `View`.
- Journal column headers or equivalent accessible labels must remain available after mobile reflow.
- Do not convey due or future overdue states by color alone.
- Pointer targets should be at least 44px in the primary mobile flow.
- Test at 320px width, common phone widths, tablet, and desktop.
- Verify 200% zoom without horizontal page scrolling.
- Preserve visible focus when rows have overflow clipping for the existing removal animation.

## 10. Recommended Impeccable References for Implementation

- `reference/layout.md` for the responsive identity and ledger structure.
- `reference/adapt.md` for the mobile journal transformation.
- `reference/harden.md` for empty, error, long-name, invalid-page, and pagination boundaries.
- `reference/typeset.md` for dense date and metadata hierarchy.
- `reference/audit.md` for contrast, focus, semantics, responsiveness, and reduced-motion verification.

## 11. Acceptance Checklist

- [ ] Today plant information opens detail while Watered remains independent.
- [ ] All Plants lists every owned plant as a continuous, accessible linked list.
- [ ] The detail header communicates identity, interval, and exact next-due date before the journal.
- [ ] Journal entries are newest first and show watered date, event, and resulting next-due date.
- [ ] Journals paginate at ten entries with URL-based page state and correct boundary behavior.
- [ ] Empty collection, empty journal, fetch-error, missing-photo, and 404 states are designed and implemented.
- [ ] The feature uses existing tokens and component vocabulary without feature-local visual exceptions.
- [ ] Mobile reflow remains readable at 320px and keyboard navigation remains complete.
- [ ] No excluded controls or invented plant data appear.
- [ ] Contrast, focus, semantics, and reduced-motion behavior pass the final audit.

## 12. Resolved Decisions

- Fidelity: production-ready.
- Breadth: Today navigation, All Plants, detail, journal, pagination, and supporting states.
- Direction: ledger-first with modest photo emphasis.
- Color strategy: Restrained.
- Theme: existing light system with token-driven dark support.
- Pagination: ten entries per page via `?page=N`.
- Journal order: newest first.
- Visible journal data: watering date, event label, and resulting next-due date.
- Hidden journal data: previous due date.
- Open questions: none.

# Core Watering Loop — Design Brief

Status: Draft, awaiting confirmation  
Change: `core-watering-loop`  
Surface: Today’s list and add-plant flow

## 1. Feature Summary

The core watering loop gives a signed-in hobbyist with dozens of plants one dependable place to see what needs water and record the work immediately. This slice covers the complete S-01 experience: add a plant, decide when it first becomes due, see due plants in Today, and mark one Watered with instant feedback and safe rollback on failure.

The interface is designed for short, frequent sessions while the user is standing among their plants. It must remain calm and scannable with 10–30 due plants without turning into a dashboard or an administrative table.

## 2. Primary User Action

Mark a due plant **Watered** confidently in one tap. The row leaves immediately; the server remains authoritative about the next due date, and a failed action restores the row in place.

Adding a plant is the enabling secondary action. It should be easy to find without competing with Watered inside the working list.

## 3. Design Direction

**Color strategy:** Restrained. Preserve the existing YAPCA tokens and DESIGN.md’s One Voice Rule. The light palette uses true-white paper, near-black ink, and subtly green-tinted neutrals; the dark palette preserves the same hierarchy through the existing dark tokens. Both follow the operating-system preference through CSS alone. Canopy green remains limited to primary actions and focus. Photos provide contained natural color; the chrome does not sample or imitate them.

**Scene sentence:** A hobbyist stands in a plant-filled room in variable light, holding a watering can and glancing at a phone one-handed, focused on finishing a practical round without second-guessing the schedule. This requires a high-contrast working surface in both system-selected light and dark modes; theming is application-wide and CSS-only, with no script-driven class toggle.

**Anchor references:**

- Field Notes: observational clarity, confident labels, and a continuous ledger rhythm.
- Things 3: calm task completion, disciplined hierarchy, and state feedback that stays out of the way.
- Apple Reminders: familiar list actions, reachable mobile controls, and predictable error recovery.

**Probe outcome:** Use the hybrid direction approved after visual exploration. Direction A supplies the field-ledger hierarchy and quiet continuous list; Direction B supplies fast, reachable action placement; Direction C supplies the straightforward vertical form. Reject the probes’ lifestyle backdrops, oversized circular check controls, administrative table treatment, oversized photo dropzone, unplanned bottom navigation, and decorative shadows.

## 4. Scope

- **Fidelity:** Production-ready design specification.
- **Breadth:** The complete S-01 flow across two surfaces: Today’s list at `/` and add plant at `/plants/new`.
- **Interactivity:** Shipped-quality behavior for validation, photo selection, form submission, optimistic Watered actions, rollback, and responsive states.
- **Devices:** Phone-first interaction with a composed desktop layout; tablet follows the desktop structure at a narrower measure.
- **Volume:** Designed for 10–30 simultaneously due plants; natural scrolling, no pagination in this slice.
- **Time intent:** Polished enough to implement directly, not a sketch or exploratory prototype.
- **Accessibility:** WCAG 2.2 AA, complete keyboard operation, visible focus, 44px minimum touch targets on the mobile action path, and reduced-motion behavior.

Out of scope remains aligned with `plan.md`: journal/history, Postpone, Undo, semantic overdue treatment, seasonal intervals, edit/delete, plant details, and new navigation architecture.

## 5. Layout Strategy

### Shared app chrome

Use a flat top bar with the YAPCA wordmark at the start and account/sign-out access kept quiet at the end. On the Today surface, **Add plant** is the only promoted navigation action. Do not introduce a sidebar or bottom navigation for a two-surface product.

The content sits in one centered working column rather than a dashboard grid. Desktop may widen enough to give row metadata and actions stable columns; mobile collapses each row into a compact two-line content block with the action pinned at the inline end.

### Today’s list

The page begins with **Today** and a plain-language count such as “12 plants need water.” The heading is the page anchor, not a hero, and the count is supporting copy rather than a metric tile.

Render plants as one continuous ledger separated by hairlines. Rows are not individual cards and have no resting shadow. Each row contains:

1. A 48px mobile / 56px desktop square thumbnail with a modest radius. If no photo exists, use a muted tonal square with the plant-name initial; do not use a decorative leaf illustration.
2. The plant name as the dominant row label. Allow two lines before truncation so user-created names do not push the action off-screen.
3. Exact schedule metadata: “Due today” when equal to the local date; otherwise show the exact due date, such as “Due 18 Jul.” Do not label carry-over rows Overdue or apply amber styling until S-03.
4. The interval as secondary metadata, such as “Every 7 days.”
5. A labeled **Watered** button, consistently aligned and always visible. Do not make a check icon the only affordance.

For 10–30 rows, keep the vertical rhythm compact but touch-safe. The page scrolls naturally; no “scroll for more” prompt, pagination, collapsible grouping, or sticky per-row controls.

### Add plant

Use a dedicated, narrow single-column page with a conventional back link, **Add plant** heading, and fields in task order:

1. **Plant name** — required text field.
2. **Water every** — number input with a visible “days” suffix and supporting range of 1–365 days.
3. **When should it first appear?** — explicit radio choice instead of an ambiguous “Already watered today?” checkbox:
   - **Today** — “It needs water now.” Default.
   - **After [interval] days** — “I watered it today.” The label updates as the interval changes.
4. **Photo (optional)** — standard file picker with concise size/type guidance and an inline square preview after selection. Do not use a large drag-and-drop zone on this mobile-first form.
5. **Save plant** — full-width on narrow screens and content-width on desktop, placed at the natural end of the form rather than fixed to the viewport.

The radio choice maps to the existing `alreadyWatered` boolean; it improves comprehension without changing the server contract.

## 6. Key States

### Today’s list

- **Default, due plants:** Continuous list, ordered by due date and then plant name for stable scanning. The current plan’s server ordering should add the name tie-breaker.
- **No plants yet:** “Add your first plant” with short teaching copy: “Set a watering interval and it will appear here when it’s due.” Primary action: **Add plant**.
- **Plants exist, none due:** “Nothing needs water today.” If available from the already-fetched data, add “Next: [plant] on [date]” to reinforce trust in the schedule. Keep **Add plant** secondary.
- **Initial local-date bootstrap:** The first request cannot know the browser's calendar date. Server-render the stable app chrome and Today heading with compact row-shaped placeholders, never a spinner or Worker-UTC-filtered rows. After hydration, replace the placeholders with the correctly filtered browser-local ledger. Later client refetches use the same row-shaped skeleton treatment.
- **Watered pending:** Remove the row optimistically and disable any duplicate submission path. The list and count update together.
- **Watered success:** The row stays absent. No confetti, success modal, or celebratory toast.
- **Watered failure:** Restore the row at its original sorted position and restore the count. Show a concise floating toast: “Couldn’t mark [plant] watered. Try again.” Include a **Retry** action when the failure is retryable.
- **List fetch failure:** Preserve the app chrome and page title; show “We couldn’t load your plants” with a **Try again** action. Do not misrepresent a failed fetch as an empty day.
- **Long names / missing photos / 30 rows:** Names wrap to two lines; the action column remains stable; neutral initial fallbacks do not create false content; natural scroll retains the page heading above the list.

### Add plant

- **Default:** Plant name receives focus on desktop. Avoid automatic focus on mobile if it would open the keyboard before the page context is visible.
- **Validation:** Show specific inline errors beside their field, including “Enter a plant name” and “Choose a number from 1 to 365.” Error meaning is never color-only.
- **Photo selected:** Show a cropped preview, file name, and **Remove photo** action. An invalid file preserves all other fields and explains the allowed type/size.
- **Submitting:** Button label becomes “Saving plant…” and the form cannot submit twice. Preserve all visible values.
- **Success:** Navigate to Today. If the plant is due now, it appears in the list; if it was watered today, the clear-day or existing-list state remains accurate. No success animation is required.
- **Server/upload failure:** Keep the user’s entries and selected-photo preview where browser security permits. Show a form-level message: “We couldn’t save this plant. Check your connection and try again.” Keep **Try again** available.

## 7. Interaction Model

- **Watered:** A pointer click, tap, or keyboard activation immediately updates the local list and count. Animate the row with a short 180–200ms fade-and-collapse using an ease-out curve; do not animate surrounding layout longer than necessary. Under `prefers-reduced-motion`, remove it instantly with no collapse animation.
- **Local-date rollover:** Derive Today in the browser before revealing rows, recompute the date for every mutation, and update an open list when local midnight passes without requiring a reload.
- **Rollback:** A failed action reinserts the row at the correct sorted position. Use a short crossfade only; reduced motion restores it instantly. Keyboard focus returns to the restored Watered button when practical.
- **List hover/focus:** A subtle muted-surface hover may span the row on pointer devices. Keyboard focus belongs to the actual button with the existing green focus ring; the whole row is not clickable in S-01.
- **Add plant:** Validate a field after blur and again on submit. Interval changes immediately update the second initial-schedule option so the consequence stays explicit.
- **Photo:** Selecting a replacement photo replaces the preview; removing it returns to the simple picker. The image is optional and never blocks saving when absent.
- **Navigation:** Back returns to Today without a confirmation when the form is pristine. If dirty-form protection is added later, use the browser’s conventional leave-page behavior rather than a custom modal in this slice.

## 8. Content Requirements

### Today

- Heading: “Today”
- Count: “1 plant needs water” / “[n] plants need water”
- Primary navigation: “Add plant”
- Row action: “Watered”
- Metadata: “Due today,” “Due [day month],” and “Every [n] day(s)”
- Clear day: “Nothing needs water today.”
- Empty collection: “Add your first plant” / “Set a watering interval and it will appear here when it’s due.”
- Failure: “Couldn’t mark [plant] watered. Try again.”
- Load failure: “We couldn’t load your plants.”

### Add plant

- Page title: “Add plant”
- Fields: “Plant name,” “Water every,” “days,” “Photo (optional)”
- Initial schedule: “When should it first appear?”, “Today,” “It needs water now.”, “After [n] days,” “I watered it today.”
- Submit: “Save plant” / “Saving plant…”
- Errors: plain, field-specific, and actionable; never expose storage, Supabase, or Astro terminology.

### Dynamic-content bounds

- Due list: 0–30 typical/heavy, potentially more without layout failure.
- Plant name: support at least 80 characters in layout, displayed to two lines in the list.
- Interval: integer from 1–365 with singular/plural grammar.
- Photo: optional user-provided raster image; list crop uses `object-fit: cover`. The adjacent visible plant name makes the thumbnail’s `alt` empty to avoid duplicate screen-reader output.
- Dates: locale-aware display for the user, while storage and mutations remain exact `YYYY-MM-DD` values.

## 9. Recommended Impeccable References for Implementation

- `reference/layout.md` — preserve ledger rhythm across 10–30 rows and two responsive structures.
- `reference/adapt.md` — verify mobile action reachability, name wrapping, and desktop metadata alignment.
- `reference/clarify.md` — keep schedule choices and failure messages concrete.
- `reference/harden.md` — cover upload, network, validation, long-content, and recovery paths.
- `reference/animate.md` — implement optimistic removal and rollback without decorative motion.

## 10. Open Questions

None. The design direction, scope, density, content model, and S-01 boundaries are sufficiently resolved for implementation once this brief is confirmed.

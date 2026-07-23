# Postpone and Undo Design Brief

## 1. Feature Summary

Extend the Today list so a plant owner can defer a watering task by exactly two days and recover from a mistaken Watered or Postpone action. The feature serves someone moving through their home with a watering can, acting quickly across many plants and relying on the list to remain an exact account of what still needs attention.

Both actions must feel immediate without sacrificing trust. A completed task leaves Today at once, its exact scheduling result is stated in a temporary actionable notice, and Undo reverses that specific journaled event rather than approximating the previous state.

## 2. Primary User Action

The user should be able to choose **Watered** or **Postpone 2 days** confidently in one step, understand the exact result, and undo that individual action when it was a misclick.

Watered remains the primary act of care. Postpone is deliberately secondary: available without being visually competitive, and never presented as a third scheduling mode or a change to the plant's base interval.

## 3. Design Direction

### Color strategy

**Restrained.** Preserve YAPCA's true-white field-notebook surface, ink-led hierarchy, limited canopy green, and established warning treatment. Canopy green remains reserved for Watered, focus, and living-state emphasis. Postpone and Undo use neutral secondary styling; neither introduces another semantic color.

Action feedback floats above the ledger only while it is actionable. It may use the design system's transient elevation, but it must not become a decorative glass surface, oversized card, or persistent activity center.

### Scene sentence

A plant owner checks a phone in ordinary indoor daylight, watering can in hand, moving from plant to plant and making quick decisions without stopping to study the interface.

This context favors the existing high-legibility surface, short labels, forgiving tap targets, and immediate feedback. The established system dark mode remains available for device preference and lower ambient light.

### Anchor references

- Gmail for familiar post-action Undo that does not interrupt the original task.
- Linear for compact, disciplined row actions and independent concurrent mutations.
- YAPCA's field-notebook design for exact dates, quiet authority, and a ledger that always tells the truth.

The feature must not drift toward confirmation dialogs, celebratory completion, gamified rewards, permanent notification centers, or rows that temporarily pretend completed work is still due.

## 4. Scope

- **Fidelity:** Production-ready design specification.
- **Breadth:** The authenticated Today-list action flow plus the corresponding watering-journal representation.
- **Interactivity:** Shipped-quality Watered, Postpone, Undo, Retry, concurrent-action, focus, responsive, and reduced-motion behavior.
- **Time intent:** Polish until the complete flow is ready to implement and verify.

The design covers successful and failed Watered/Postpone mutations, one independently undoable notice per successful action, undo success and failure, journal consistency, local-midnight behavior, 320px layouts, 200% zoom, keyboard operation, screen-reader feedback, light/dark themes, and reduced motion.

It does not add a confirmation dialog, future-task view, arbitrary postpone duration, skip action, persistent history tray, indefinite historical undo, or a Watered/Postpone control to the plant-detail page.

## 5. Layout Strategy

### Today row

Keep the existing chronological ledger and its linked plant-information region. Each due row retains:

1. Plant image or initial fallback.
2. Linked plant identity, due state, exact date where required, and interval.
3. An independent action region containing Watered and Postpone 2 days.

Watered keeps canopy-green primary emphasis. Postpone 2 days uses the existing neutral secondary/ghost vocabulary. The actions must read as alternatives for the current task, not as a segmented control and not as equal primary buttons.

On wider screens, the two actions may sit side by side in the stable action column. At narrow widths or 200% zoom, they may form a compact vertical action group or let Postpone move beneath Watered. Plant identity and load-bearing due information must remain understandable, and neither action may be reduced to an unlabeled icon. The page must not scroll horizontally at 320px.

The pending action disables both controls for that plant so Watered and Postpone cannot race against each other. Unrelated rows remain independently actionable.

### Action feedback

Do not leave a completed or postponed row in Today merely to host Undo. Once either action succeeds, the plant no longer belongs in the due ledger, so the row and due count update together.

Instead, show an actionable snackbar/toast in the established transient notice region. Each notice contains:

1. The plant-specific outcome.
2. The exact resulting due date.
3. A labeled Undo action.
4. A dismiss affordance supplied by the established notice component when needed.

Each successful action owns its own notice. Notices stack rather than replacing one another so several rapid actions remain independently undoable. The stack should stay compact at rest and reveal every active action through the notice component's established hover, focus, and touch behavior.

Rows remain flat at rest. Only the floating feedback surface receives transient elevation; no resting shadows, colored side stripes, nested cards, or oversized rounding are introduced.

## 6. Key States

### Default due row

- Watered is the primary action.
- Postpone 2 days is secondary but always visible and labeled.
- Existing due-today and overdue treatments remain intact.
- Pointer, keyboard, and assistive-technology users can operate the information link and both actions independently.

### Pending Watered or Postpone

- Disable both actions on the affected row immediately.
- Begin the existing short optimistic fade-and-collapse without waiting for the network.
- Update the due count with the row.
- Permit unrelated plant rows to mutate concurrently.
- Do not show a success notice until the server confirms and returns the authoritative event and resulting due date.

### Successful Watered

- Keep the row absent.
- Show: `[Plant] marked watered · Next due [exact date]`.
- Provide Undo for ten seconds.
- Record one Watered journal event atomically with the schedule change.
- Do not add a second success animation, confirmation screen, sound, vibration, or celebratory treatment.

### Successful Postpone

- Keep the row absent.
- Show: `[Plant] postponed · Due [exact date]`.
- Provide Undo for ten seconds.
- Record one Postpone journal event atomically with the two-day shift.
- Leave the plant's base watering interval unchanged.

### Several successful actions

- Preserve one independently actionable notice per event.
- Do not replace an earlier notice with a later action.
- Undoing one event must not disable, dismiss, reorder, or reverse another notice.
- Keep notices associated with immutable event identifiers rather than only plant identifiers, so the reversal target remains unambiguous.

### Failed Watered or Postpone

- Restore the row, due count, semantic overdue state, and stable ledger position.
- Restore focus to the control that initiated the failed action when practical.
- Show a concise error notice with Retry for that same action.
- Do not offer Undo because no mutation was committed.

### Pending Undo

- Disable only the selected notice's Undo action.
- Keep the current list state until the server confirms the reversal.
- Other active notices and unrelated row actions remain operable.
- Give the pending control an accessible state without replacing its label with an unexplained spinner.

### Successful Undo

- Dismiss the corresponding notice.
- Reverse the exact journal event and restore its stored previous due date atomically.
- Reinsert the plant into Today only when the restored due date is due or overdue against the current browser-local date.
- Restore the row at its correct `next_due_on`, then name, sort position and update the count.
- Use a short crossfade/open transition; restore instantly under reduced motion.

### Failed Undo

- Keep the committed Watered or Postpone result authoritative.
- Retain the notice and change its message to `Couldn't undo [plant]. Try again.`
- Replace the pending control with Retry.
- Do not reinsert the row or modify the journal optimistically.

### Notice timing and dismissal

- Keep each Undo available for ten seconds.
- Pause that notice's dismissal timer while it or one of its controls is hovered, focused, or otherwise actively engaged.
- Dismissing a notice accepts the committed result; it does not perform another mutation.
- Expiration removes only the affordance, not the journaled action.

### Loading and hydration

- Preserve the existing row-shaped skeletons while the browser-local date is unavailable.
- Do not render inert action placeholders that resemble operable Watered, Postpone, or Undo controls.

### Empty state

- If the last task leaves Today, transition to the existing clear-day state.
- Active Undo notices remain available above that state for their remaining duration.
- Undo may restore the ledger from the clear-day state without a reload.

### Local-midnight rollover

- Use a fresh browser-local date for every initial action, Retry, and undo visibility decision.
- A restored plant is shown only if its restored due date belongs in the newly current Today ledger.
- Do not extend, restart, or silently expire Undo merely because midnight passes.

### Reduced motion

- Keep the existing instant-removal alternative.
- Restore an undone row instantly rather than collapsing or translating it.
- Meaning and timing must never depend on motion.

## 7. Interaction Model

### Row actions

Watered and Postpone are sibling controls outside the plant-information link. A pointer click, tap, Enter, or Space activation starts the selected mutation immediately; no modal or confirmation step intervenes.

The row-level coordinator remains the durable owner of optimistic state. It prevents duplicate or conflicting mutations for one plant while allowing different plants to proceed concurrently. Watered and Postpone use the same removal, rollback, focus-restoration, and Retry vocabulary so the user does not have to learn two systems.

### Undo notices

The feedback region does not steal focus after success. Announce the outcome through a polite live region, including the plant name and exact resulting date, while leaving the user in the list. Undo remains reachable through normal keyboard navigation and the notice stack's established interaction model.

Activating Undo targets the event represented by that notice. The server reverses from stored before/after values; the client never reconstructs the old date from the plant's current interval. This keeps rapid actions independent and protects deterministic scheduling if other data changes.

The notice stack must remain operable by touch, keyboard, pointer, and screen reader. Auto-dismiss pauses during interaction. Swiping or manually dismissing a notice is equivalent to accepting its result, never to Undo.

### Motion

Use the existing 190–200ms ease-out fade-and-collapse for optimistic removal and a matching short crossfade/open for restoration. Motion communicates membership in the Today ledger; it is not decorative. Under `prefers-reduced-motion`, both changes are instant.

## 8. Content Requirements

### Row actions

- `Watered`
- `Postpone 2 days`

Do not shorten Postpone to an ambiguous icon, `Later`, or `Snooze`. The fixed two-day consequence should be visible before activation.

### Successful Watered notice

`[Plant] marked watered · Next due [exact date]`

Action: `Undo`

### Successful Postpone notice

`[Plant] postponed · Due [exact date]`

Action: `Undo`

### Mutation failure notices

- `Couldn't mark [plant] watered. Try again.`
- `Couldn't postpone [plant]. Try again.`

Action: `Retry`

### Undo failure notice

`Couldn't undo [plant]. Try again.`

Action: `Retry`

### Journal entries

- Watered: exact action date, `Watered`, and the previous scheduled date.
- Postpone: exact action date, `Postponed 2 days`, and `Due [previous date] → [new date]`.

An undone action is reversed as a journal event and must not remain displayed as if it still governs the schedule. Do not introduce an `Undone` badge unless implementation research proves an immutable audit trail is required; the MVP journal is the user's active watering history, not an administrative log.

### Copy rules

- Always use exact dates; never use `soon`, `later`, or another fuzzy result.
- Keep labels in sentence case.
- Include the plant name in every floating outcome so stacked notices remain distinguishable.
- Avoid congratulatory, guilt-inducing, or gamified language.
- User-generated plant names must wrap without pushing Undo or Retry out of the actionable notice.

No new imagery is required. Existing plant photos and initial-letter fallbacks remain the only visual assets. Standard project icons may support dismiss or status semantics, but no action may rely on an icon alone.

## 9. Recommended Implementation References

The most valuable Impeccable references during implementation are:

- `reference/harden.md` for concurrent actions, atomic reversal, timeout, failure, and recovery edge cases.
- `reference/adapt.md` for the two-action row at 320px and 200% zoom and for the responsive notice stack.
- `reference/audit.md` for focus order, live-region behavior, actionable-notice timing, contrast, keyboard operation, and reduced motion.
- `reference/animate.md` for matching removal and restoration motion without delaying the task flow.

Implementation must also remain aligned with `PRODUCT.md`, `DESIGN.md`, `context/foundation/prd.md`, the S-04 definition in `context/foundation/roadmap.md`, and the existing Today-list and journal contracts established by S-01 through S-03.

## 10. Open Questions

None. The product documents and confirmed shaping decisions settle the fixed two-day behavior, independently undoable actions, actionable-notice pattern, ten-second interaction window, restrained visual direction, and production-ready responsive scope.

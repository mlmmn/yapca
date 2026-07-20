# Overdue Tasks and Urgency Design Brief

## 1. Feature Summary

Refine the Today list so overdue watering tasks are unmistakable without making the interface alarming. The feature serves plant owners making quick daily decisions while moving among their plants, often with a watering can in hand and limited attention for interpreting the interface.

The design must expose urgency while preserving the dependable scheduling loop, the single due-date-sorted ledger, and the existing Watered interaction. It is a visual and semantic refinement of the current Today list rather than a new workflow.

## 2. Primary User Action

The user should be able to identify the oldest overdue plant immediately, understand exactly when it was due, and mark it Watered without disrupting the existing workflow.

## 3. Design Direction

### Color strategy

**Restrained.** Retain YAPCA's true-white field-notebook surface, ink-led hierarchy, and limited canopy green. Urgency uses the established amber family and never destructive red. Color reinforces the state but does not carry its meaning alone.

### Scene sentence

A plant owner checks a phone in ordinary indoor daylight, watering can in hand, focused on completing a short care round without stopping to study a dashboard.

This physical context favors the existing light, high-legibility surface while retaining the established system dark mode for device preference and lower ambient light.

### Anchor references

- A naturalist's field ledger for exact dates, ordered observations, and quiet authority.
- Linear for disciplined, familiar state vocabulary that disappears into the task.
- Things for calm task hierarchy and satisfying completion without gamification.

The surface remains botanical through color and rhythm, not illustration. It must not drift toward gamified urgency, skeuomorphic plant imagery, generic SaaS card styling, or red error semantics.

## 4. Scope

- **Fidelity:** Production-ready design specification.
- **Breadth:** The authenticated Today list only.
- **Interactivity:** Shipped-quality behavior for row links, Watered actions, optimistic removal, retry, focus restoration, and local-midnight reclassification.
- **Time intent:** Polish until the feature is ready to ship and manually verify.

The design covers due-today, standard-overdue, and strong-overdue rows, including responsive behavior, dark mode, accessibility, loading, failure, and mutation states.

It does not redesign scheduling, navigation, Postpone, Undo, All Plants, plant details, empty states, or the underlying Watered coordinator.

## 5. Layout Strategy

Keep one chronological ledger. Separating Today and Overdue into sections would weaken the existing oldest-first decision path and add scanning overhead.

Each row preserves the current three-part rhythm:

1. Plant image or initial fallback.
2. Linked plant identity and scheduling metadata.
3. Independent Watered action.

Due-today rows remain neutral. Overdue information belongs inside the linked identity-and-metadata region so the plant and its urgency are read as one unit. Every overdue row shows a warning glyph, visible `Overdue` label, and exact due date.

The hierarchy within an overdue row is:

1. Plant name.
2. Overdue status and exact due date.
3. Watering interval.

Beginning on the third overdue day, the urgency marker and row surface gain stronger amber emphasis. Typography, wording, row height, action prominence, and hue meaning remain consistent; the strong state is an escalation within one semantic family, not another severity tier.

At narrow widths, metadata may wrap beneath the plant name. Plant identity, exact due date, and the Watered action must remain visible without horizontal page scrolling at 320px or 200% zoom. Truncation may protect long secondary interval text only after the load-bearing identity and due-date information remain understandable.

Rows remain flat at rest. Tonal surface and semantic color provide separation; no resting drop shadows, colored side stripes, nested cards, or oversized rounding are introduced.

## 6. Key States

### Due today

- Neutral row treatment.
- Copy remains `Due today` followed by the watering interval.
- No warning glyph or amber surface.

### One or two days overdue

- Standard warning surface and foreground.
- Decorative warning glyph paired with a visible `Overdue` label.
- Exact due date remains visible.
- The state is clear in grayscale and without perceiving amber.

### Three or more days overdue

- Same glyph, label, exact date, and amber hue family as the standard overdue state.
- Stronger warning-accent emphasis on the marker and/or surface.
- No red, larger warning copy, additional badge, or new severity label.

### Pending Watered action

- Preserve the existing disabled-button behavior and optimistic row removal.
- Do not change urgency presentation into a loading treatment before the row leaves.
- Concurrent actions on unrelated rows remain possible.

### Failed Watered action

- Restore the row in its correct urgency state and ledger position.
- Restore focus to its Watered button.
- Preserve the existing error toast and Retry action.

### Loading

- Preserve task-shaped skeleton rows rather than introducing a centered spinner.
- Skeletons remain neutral because urgency cannot be classified until the browser-local date is available.

### Empty and fetch error

- Preserve the existing states and copy; this feature adds no new empty or error condition.

### Local-midnight rollover

- Reclassify rows against the new browser-local date without a reload.
- A row crossing the two-to-three-day boundary adopts the strong treatment in place.
- The change is a quiet state correction: no toast, live-region announcement, or attention animation.

### Reduced motion

- Preserve the existing instant removal path.
- Any urgency-state transition must also work without motion; meaning may never depend on animation.

## 7. Interaction Model

The plant identity and scheduling information remain one full-area link. Watered remains an independent sibling button so navigation and task completion are separately operable by pointer, keyboard, and assistive technology.

Hover, active, focus-visible, disabled, pending, and error behavior use the existing component vocabulary across all urgency levels. Warning styling must not obscure the link hover fill or visible keyboard focus. Focus indication must remain distinguishable against both standard and strong warning surfaces in light and dark modes.

The warning icon is decorative and hidden from assistive technology because the adjacent visible `Overdue` text carries the accessible meaning. This prevents duplicate announcements while preserving the non-color visual cue.

Watered continues to provide immediate feedback through the current optimistic collapse. The feature adds no celebratory motion, confirmation modal, or extra acknowledgement step.

## 8. Content Requirements

### Due-today row

`Due today · Every N days`

### Overdue row

Warning glyph + `Overdue` + `Due <exact date> · Every N days`

### Strong-overdue row

Use exactly the same wording as the overdue row. Stronger urgency is visual, not a new content category.

### Copy rules

- Always show the exact due date for overdue tasks.
- Do not use `N days overdue`; calendar arithmetic remains exact but the interface avoids adding another dynamic phrase to scan.
- Do not use `critical`, `danger`, `neglected`, or guilt-inducing language.
- Do not round dates into vague language such as `soon` or `a while ago`.
- Keep labels in sentence case.
- Plant names are user-generated and must tolerate long words and multiple lines without displacing the action or causing horizontal overflow.

No new imagery is required. Existing plant photos and initial-letter fallbacks remain the only visual assets. The warning glyph should come from the project's existing icon vocabulary rather than a custom illustration.

## 9. Recommended Implementation References

The most valuable Impeccable references during implementation are:

- `reference/adapt.md` for 320px layouts, zoom behavior, and structural responsive decisions.
- `reference/audit.md` for contrast, non-color semantics, keyboard operation, screen-reader behavior, and reduced motion.
- `reference/polish.md` for the final light/dark, interaction-state, and visual consistency pass.

Implementation must also remain aligned with `PRODUCT.md`, `DESIGN.md`, and `context/changes/overdue-tasks-and-urgency/plan.md`.

## 10. Open Questions

None. The implementation plan and existing product and design documents settle the behavior, visual system, three-day threshold, and feature boundary.


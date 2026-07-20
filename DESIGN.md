---
name: YAPCA
description: The daily plant-care list you can actually trust — an observational field notebook for your collection.
colors:
  canopy: "oklch(0.508 0.118 165.612)"
  canopy-ink: "oklch(0.979 0.021 166.113)"
  paper: "oklch(1 0 0)"
  ink: "oklch(0.148 0.004 165)"
  muted-surface: "oklch(0.963 0.002 165)"
  muted-ink: "oklch(0.5 0.021 165)"
  hairline: "oklch(0.925 0.005 165)"
  focus-green: "oklch(0.55 0.11 165)"
  overdue-surface: "oklch(0.92 0.1 88)"
  overdue-ink: "oklch(0.4 0.11 62)"
  overdue-accent: "oklch(0.62 0.16 70)"
  destructive: "oklch(0.577 0.245 27.325)"
typography:
  display:
    fontFamily: "Figtree Variable, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Figtree Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Figtree Variable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Figtree Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Figtree Variable, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.005em"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.canopy}"
    textColor: "{colors.canopy-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  task-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0.875rem 1rem"
  overdue-badge:
    backgroundColor: "{colors.overdue-surface}"
    textColor: "{colors.overdue-ink}"
    rounded: "{rounded.sm}"
    padding: "0.125rem 0.5rem"
  plant-row-avatar:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.md}"
  journal-entry:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "0 0 1rem 0"
---

# Design System: YAPCA

## 1. Overview

**Creative North Star: "The Field Notebook"**

YAPCA is a naturalist's seasonal record, not a garden-app toy. The whole system is written against the idea of a well-kept field notebook: precise, observational, quietly authoritative — a place where a careful person records what is living, what needs tending, and what was done. Life and season are present, but they arrive through green as accent, through rhythm and legibility, never through illustration. The interface is mostly clean paper and confident ink; the canopy green appears exactly where the eye should go.

Density is calm and generous. The user opens this app standing among their plants with a watering can — sessions are short and frequent, so the primary screen answers "what today, and what did I miss?" in a single glance and then gets out of the way. Type carries the hierarchy; the palette stays restrained so the two things that matter, the plant and its urgency, are never competing with decoration for attention.

This system explicitly rejects three things. It is not a **gamified consumer app** — no streaks, XP, mascots, confetti, or badge-collecting; a person who keeps dozens of plants does not need manufactured motivation. It is not **skeuomorphic nature kitsch** — no wood textures, watercolor leaves, terracotta illustrations, or hand-drawn botanical clip-art; "botanical" is expressed through modern form and color. And it is not a **generic SaaS-cream template** — no warm off-white body, no tiny tracked-uppercase eyebrows over every section, no identical icon-card grids. The body is true white, not cream.

**Key Characteristics:**
- Editorial restraint: clean paper, confident ink, green as a deliberate accent — not a wash.
- Type-led hierarchy over decoration; one family (Figtree) does all the work.
- Urgency is unmissable but calm — the alarm is on the task, never on the whole app.
- Deterministic and honest: the UI shows exact interval arithmetic, never a fuzzy "soon."
- Botanical through color and rhythm, never through illustration.

## 2. Colors

A restrained, green-tinted neutral system anchored by a single canopy green; every neutral leans imperceptibly toward the brand's hue (OKLCH hue 165) so the surface reads cohesive and alive rather than clinical-blue or cream.

### Primary
- **Canopy Green** (`oklch(0.508 0.118 165.612)`): The one voice of the system. Used for the primary action ("Watered"), the current selection, focus, and living-state accents — never as a decorative fill or a full-bleed background. Its rarity is what makes it read.
- **Canopy Ink** (`oklch(0.979 0.021 166.113)`): The near-white foreground that sits on canopy green for button labels and selected states.

### Neutral
- **Paper** (`oklch(1 0 0)`): True white body and card background. Deliberately not cream — cream is the SaaS-template tell this system rejects.
- **Ink** (`oklch(0.148 0.004 165)`): Near-black primary text. 19.7:1 on paper.
- **Muted Ink** (`oklch(0.5 0.021 165)`): Secondary text — timestamps, intervals, journal metadata. Deliberately darkened to the ink end (from the shadcn default) so it clears 4.5:1 on both paper (5.9:1) and muted surfaces (5.3:1). Light gray "for elegance" is forbidden.
- **Muted Surface** (`oklch(0.963 0.002 165)`): The second neutral layer — quiet panels, hover fills, the dormant-season backdrop.
- **Hairline** (`oklch(0.925 0.005 165)`): Borders, dividers, input strokes. A whisper, not a rule.

### Semantic
- **Focus Green** (`oklch(0.55 0.11 165)`): The focus ring. Botanical rather than the default gray, and legible at 4.6:1 on paper so keyboard focus is always obvious.
- **Overdue Surface** (`oklch(0.92 0.1 88)`) / **Overdue Ink** (`oklch(0.4 0.11 62)`) / **Overdue Accent** (`oklch(0.62 0.16 70)`): The amber overdue container — soft surface, deep readable ink (7.4:1), and a stronger accent for the icon and leading marker. Amber, not red: overdue is urgent, not an error.
- **Destructive** (`oklch(0.577 0.245 27.325)`): Reserved strictly for irreversible, damaging actions — delete plant, delete account. Never used for overdue.

### Named Rules
**The One Voice Rule.** Canopy green is the only saturated color on a normal screen, and it appears on ≤10% of it — primary action, selection, focus, living accent. If green is spreading into backgrounds or decoration, it has stopped being a voice and become noise.

**The Amber-Not-Red Rule.** Overdue is amber; destruction is red. An overdue task is a nudge, not a failure — never dress it in destructive red, and never let red and amber appear as if they mean the same thing.

### Dark Mode
The system ships a `prefers-color-scheme: dark` palette, not just a light theme: paper inverts to near-black ink (`oklch(0.148 0.004 165)`), card/popover surfaces sit one step up (`oklch(0.218 0.008 165)`), and canopy green desaturates and lightens slightly (`oklch(0.432 0.095 166.913)`) so it stays legible without glowing on dark ink. Overdue amber shifts to a deeper surface with a lighter ink for the same reason. The same hue-165 tint carries through every neutral in both modes — dark mode is a tonal inversion of the field notebook, not a different product.

## 3. Typography

**Display / Body / Label Font:** Figtree Variable (with `sans-serif` fallback)

**Character:** One humanist-geometric sans carries the entire system — headings, labels, body, data. Figtree is friendly without being cute and clean without being cold, which is exactly the register a field notebook wants: legible first, personable second. No display face, no pairing; contrast comes from weight and size, not from a second family.

### Hierarchy
- **Display** (600, 1.875rem/30px, 1.15, -0.01em): The one big number/heading per screen — "Today," the count of what's due. Used once, at the top.
- **Headline** (600, 1.5rem/24px, 1.2): Section headers, plant name on the detail view.
- **Title** (600, 1.125rem/18px, 1.3): The plant name in a task row, card headers.
- **Body** (400, 1rem/16px, 1.5): Default reading text and prose, capped at 65–75ch for any real paragraph (empty-state copy, help text).
- **Label** (500, 0.8125rem/13px, +0.005em): Buttons, metadata, interval chips, journal timestamps. Sentence case.

### Named Rules
**The One Family Rule.** Figtree does everything. Reaching for a second font — a serif for "editorial feel," a mono for "data" — is forbidden; hierarchy is weight and size, not typeface. A display font in a button or a data label is a defect.

**The Sentence-Case Rule.** Labels and buttons are sentence case. No tiny tracked-uppercase eyebrows — that scaffold is the SaaS-template tell, and it is banned here.

## 4. Elevation

Flat by default, with tonal layering doing the work that shadows would. Depth is communicated by the green-tinted neutral ramp — paper against muted-surface against hairline borders — not by drop shadows. This keeps the field-notebook flatness and avoids the lifted-card look. Shadows appear only as a transient response to state: a soft, low shadow on an actively dragged or elevated element (a popover, a menu, a toast), never at rest.

### Shadow Vocabulary
- **Popover / Menu** (`box-shadow: 0 4px 16px oklch(0.148 0.004 165 / 0.10)`): For genuinely floating, dismissible surfaces only — dropdowns, date/interval pickers, the undo toast.

### Named Rules
**The Flat-Paper Rule.** Task rows, cards, and panels are flat at rest — separated by tone and hairline, never by shadow. If a resting surface has a drop shadow, it is wrong. Shadow is a state (floating), not a style.

## 5. Components

Every interactive component ships its full state set: default, hover, focus-visible, active, disabled, and — where it loads or errors — loading and error. Half a component is not shippable.

### Buttons
- **Shape:** Gently curved (`0.5rem`/8px radius, `{rounded.md}`).
- **Primary:** Canopy green fill, canopy-ink label, `0.5rem 1rem` padding. This is "Watered" — the affirmative act of care.
- **Hover / Focus:** Hover deepens the green (~10% darker); focus shows the focus-green ring (`2px`, offset `2px`). Transitions 150–200ms, ease-out; state only, never decorative.
- **Ghost / Secondary:** Transparent on paper, ink label, hairline border for secondary actions ("Postpone 2 days"); muted-surface fill on hover. Destructive actions use a ghost button with destructive-colored text, promoted to a destructive fill only inside a confirmation.

### Inputs / Fields
- **Style:** Paper background, hairline border, `0.5rem`/8px radius, `0.5rem 0.75rem` padding. Placeholder uses muted-ink (which clears 4.5:1 — never a lighter gray).
- **Focus:** Border shifts to focus-green plus a matching ring; no glow.
- **Error / Disabled:** Error border in destructive with a text message below (never color alone). Disabled drops to muted-surface with muted-ink text and `not-allowed` cursor.

### Task Row (signature component)
- The heart of the daily list. A flat row: optional plant thumbnail, plant name (Title), the interval/last-watered metadata (Label, muted-ink), and the two actions (primary "Watered", ghost "Postpone").
- **Overdue variant:** The row gains the overdue treatment — an overdue-accent leading marker (a filled dot or a warning glyph), an **"Overdue"** text label, and an overdue-surface tint. Urgency is carried by icon **and** label **and** color together, never color alone.
- **On action:** The row animates out (crossfade/collapse, 200ms) and the undo toast appears. `prefers-reduced-motion` collapses it instantly.

### Overdue Badge
- **Style:** Overdue-surface fill, overdue-ink text, `0.375rem`/6px radius, tight `0.125rem 0.5rem` padding, paired with a warning glyph. The compact form of the amber urgency cue used inline.

### Navigation
- A single hairline-bottomed bar on paper: wordmark left, "Today" and "All plants" as ghost-button links, sign-out folded to the end. No pill/underline active indicator — the current page is marked with `aria-current="page"` and relies on the same ghost hover/focus states as any other link, keeping the bar quiet.
- **Style:** Paper background, hairline border-bottom, ghost-button links at label size.

### Plant Row (signature component)
- The row used in "All plants" and as the header of a plant's detail view: a square photo thumbnail (or a muted-surface initial-letter fallback) at `0.5rem`/8px radius, paired with the plant name (Title) and its interval + due-date metadata (Label, muted-ink) on one line, joined by `·`.
- **List context:** Rows sit in a hairline-divided list (top and bottom border, divider between items — no per-row card, no shadow), each a full-row link with a muted-surface hover fill and a visible focus outline.
- **Detail context:** The same avatar scales up (`h-24 w-24` to `h-32 w-32`) and sits beside the name as a headline instead of a title, with a "Back to all plants" ghost link above it.

### Journal Timeline
- A reverse-chronological list under the plant detail view's "Watering journal" headline: each entry is a hairline-bottomed row (no border on the last entry) showing the date watered, the "Watered" event label, and the date it had been scheduled for — plain Body/Label text, no icons or badges, because a past event isn't urgent.
- **Empty:** "No waterings yet" plus a one-line nudge back to the daily list, matching the Empty States tone below rather than a bare blank panel.

### Empty & Loading States
- **Empty:** Teaches the interface, never a bare "nothing here." A clear day shows a calm "All watered — nothing due today" with the quiet satisfaction of a cleared notebook page; an empty collection invites "Add your first plant."
- **Loading:** Skeleton rows shaped like task rows, not a centered spinner.

## 6. Do's and Don'ts

### Do:
- **Do** keep canopy green to ≤10% of any screen — primary action, selection, focus, living accent. Its rarity is the point (The One Voice Rule).
- **Do** convey overdue with icon **and** label **and** amber together, so it survives color blindness and never depends on color alone.
- **Do** use amber (`overdue-*`) for urgency and red (`destructive`) only for irreversible damage — keep the two meanings visually distinct (The Amber-Not-Red Rule).
- **Do** darken secondary text to muted-ink (`oklch(0.5 …)`); verify any text on a tinted surface clears 4.5:1 before shipping.
- **Do** carry hierarchy with Figtree weight and size alone (The One Family Rule).
- **Do** keep surfaces flat at rest; reserve shadow for genuinely floating elements (The Flat-Paper Rule).
- **Do** give every action a one-tap undo and pair it with the journal — fast, confident tapping is only safe because it is reversible.

### Don't:
- **Don't** build a gamified consumer app: no streaks, XP, mascots, confetti, or badge-collecting. This is a quiet tool.
- **Don't** use skeuomorphic nature kitsch — no wood textures, watercolor leaves, terracotta/soil illustrations, or hand-drawn botanical clip-art. Botanical means form and color, not pictures.
- **Don't** ship the generic SaaS-cream template: no warm off-white body (the body is true white), no tiny tracked-uppercase eyebrows, no identical icon-card grids.
- **Don't** put muted-ink body text on the muted surface below 4.5:1, and never use a lighter gray "for elegance."
- **Don't** round "next due" into a vague "soon" — show the exact date/interval; the deterministic schedule is the product.
- **Don't** dress overdue in destructive red, and don't let green spread into decorative backgrounds.
- **Don't** introduce a second font family or a display face in buttons, labels, or data.
- **Don't** put a resting drop shadow on task rows, cards, or panels.

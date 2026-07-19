# Product

## Register

product

## Platform

web

## Users

A single kind of user: the hobbyist plant owner with a sizable collection — dozens or more houseplants at home. Their collection has outgrown memory: every plant wants water on its own cadence, and tracking it all in their head is what causes over- and under-watering. They reach for YAPCA at one specific moment — the daily watering decision — opening it to answer "what needs water today, and what did I miss?" and to record what they've done. It is a private, authenticated, single-owner tool: each user sees only their own plants and history, with no roles, sharing, or admin surface. Sessions are short and frequent; the person is standing among their plants with a watering can, not sitting down to study a dashboard.

## Product Purpose

YAPCA turns the daily "what do I water today?" decision into a single, trustworthy list. A user adds each plant with a name, a growing-season interval, a dormancy-season interval, and an optional photo; the app derives the active season from the calendar, computes each plant's next-due date, and surfaces everything due today plus anything still overdue as one list. Marking a plant "Watered" reschedules it exactly one interval from the day it was actually watered; "Postpone 2 days" nudges a single task forward without disturbing its cadence; a misclick is always recoverable by undo. Each plant carries a watering journal — the record undo reverses. Success is the core loop working end-to-end without error and the interval math being exactly predictable: a plant set to "every 3 days" vanishes when watered and returns exactly three days later. It is deliberately a personal foundation, not a differentiated product — the whole point of the MVP is that the loop is dependable.

## Positioning

The daily plant-care list you can actually trust, because the schedule is exact arithmetic — not a fuzzy estimate — and it quietly follows each plant's growing and dormancy seasons on its own.

## Brand Personality

Alive and botanical, carried with editorial restraint. The product should feel like tending something living and seasonal — greenery, growth, and the turn of the year are present in structure, color, and rhythm, not in illustration. Quietly confident and unhurried: it recedes so the plants and the act of caring come forward. The voice is plain and human, never cutesy and never corporate. Watering a plant should feel like a small, satisfying act of care, and clearing the day's list should feel calmly complete — earned rest, not a reward animation.

## Anti-references

- **Gamified consumer apps** (Duolingo-style streaks, XP, mascots, confetti, badge-collecting). YAPCA is a quiet tool for someone who already cares about their plants; it does not manufacture motivation.
- **Skeuomorphic nature kitsch** — wood textures, watercolor leaves, realistic soil-and-terracotta illustrations, hand-drawn botanical clip-art. "Botanical" is expressed through modern form and color, never garden-app twee.
- **Generic SaaS-cream template** — warm off-white body background, tiny tracked-uppercase eyebrows over every section, identical icon-card grids, the default AI-generated look.

## Design Principles

The interface disappears into the daily glance. The primary job on the primary screen is "what today, and what did I miss?" answered in one look; everything else is secondary and gets out of the way.

Botanical through structure, not decoration. Life and season are carried by color, spacing, and rhythm — never by literal leaf illustrations or textures. Restraint is what keeps "alive" from becoming kitsch.

Overdue is unmissable without shouting. Urgency is conveyed by icon and label as well as color (never color alone), and it stays legible while the rest of the surface stays calm — the alarm is on the task, not the whole app.

Deterministic and honest. The UI reflects exact interval arithmetic; it never rounds "next due" into a vague "soon," and changing an interval visibly recalculates. Trust in the schedule is the product.

Season is ambient, not a setting. The growing/dormancy rhythm is derived and felt in the moment, so the daily use stays zero-effort; the user acts on tasks, not on configuration.

Every action is reversible. Marking watered and postponing are one-tap and undoable; the journal is the safety net that makes fast, confident tapping safe.

## Accessibility & Inclusion

Target WCAG 2.2 AA, with deliberate care beyond the minimum where the product leans on it. Body text meets ≥4.5:1 contrast (large/bold text ≥3:1), including placeholders; focus is always visible and keyboard operation is complete. The overdue urgency cue is load-bearing, so it is never conveyed by color alone — always paired with an icon, label, or shape — and the palette is checked for color-blind safety. Motion conveys state only and every animation has a `prefers-reduced-motion` alternative (crossfade or instant), treated as first-class rather than an afterthought.

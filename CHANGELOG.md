# Changelog

## 0.3.0 - 2026-08-03

- Theme system with rosa paleta tokens, dark mode toggle (light/dark/auto-detect), and inline anti-flash script.
- Guided 5-step tutorial overlay with spotlight and `prefers-reduced-motion` support.
- Per-tab contextual help modal (X / Escape / backdrop dismiss).
- Renamed `recipes` → `templates` across DB schema, repositories, server actions, validators, and app folder (`/recipes` → `/templates`, with 308 redirects for backward compat).
- Dynamic state-driven plantillas workspace with create/duplicate/delete and live per-template cost summary (materiales, mano de obra, overhead, costo total, sugerido).
- Inline editable bulk-discount editor in calculator (descuento % + aplica desde N unidades) with live totals.
- Mobile polish: safe-area-inset-bottom, 44×44 touch targets, hover-gated effects, focus trap.
- Accessibility pass: focus-visible across interactive elements, aria-labels on icon-only buttons, axe-core clean.

## 0.2.0 - 2026-07-31

- Introduced the pink-and-cream visual system and responsive application navigation.
- Refined the presentation of the authenticated dashboard, public pages, and authentication flow.
- Improved materials, recipes, and quotes presentation across list, form, and detail experiences.
- Added authenticated responsive visual end-to-end coverage for the completed visual system.
- Added support for running Neon integration tests against an isolated test branch.

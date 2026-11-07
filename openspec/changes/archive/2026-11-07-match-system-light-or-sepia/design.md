## Context

See proposal.md for motivation. `src/lib/theme.ts` currently stores a single `ThemeChoice` under `marginalia:theme`. Its inline initialization script and runtime resolver independently implement Light/Dark system matching. A shared external store keeps controls and tabs synchronized. Appearance offers manual theme preview radios and a native checkbox; the header always selects a manual theme.

This change spans initialization, runtime state, and settings, so their behavior must be designed together.

## Goals / Non-Goals

**Goals:** Keep initialization and runtime resolution equivalent, retain existing browser preferences, and distinguish the light-side setting from the theme currently displayed.

**Non-Goals:** Server-side or account preferences, new palettes, changes to the header's manual selection semantics, or a configurable dark-side theme.

## Decisions

### Store the light-side preference separately

Keep `marginalia:theme` and its existing values unchanged. Add `marginalia:system-light-theme`, accepting only `light` or `sepia` and defaulting to `light`. Cache this alongside the choice in the external store, expose a hook and setter, and reset both in the existing test reset helper. Updating the preference must not change `ThemeChoice`.

A separate key avoids migrating existing values or breaking consumers that expect the existing string. A combined object or new `system-sepia` choice would couple the pairing to mode selection and require migration. Guard reads and writes independently, keep session changes in memory when writes fail, and handle storage events for either key and full storage clearing.

### Resolve both paths with the same rules

Extend resolution to accept the light-side preference with a Light default. Manual choices win; otherwise dark OS preference resolves to Dark and light OS preference resolves to the configured light-side theme. Update the head script to validate and read both keys and apply identical resolution, `data-theme`, `color-scheme`, and theme-color metadata. Sepia retains a light color-scheme.

Keep the small self-contained head script rather than deferring to hydration, which could flash Light before Sepia. Unit tests must compare initialization and runtime outcomes across the preference matrix.

### Add an explicit light-side selector

Retain the three manual preview cards and their current behavior. Beneath the Match my system checkbox, show a compact native radio group labeled "Light appearance" only when matching is enabled, with Light and Sepia options and helper text explaining that Dark follows the system. This group reflects the stored preference even when the displayed theme is Dark. Manual preview or header selection disables matching without overwriting the light-side preference. Disabling the checkbox freezes the resolved theme; re-enabling restores the remembered pairing.

Reusing the manual preview cards to edit the pairing was considered, but would make their meaning depend on matching mode and leave Dark ambiguous. A separate group preserves established behavior.

### Style a semantic checkbox with existing tokens

Keep a native checkbox with a full clickable label. Visually style its indicator using a peer or equivalent native-input pattern: theme-aware surface and border, amber checked fill, contrasting checkmark, and focus-visible ring. Use the existing token palette and a minimum 44px label height. Preserve native keyboard, checked state, and forced-colors usability; the checkmark must not be the only accessible state signal. Do not introduce a custom ARIA checkbox or a new UI dependency.

## Risks / Trade-offs

- [Initialization/runtime drift] -> Cover both paths with the same resolution matrix and browser first-frame checks for system Sepia.
- [Two keys can update separately] -> Each key represents an independent setting, validate separately and sync on either key; no transactional migration is needed.
- [Controls confuse current and preferred themes] -> Keep a separate labeled preference group and test dark-system configuration explicitly.
- [Custom indicator loses accessibility] -> Retain native input semantics, keyboard focus, label targeting, and a forced-colors check during visual verification.

## Migration Plan

No data migration is required. Existing manual themes remain manual; existing system users continue with Light/Dark until they explicitly select Sepia. Deploy the runtime, inline initializer, and controls together. Rollback ignores the new key and returns system matching to Light/Dark while preserving existing manual choices.

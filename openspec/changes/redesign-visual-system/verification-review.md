# Visual system verification

## Resumed work

The interrupted session had completed the screen redesigns, dashboard correction,
header-matching app icons, book-slot thumbnails, and fixed dialog footer. The
remaining dialog regression clipped the keyboard-focused Start button behind that
footer in a 360 by 500 viewport.

Commit `d4b34ac` adds scroll padding to the dialog body and scroll margin to its
buttons so native focus scrolling exposes the whole action and its focus ring.

## Verification

- Type checking passed (existing route-file warnings remain).
- Unit suite: 80 files, 882 tests passed.
- Integration suite: 37 files, 478 tests passed, one skipped.
- Existing theme, book-header, and dashboard-hero browser suites: nine passed.
- Main visual matrix: 117 passed, nine login checks skipped on the passwordless
  instance. Those nine checks passed separately on the protected instance, so
  all 126 visual scenarios have passing coverage across the two runs.
- Protected login matrix: nine passed across light, sepia, dark and 1440, 390,
  360 pixel widths.
- Biome checks on the changed component and visual suite passed.
- Repository-wide Biome with formatting disabled passed for 358 files. Default
  lint still fails on inherited formatting differences, including CRLF files.

The visual suite selects existing content using read-only database connections.
It captures each screen at 1440 and 390 pixels in every theme, checks horizontal
overflow at 360 pixels, checks citation bottom sheets at both phone widths, and
checks draft-only keyboard access to Start at 360 by 500 without submitting chat
or saving reading positions. Images and traces stay under ignored `test-results/`.
Login requires a separate protected instance when the main instance is passwordless.
The temporary protected instance was stopped after verification. Tasks 4.13 and
6.2 are complete. Screenshots are in `test-results/visual-system/chromium/`;
the main run artifacts are in `test-results/visual-system-resumed-run/`.

## Remaining scope

- Task 1.2 remains open for the previously documented sepia amber-soft contrast
  decision; the existing contrast tests do not prove that pair meets 4.5:1.
- Task 1.3 remains open because its default-lint acceptance criterion fails.
- Task 6.1 requires the complete application E2E suite; the focused suites above
  do not establish that all application E2E scenarios pass.
- Optional tasks 5.1 through 5.6 remain unimplemented and unchecked.

The earlier groups-1-3 review is a historical checkpoint. This report records the
later verification without rewriting that checkpoint.

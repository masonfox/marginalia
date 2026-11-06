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
- Repository-wide default `pnpm lint` now passes for 358 files. An explicit
  `.gitattributes` LF policy and normalization to existing index content resolve
  inherited CRLF formatter failures without a mass formatting content diff.
- Expanded contrast suite: 170 tests passed, covering tinted surfaces and nested
  Contents markers in all three themes. Type checking and targeted Biome passed.
  Light amber foreground changes from `#9a520f` to `#98500f`, and sepia from
  `#8f4f12` to `#844412`; fills and the dark theme remain unchanged. These minimal
  deviations from the mockup satisfy the controlling AA requirement. Sepia
  soft/page contrast rises from 4.465069 to 5.223382; nested marker/page contrast
  rises from 3.866414 to 4.523056. Light nested marker/page is 4.523802 and dark
  is 6.395048. This token coverage is not a full rendered accessibility audit.
- Full configured `pnpm test:e2e`: 191 passed, zero failures, two passwordless
  scenarios skipped on the protected instance; both passed separately. All 193
  configured scenarios have passing coverage, with no flaky tests. The affected
  phone header regression and three short-height theme checks also passed.
  `pnpm build`, targeted Biome and diff checks passed.

## Full E2E follow-up

Updated outdated copy/role selectors and layout assertions for the redesigned
scrolling shelf, multiline conversation previews, active tabs, scope pills, and
Start conversation action. Keyboard menu checks now assert each navigation step;
filter scroll checks allow a one-pixel scroll-offset rounding tolerance.

A genuine long-title phone regression was found: the conversation header grew
to 683 pixels. Restoring `max-sm:truncate` on its heading keeps the phone title on
one line while preserving full title text and its title attribute.

The final invocation was `pnpm test:e2e --reporter=line,json
--output=test-results/e2e-isolated-definitive/artifacts`, run through an isolated
local harness. It used a fresh disposable pgvector container, temporary storage,
the repository Manifesto EPUB and generated reading-unit fixtures, local Guide
and citation fixtures, and fake chat streams with no real provider credentials.
The final app ran on port 4326; passwordless coverage ran separately on 4318.
All owned servers, containers and temporary directories were removed. The user
database, storage and server on port 3000 were not targeted. The detailed report
is `test-results/e2e-isolated-definitive/report.json` (ignored local artifact).
`titles.spec.ts` is excluded by the existing default Playwright configuration
and is not included in the 193 configured scenarios.

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

- Tasks 1.2 and 1.3 are complete after expanded contrast verification and the LF
  policy fix. The earlier review's contrast and formatting blockers are resolved.
- Task 6.1 is complete after the isolated full configured E2E run and separate
  passwordless coverage. All required tasks are complete (25 of 31 total).
- Optional tasks 5.1 through 5.6 remain unimplemented and unchecked.

The earlier groups-1-3 review is a historical checkpoint. This report records the
later verification without rewriting that checkpoint.

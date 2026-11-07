# Groups 1–3 review checkpoint

Stopped before group 4. No screen redesigns or optional group 5 features were implemented, and no previous provider session was resumed.

## Commits

- `685bfcf` — shared scope/citation/progress pieces, typeset covers, full/compact book heroes, and their existing call sites.
- `76aa06e` — responsive app shell, theme controls, root font/theme integration, and targeted E2E assertions. This follows the shared commit so the new-conversation composer has all imports available.
- Earlier foundations and planning remain `19aabc7` and `63a3e1f`.

## Verification

- `pnpm test:unit`: 78 files, 866 tests passed.
- `pnpm typecheck`: passed (existing route-file warnings remain).
- `pnpm exec biome check --formatter-enabled=false`: 353 files passed.
- Protected server targeted header/phone run: 7 passed, including desktop 640/768/1024, phone menu/keyboard theme/logout and conversation-list horizontal overflow.
- Earlier broader run also passed the 1280px header and conversation phone control scenarios.
- `e2e/theme.spec.ts` and `e2e/book-header.spec.ts`: 5 passed, covering local font delivery, first-frame sepia, live OS changes, stored system choice, and long book-position labels across widths.
- Separate unprotected server: notice/Set one navigation passed. The temporary server on 3108 was stopped; the coordinator-owned 3107 server remains running.
- Full group 6 suites and screen screenshot matrix were intentionally not run.

## Fixes during verification

- Cover sampling now keys samples and callback attachment by edition ID, removes stale load listeners, and resamples when navigating books in the same mounted hero. A component regression test verifies navigation changes the tint.
- Failed import badges retain error ink rather than being overridden with processing ink.
- Long hidden accessible book descriptions are anchored within their row; their previous static absolute position caused actual horizontal overflow at 360px.
- Phone logout E2E uses keyboard activation after focus to avoid clicking through an opening menu/navigation animation.
- The E2E login helper supports passwordless instances so the unprotected notice can be tested.

## Remaining review decisions

Tasks 2.1–3.3 are verified and checked. Tasks 1.2 and 1.3 were reopened rather than claiming full compliance:

- Exact mockup sepia amber foreground on amber-soft over the page is approximately 4.47:1, below the 4.5:1 requirement. The existing contrast suite covers text on page/card and primary surface pairs, but does not cover amber-soft; its passing result must not be presented as proving every actual pairing. Exact design colors were preserved as instructed; a palette/spec decision is required before closing 1.2.
- Default `pnpm lint` fails on widespread inherited CRLF formatter differences, including untouched `biome.json`. Formatter-disabled lint passes. No unrelated formatting sweep was performed; 1.3 remains open because its literal default-lint criterion is not met.

Other inherited review notes remain: additional scrim/shadow tokens follow mockups; unavailable status maps to amber; JavaScript-disabled fallback is light. Settings Appearance/system-choice UI remains part of group 4, and the optional group 5 exploration remains historical only.

Groups 4–6 remain unchecked and untouched in scope. Review is required before beginning group 4.

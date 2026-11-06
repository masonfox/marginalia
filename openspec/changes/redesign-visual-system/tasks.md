## 1. Foundations

- [x] 1.1 Add self-hosted fonts (Cormorant Garamond 500/600, Instrument Sans 400–600, Newsreader 400 + italic, Latin subset, `font-display: swap`) and set `--font-sans`, `--font-serif` (display), and new `--font-reading` in `@theme inline`; verify no request leaves the instance for fonts (network tab / e2e request assertion)
- [ ] 1.2 Rewrite `src/styles.css` tokens for `[data-theme="light"]`, `[data-theme="sepia"]`, `[data-theme="dark"]` per design §1, keeping shadcn variable names and adding `--background-2`, `--faint-foreground`, `--amber`, `--amber-foreground`, `--amber-soft`, `--shadow-cover`; verify a unit test computes WCAG contrast for every text/background pair in all three themes and requires ≥ 4.5:1
- [ ] 1.3 Replace the `.dark` custom variant with `[data-theme="dark"]` and add a `sepia` variant; review the existing `dark:` usages; verify `pnpm typecheck` and `pnpm lint` pass
- [x] 1.4 Add a `theme` module (read/write `localStorage["marginalia:theme"]`, resolve `system` via `matchMedia`, listen for OS changes) and an inline head script in `__root.tsx` that sets `data-theme`, `color-scheme`, and `theme-color` before paint; verify an e2e test that a stored `sepia` renders sepia on first paint with no light/dark frame, and that `system` follows an emulated `prefers-color-scheme` change
- [x] 1.5 Retune `components/ui` (button variants incl. destructive-outline, badge as dot+word, card, input, dialog, dropdown) to the mockup styles; verify existing component tests pass

## 2. App shell

- [x] 2.1 Header per mockups: logo mark + display wordmark, nav pills, theme switch (segmented, `aria-pressed`), primary New conversation, Settings icon; slim unprotected notice with "Set one" link; verify `home-nav.test.tsx` and the responsive-layout scenarios still pass
- [x] 2.2 Compact header below `sm`: theme choice inside the menu (three options, current marked); verify at 360px header is one row and theme can be changed from the menu by keyboard

## 3. Shared pieces

- [x] 3.1 Scope pill, citation marker (default/active/unverified), status badge, eyebrow, and progress bar components or utility classes per `Main.dc.html`; replace ad-hoc equivalents
- [x] 3.2 Typeset cover fallback in `book-cover.tsx` (palette indexed by title hash, title + surname, spine shading) and `--shadow-cover` on all covers; verify a component test that the same title always gets the same color and that real cover images are unaffected
- [x] 3.3 Book hero (full and compact variants) with cover-tinted backdrop and amber tab underline; verify tabs keep `aria-current` and keyboard behavior

## 4. Screens (match the named mockup in each theme)

- [x] 4.1 Dashboard (`Dashboard.dc.html`): continue-reading hero, recent conversations rows, nightstand shelf, library counts
- [x] 4.2 Library (`Library.dc.html`): heading row with Scan folder / Upload EPUB, search, filter pills with counts, cover grid with status, processing and needs-attention cards
- [x] 4.3 Conversations (`Conversations.dc.html`): date groups, book filter pills, rows with meta column
- [ ] 4.4 Book Discuss (`BookDiscuss.dc.html`): composer card with footer bar, scope note with Update, conversation list
- [ ] 4.5 Book Guide (`BookGuide.dc.html`): Chapters/Index/Notes segmented control, numbered chapter summaries in reading face with citations, locked "past your position" row, index tags
- [ ] 4.6 Book Contents (`BookContents.dc.html`): read/current/later states, "Your position" marker, in-book search
- [ ] 4.7 Book About (`BookAbout.dc.html`): description in reading face, Guide preparation card, file card, details and identifiers cards, delete zone
- [ ] 4.8 Conversation (`Conversation.dc.html`): title header, book/scope/model/cost row, user bubbles, research trail pill, answer typography with inline quotes, citation popover, streaming state, composer
- [ ] 4.9 New conversation dialog (`NewConversation.dc.html`): book slots with scope selects, scope listbox, add-book slot, question field, model chip, Cancel / Start
- [ ] 4.10 Reader (`Reader.dc.html`): chapter title, reading-face text column, reference gutter, margin glosses column (stacks below `lg`), highlighted passage, selection toolbar, section nav
- [ ] 4.11 Settings (`Settings.dc.html`): side nav, Appearance (theme cards + Match my system), providers list, default models, library folder, access warning
- [ ] 4.12 Log in (`Login.dc.html`): centered wordmark, password field, error state, fanned covers backdrop
- [ ] 4.13 Phone layouts (`MobileDashboard.dc.html`, `MobileConversation.dc.html`): verify each screen above at 360 and 390px with no horizontal scroll; citation opens as a bottom sheet on phones

## 5. Optional additions (each group independent)

- [ ] 5.1 Discuss: starter prompt chips that fill the composer
- [ ] 5.2 Discuss: "Who's who" card from Guide characters within the bound, and "Your latest note" card
- [ ] 5.3 Conversation: Sources column listing cited passages with verified / not-found state
- [ ] 5.4 Conversation: callout style for a counter-reading section in replies
- [ ] 5.5 Reader toolbar text size and gloss toggle; Settings reading size and typeface
- [ ] 5.6 Phone bottom tab bar (Home, Library, Ask, Chats)

## 6. Verification

- [ ] 6.1 Update e2e and component tests broken by markup changes, preferring role/text selectors; verify `pnpm test` and `pnpm test:e2e` pass
- [ ] 6.2 Add a Playwright screenshot pass of each screen in light, sepia, and dark at 1440 and 390 widths for review against the mockups

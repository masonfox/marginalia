## Context

The mockups in `mockups/*.dc.html` are the visual source of truth. Each file is a self-contained HTML page (written for a design canvas, so it uses `{{holes}}`, `<sc-for>`, `<sc-if>` and a small `class Component` at the bottom; read these as React-like templates, not runnable pages). The `<helmet><style>` block at the top of each file holds the full token set and component classes, identical across files. `Main.dc.html` is the design-system overview.

| Mockup | Screen | Shown in |
| --- | --- | --- |
| `Main.dc.html` | Design system overview | dark |
| `Dashboard.dc.html` | `/` | dark |
| `Library.dc.html` | `/library` | dark |
| `Conversations.dc.html` | `/conversations` | sepia |
| `BookDiscuss.dc.html` | `/books/$id` (Discuss) | sepia |
| `BookGuide.dc.html` | `/books/$id/guide` | light |
| `BookContents.dc.html` | `/books/$id/contents` | dark |
| `BookAbout.dc.html` | `/books/$id/about` | sepia |
| `Conversation.dc.html` | `/c/$id` | dark |
| `NewConversation.dc.html` | New conversation dialog | dark |
| `Reader.dc.html` | `/p/$locator` | sepia |
| `Settings.dc.html` | `/settings` | light |
| `Login.dc.html` | `/login` | dark |
| `MobileDashboard.dc.html` | `/` at 390px | dark |
| `MobileConversation.dc.html` | `/c/$id` at 390px, citation open | sepia |

Book data, counts, summaries, and Moby-Dick text in the mockups are sample content. Match the layout, hierarchy, and styling, and keep the app's real data and copy unless a copy change is listed below.

## Decisions

### 1. Tokens

Keep the shadcn variable names (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, `--border`, `--ring`, …) so `components/ui` keeps working, and set them from the palette below. Add the few extra tokens the mockups need.

| Mockup token | Role | Dark | Sepia | Light |
| --- | --- | --- | --- | --- |
| `--bg` → `--background` | page | `#0d0a08` | `#f2e8d6` | `#faf8f4` |
| `--bg2` (new `--background-2`) | bands, notice bar, composer footer | `#120e0b` | `#ebdfc9` | `#f3efe8` |
| `--surface` → `--card`, `--popover` | cards, dialogs, inputs | `#18130f` | `#f8f1e4` | `#ffffff` |
| `--surface2` → `--secondary`, `--muted`, `--accent`(shadcn) | hover, chips, user bubbles | `#221c16` | `#ecdfc8` | `#f2eee7` |
| `--line` → `--border` | hairlines | `rgba(255,236,214,.09)` | `rgba(74,50,26,.13)` | `rgba(30,22,14,.09)` |
| `--line2` → `--input` | input borders, outline buttons | `rgba(255,236,214,.17)` | `rgba(74,50,26,.24)` | `rgba(30,22,14,.17)` |
| `--ink` → `--foreground` | text | `#f5efe6` | `#2a1d12` | `#17120d` |
| `--muted` → `--muted-foreground` | secondary text | `#b3a99c` | `#665341` | `#655c52` |
| `--faint` (new `--faint-foreground`) | meta text, eyebrows | `#8f8578` | `#725f4c` | `#736a5f` |
| `--accent` (new `--amber`) | fills: progress, active tab underline | `#f0a556` | `#c9822f` | `#e0923f` |
| `--accent-text` (new `--amber-foreground`) | amber text on page bg | `#f3b06a` | `#8f4f12` | `#9a520f` |
| `--accent-soft` (new `--amber-soft`) | scope pill, citation marker bg | `rgba(240,165,86,.14)` | `rgba(176,108,36,.15)` | `rgba(224,146,63,.15)` |
| `--primary` | primary button bg | `#f0a556` | `#2a1d12` | `#17120d` |
| `--primary-ink` → `--primary-foreground` | primary button text | `#1a0f05` | `#f8f1e4` | `#faf8f4` |
| `--hl` → `--highlight` | highlighted passage | `rgba(240,165,86,.2)` | `rgba(214,150,62,.3)` | `#fbe3bd` |
| `--ok` → `--status-finished` | verified, finished | `#8cc49a` | `#3d6b3f` | `#2f6b3c` |
| `--info` → `--status-processing` | processing | `#93b8de` | `#355d86` | `#2f5f91` |
| `--bad` → `--destructive-foreground`, `--status-failed` | errors, unverified quotes | `#ec9580` | `#9c3a22` | `#a63a26` |
| `--status-reading` | reading | = `--amber-foreground` | | |
| `--status-not-started` | not started | = `--faint-foreground` | | |
| `--cshadow` (new `--shadow-cover`) | cover shadow | see mockup | | |

Note the shadcn `--accent` is a hover surface, not the amber; don't conflate them. `--ring` should be the amber at ~50%.

Radii: `--radius: 0.625rem` stays; cards use 16px, buttons 10px, pills `rounded-full`, covers `3px 7px 7px 3px`.

All text pairs above pass WCAG AA 4.5:1 on `--background` and `--card` in their theme. Keep it that way if values change (add a unit test that computes contrast for the token table).

### 2. Theme selection and no-flash

- Attribute: `data-theme="light|sepia|dark"` on `<html>`. Replace `@custom-variant dark (&:is(.dark *))` with `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` and add a `sepia` variant the same way.
- Stored choice: `localStorage["marginalia:theme"]` = `"light" | "sepia" | "dark" | "system"` (default `"system"`). `"system"` resolves to light or dark from `prefers-color-scheme` and follows OS changes live (`matchMedia` listener).
- An inline script in `<head>` (before CSS paints) reads the key and sets `data-theme` and `color-scheme`. Wrap storage access in try/catch; fall back to system.
- `<meta name="theme-color">` updated to the theme's `--background`.
- Header switch: a three-button segmented control (sun / open book / moon) with `aria-pressed`, see any mockup header. Below `sm` it collapses into the menu as a three-option row (or a single cycling icon button as in `MobileDashboard.dc.html`).
- Settings › Appearance: three preview cards (radio group) plus "Match my system" checkbox. Unchecking it pins the current theme; picking Sepia unchecks it.

### 3. Type

- Display: Cormorant Garamond 600 (500 for numerals), `letter-spacing: -0.015em`, `line-height: 1.02`. Sizes: page h1 `clamp(48px, 5vw, 68px)`, book hero h1 `clamp(48px, 5.6vw, 80px)`, section h2 28–40px.
- Interface: Instrument Sans 400/500/600. Body 15px, meta 12.5–13px, eyebrows 11px 600 uppercase `letter-spacing: .14em` in `--faint-foreground`.
- Reading: Newsreader (optical size axis) 400, italic for inline quotes. Reader body 20px / 1.72, adjustable 16–26px.
- Replace `--font-serif` in `@theme inline` with Cormorant; add `--font-reading` for Newsreader; set `--font-sans` to Instrument Sans. Audit the 24 current `font-serif` uses: titles stay serif (display), passage text moves to `font-reading`.

### 4. Shared pieces (see `Main.dc.html` "Pieces")

- **Header**: logo mark (amber page-with-margin SVG) + "Marginalia" in display 27px; nav links as 14px/500 with a `--secondary` pill for current; right side: theme switch, primary "New conversation", Settings icon button. The unprotected notice becomes a slim `--background-2` bar with an amber dot and a "Set one" link to Settings.
- **Scope pill**: amber-soft background, amber text, 11.5px 600 uppercase, bookmark icon, "THROUGH …". Used everywhere a reading bound is shown.
- **Citation marker**: 19px round amber-soft badge with the number; active state is solid amber. Unverified quotes: `--destructive-foreground` tint and a wavy underline on the quote.
- **Status badge**: colored dot + word, no filled pill.
- **Buttons**: primary, secondary (`--secondary`), outline (`--input` border), ghost, destructive-outline; 40px min height (44 on touch).
- **Book hero**: cover (196px) with `--shadow-cover`, a radial tint derived from the cover's dominant color behind it, title, author, scope pill + progress bar, tabs underlined in amber. Compact variant (64px cover, 40px title) for Guide and About.
- **Typeset cover**: `book-cover.tsx` fallback when no image: background from a fixed palette indexed by a hash of the title, title in display, author's surname in small caps, spine shading via a pseudo-element.

### 5. Optional additions

Each is a separate task group in `tasks.md` and can be skipped without affecting the rest:
- Discuss: starter prompt chips under the composer; "Who's who" card listing Guide characters within the bound; "Your latest note" card.
- Conversation: right-hand Sources column listing each cited passage with verified / not found state; "Where the text pushes back" callout styling when the reply contains a counter-reading section.
- Reader: text size control and margin-gloss toggle in a toolbar; Settings reading size and typeface.
- Phone: bottom tab bar (Home, Library, Ask, Chats) replacing the header menu for navigation.

## Risks

- Contrast regressions when tuning colors: mitigated by the token contrast test.
- Third-party fonts add weight: subset to Latin, `font-display: swap`, preload only Instrument Sans 400/600 and Cormorant 600.
- Tests that select by Tailwind class names will break; prefer role/text selectors when updating them.

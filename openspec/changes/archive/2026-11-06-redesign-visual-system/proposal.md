## Why

Marginalia works, but it looks like an unstyled shadcn starter: a cool blue-grey zinc palette, system fonts, and flat bordered boxes everywhere. Nothing about it says "books." The reader wants it bold and focused but approachable, in the spirit of Omnibus (omnibus-library.github.io/omnibus): warm near-black and paper tones, a serif voice for titles, covers given room to breathe. Readers also read for long stretches at night and by day, so light, dark, and sepia should be first-class display modes, not just the OS dark setting.

## What Changes

- **New visual system.** Warm palette (near-black `#0d0a08`, paper, brown ink) with a single amber accent reserved for the reading position, citations, and the primary action. Defined as tokens in `src/styles.css`, mapped onto the existing shadcn variable names so every component picks it up.
- **Three themes: light, sepia, dark.** A theme switch in the header (and in Settings › Appearance). By default the app follows the OS light/dark setting; choosing a theme overrides it and is remembered in this browser. Sepia is always an explicit choice. No flash of the wrong theme on load.
- **Three typefaces, one job each.** Cormorant Garamond for display (page and book titles, section headings), Instrument Sans for the interface and the assistant's prose, Newsreader for the book's own words (reader, quotes, cited passages). Self-hosted; no requests to Google Fonts at runtime.
- **Every screen restyled** to the mockups in `mockups/`: app shell, Dashboard, Library, Conversations, book page (Discuss, Guide, Contents, About), conversation view, New conversation dialog, reader, Settings, Log in, and phone layouts.
- **Typeset covers** for books with no cover image: a colored cover with the title and author, its color derived from a hash of the title.
- **Optional additions shown in the mockups** (each is its own task group so it can be dropped): starter prompts on Discuss, a "Who's who" Guide panel on Discuss, a Sources column in conversations, a "Where the text pushes back" callout style, reading text size and typeface settings, and a bottom tab bar on phones.

Non-goals: changing routes, data, or server behavior (except where an optional addition needs data that already exists); a per-account theme stored on the server; custom user themes; a logo redesign beyond the header mark shown in the mockups.

## Capabilities

### New Capabilities
- `visual-theme`: Light, sepia, and dark themes; how the theme is chosen, remembered, and applied before first paint; the typefaces and what each is used for; contrast requirements.

### Modified Capabilities
- `responsive-layout`: The compact header gains the theme control; optional phone tab bar.
- `library-browsing`: Covers without an image get a typeset cover.

## Impact

- **Styles**: `src/styles.css` tokens rewritten for three themes; `@custom-variant dark` switches from `.dark` to `[data-theme="dark"]`; ~12 `dark:` usages and ~24 `font-serif` usages reviewed.
- **Root**: `__root.tsx` sets `data-theme` on `<html>` from an inline head script before paint, loads fonts, and renders the switcher in `AppShell`.
- **Components**: `components/ui/*` variants retuned (button, badge, card, input, dialog, dropdown); `book-cover.tsx` gains the typeset fallback; most page components get layout and class changes only.
- **Dependencies**: `@fontsource-variable/instrument-sans`, `@fontsource-variable/newsreader`, `@fontsource/cormorant-garamond` (or equivalent self-hosted woff2 files under `public/`).
- **Tests**: e2e and component tests that assert on class names or copy may need updates; add a test for theme persistence and no-flash.

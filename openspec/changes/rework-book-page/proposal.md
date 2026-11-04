## Why

The book page reads like a catalog record: identifiers, parser version, sources, and a delete button fill the first screen, while the things a reader opens a book for (picking up a conversation, asking something new, checking how far they have read) are a click away or at the bottom. Conversations live on a separate page, the reading position is a card halfway down, and every new conversation goes through a dialog that asks "How far have you read?" again. On a phone the first screen is the cover and the instance banner. Marginalia is about conversation, so the book page should be where conversation starts.

## What Changes

- **Book page becomes a conversation landing page (Discuss).** At the top, a composer: typing a question and sending creates a conversation and opens it with that message sent. Under it, the book's conversations, most recent first, each with a one-line preview of its last message and a `...` menu for rename and delete.
- **Reading progress is always visible.** A shared book header (cover, title, authors, reading position with a progress bar) appears on every book tab. The composer has a strip at the top showing the bound the next conversation will use, with an **Update** control to change it before sending.
- **Choose the bound in the composer.** By default, a new conversation is scoped to the reading position. The Update control can save a new reading position (the default) or set a scope only for this conversation, leaving the position alone. When no position is set, the first send asks for one before creating the conversation.
- **Book tabs: Discuss, Guide, Contents, About.** Each tab is a route. Existing URLs keep working: Discuss is `/books/$editionId`, the Guide keeps `/books/$editionId/guide/*`, and two new routes are added: Contents (table of contents and in-book search) and About (description, metadata, sources, parser version, Delete book). Preprocessing moves into the Guide tab, the guide it builds.
- **BREAKING (URLs):** `/books/$editionId/conversations` redirects to `/books/$editionId`, and `/books/$editionId?q=` redirects to the Contents tab with the same query.
- **Mobile-friendly layout** throughout: a compact app header, a smaller unprotected-instance notice, a two-column library grid, no horizontal scrolling at 360px, touch-sized targets, and a conversation header that collapses on small screens.
- The new-conversation dialog stays for starting a conversation from a passage, where the choices depend on the passage.

Non-goals: a conversation sidebar in the chat view; cross-book "recent conversations" on the library page (tracked in issue #38); visual rebranding.

## Capabilities

### New Capabilities
- `responsive-layout`: Mobile-friendly layout rules for the app shell and every page (minimum width, touch targets, compact header and notices, collapsing headers).

### Modified Capabilities
- `library-browsing`: The book detail page is split into a shared header and Discuss / Guide / Contents / About tabs. Search moves to Contents, deletion to About, and preprocessing to the Guide. The conversations entry point becomes the inline composer and list, the reading position moves into the header with progress, and old URLs redirect.
- `literary-conversations`: A book's conversation list is shown on the book page and includes a last-message preview. The separate conversation list page is retired.
- `reading-scope`: A conversation can be started from the book page composer, where the bound defaults to the reading position and can be changed before sending, either for this conversation only or by saving a new position.
- `reading-position`: The position is the default scope of a conversation started from the book page and can be set from the composer. It is shown with progress in the book header.
- `book-guide`: The Guide is a tab of the book page and hosts preprocessing status and actions.

## Impact

- **Routes**: `books.$editionId.tsx` becomes a layout route (shared header and tabs) with an index route for Discuss. The Guide routes move under the layout with unchanged URLs. New `contents` and `about` routes. The `conversations` route becomes a redirect.
- **Components**: a new book-page composer built from the existing `composer/` parts, a position strip and sheet that reuse `ScopeChoices` and the reading-position save logic, a conversation list row with a preview and an actions menu, and the book header with progress. `PreprocessCard` moves to the Guide layout. `NewConversationDialog` stays for passage starts.
- **Server**: `listConversationsForEdition` returns a last-message preview. Creating a conversation and sending its first message reuse `createConversationFn` and the chat endpoint, with no new endpoint. The first message is handed to the conversation page through the existing draft storage.
- **Data**: no migration.
- **Tests**: e2e flows that go through `/conversations`, the dialog from the book page, or search on the book page need updating.

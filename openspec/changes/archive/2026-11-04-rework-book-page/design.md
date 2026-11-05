## Context

See proposal.md for motivation. The relevant code today:

- `src/routes/books.$editionId.tsx` is a single leaf route that renders everything: metadata, sources, delete, reading position card, preprocess card, search (`?q=`), and the table of contents.
- The guide routes are flat siblings (`books.$editionId_.guide*.tsx`; the trailing `_` opts out of nesting), and each renders its own `GuideFrame` with a back link and an `<h1>Guide</h1>`.
- `books.$editionId_.conversations.tsx` lists conversations and hosts `NewConversationDialog`.
- The conversation composer (`src/components/composer/`, `useComposer`) is tied to a conversation id: tab-session drafts in `sessionStorage` (`composerDraftKey`), passage checks, quotes, and the passage-view handoff.
- `ReadingPositionCard` owns the save logic for the reading position: forward-only, a `move_back` confirmation, `stale_scope` re-fetch, and the shared-position caveat.
- `createConversationFn({ editionId, scope, selection? })` creates a conversation with a provisional title. The first message is sent from `/c/$id` with `useChat`.
- Messages store AI SDK `parts` as `json`, with a unique `(conversation_id, seq)` index. Assistant text carries `[[cite …]]` markers (`parseCitationMarkers`).

Constraints: no new dependencies unless needed, no migration, and every existing URL keeps working (the guide's are linked from notes and glosses).

## Goals / Non-Goals

**Goals:**
- One book header and tab bar shared by every book tab, mounted once so it does not flicker or refetch between tabs.
- Starting a conversation from the book page takes one action when the position is set.
- One implementation of "save the reading position", used by the header, the composer, and anything later.

**Non-Goals:**
- Reworking the inside of the guide views, the passage view, or the conversation thread.
- Changing how conversations are titled, scoped, or streamed on the server.
- A design system overhaul. Existing shadcn/ui components and Tailwind tokens stay.

## Decisions

### 1. The book page becomes a layout route; tabs are child routes

```
routes/
  books.$editionId.tsx              layout: loader (edition), header, tab bar, <Outlet/>
  books.$editionId.index.tsx        Discuss   /books/$id
  books.$editionId.contents.tsx     Contents  /books/$id/contents?q=
  books.$editionId.about.tsx        About     /books/$id/about
  books.$editionId.guide.tsx        Guide layout (bound bar, Chapters/Index/Notes nav,
  books.$editionId.guide.*.tsx        preprocess status) - renamed from `_` siblings,
                                      same URLs
  books.$editionId_.conversations.tsx   beforeLoad -> redirect to /books/$id
```

The `_`-suffixed guide files are renamed to nest under the layout. URLs do not change, only the file names. `GuideFrame`'s back link and `<h1>` are removed, because the shared header replaces them. The index route keeps `validateSearch({ q })` only to redirect `?q=` to `/contents?q=` in `beforeLoad`.

*Alternative:* keep flat routes and render a shared `<BookFrame>` in each. Rejected: the header would remount and refetch on every tab change, and the frame would be repeated in about ten files.

The tab bar is a `<nav>` of `Link`s with `aria-current="page"` (the router's `activeProps`). They are links, not ARIA tabs, because each tab is a page with its own URL. The Guide link is active for every `/guide/*` path.

### 2. Layout per breakpoint

```
< sm (phone)                         >= lg (desktop)
+---------------------------+        +--------+----------------------------+
| [cv] Title                |        | cover  | Discuss Guide Contents About|
|      Author               |        | Title  |----------------------------|
|      [bk] Through X  [v]  |        | Author |  <Outlet/>                 |
|      [====>.....] 12/28   |        | [bk] X |                            |
| Discuss Guide Contents .. |        | [==>.] |                            |
|---------------------------|        | sticky |                            |
| <Outlet/>                 |        +--------+----------------------------+
+---------------------------+
```

Between sm and lg, the phone layout is used with a larger cover. On desktop the header becomes a sticky left rail. Nothing new is needed: these are Tailwind `sm:`/`lg:` grid changes on the layout route.

### 3. One reading-position hook shared by the header and the composer

Extract the save, move-back, and stale handling from `ReadingPositionCard` into `useReadingPosition(editionId)`. It returns `{ position, units, progress, save(choice), clear(), pendingMoveBack, confirmMoveBack(), error }` and keeps the query keys `["reading-position", id]` and `["reading-units", id]`. The header control and the composer's scope sheet both use it, so a save from either one updates the other through the shared query cache. That is how the header "updates as soon as the position changes anywhere on the page".

Progress comes from the reading units: `index + 1` of `units.length`, and the bar is `endPosition / last.endPosition`. That is a share of passages, as the spec says, and it needs no extra query. The units are fetched eagerly for ready editions (today they load lazily when a picker opens). The list is small and cached.

### 4. The composer's scope state

```
            +----------------------+
            |  position (server)   |  unset | unit | finished
            +----------+-----------+
                       |
          override?    v
   +-------------------+-----------------+
   | none -> scope = positionChoice      |
   | one-off {choice,label} -> scope =   |
   |   override, shown "this conv. only" |
   |   + [Use my position]               |
   +-------------------------------------+
```

`override` is component state. It is not persisted, so it is discarded when the reader leaves the page. The scope sheet is `ScopeChoices` plus a two-option radio (Save as my reading position / Only for this conversation) and the shared caveat. On confirm:

- *Save*: `save(choice)`. A `move_back` result shows the existing confirmation. Success clears `override`.
- *Only this conversation*: set `override`. No server call.

Send with an unset position opens the same sheet with `pendingSend = true`. Confirming runs the action above and then continues the send. Dismissing clears `pendingSend`. The typed text is component state and is never cleared by the sheet.

The sheet is the existing `Dialog`, styled as a bottom sheet below `sm` (`fixed bottom-0 inset-x-0 rounded-t-lg max-h-[85dvh] overflow-y-auto`). A drawer library (vaul) was considered and rejected: one more dependency for one sheet.

### 5. Sending the first message: create, then hand off through the draft store

```
book composer                         /c/$id
-------------                         ------
createConversationFn(scope, model)
  -> { id }
saveComposerDraft(id, {text})
navigate(/c/$id, state:{autoSend})--> useComposer restores draft
                                      if state.autoSend && messages.length===0
                                        submit once; replace history state
```

This reuses the existing draft restoration and submit path, including the AI-not-configured and model-unavailable checks. If the auto-send cannot happen (the state is lost, the model became unavailable, or the reader reloads), the question is still in the composer and nothing is lost or sent twice. Two guards prevent a double send: `messages.length === 0`, and a router history `state` flag, which back/forward and reload do not replay. A search param was rejected because it would show in the URL and survive a reload.

*Alternative:* a server function that creates the conversation and sends the first message in one call. Rejected: it would duplicate the streaming and persistence path in `/api/chat`.

The book composer reuses the presentational parts (`AutogrowTextarea`, `SendButton`, keyboard behavior) but not `useComposer`, because there are no attachments, quotes, or passage checks before a conversation exists. Its text is saved to `sessionStorage` under a book key (`composer-draft:book:<editionId>`, through the same `composer-draft` helpers), so a half-written question survives switching tabs.

### 6. List preview: SQL picks the message, TypeScript makes the text

`listConversationsForEdition` gains a lateral subquery. It takes the latest message (by `seq` desc, using the existing unique index) whose `parts` contain a non-empty `text` part, and returns `left(string_agg(text), 600)` from `json_array_elements(parts)`. A pure function `previewText(raw)` in `src/lib/` removes citation markers (`parseCitationMarkers`), markdown syntax (emphasis, headings, list and quote markers, code fences, link targets), and collapses whitespace. The row truncates with CSS (`truncate`) and renders as a text node.

*Alternative:* return the last few messages' `parts` and pick in TypeScript. Rejected: more data on the wire for every list.

### 7. Conversation rows and the actions menu

`RenameConversation` and `DeleteConversation` move behind a `...` `DropdownMenu`. The shadcn dropdown is added if it is not already in `components/ui`; it is built on Radix, which the project already uses for dialogs. The whole row is a link, and the menu trigger stops propagation.

### 8. App shell and conversation header on phones

- Header: icon buttons (`Settings`, `LogOut`) below `sm`, with `aria-label`s.
- Unprotected notice: shorter copy below `sm` ("No password set: anyone with access can use this instance."), on one line with `truncate` and the full sentence in `title`. It stays visible, as instance-access requires.
- Chat header below `sm`: title and book on one line each. Scope, widen, and model controls go into a `<details>`-style disclosure ("Scope and model") so they cost no height until opened. Composer docking uses `dvh` units so the input stays above the on-screen keyboard.

## Risks / Trade-offs

- [Renaming guide route files breaks imports and `Link to` strings] → TanStack's typed routes make this a compile error, so fix them until `tsc` passes. URLs are unchanged, so stored links in notes and glosses still resolve.
- [Auto-send fires twice, or never] → Two guards (history state and zero messages), and the fallback is a restored draft, never a lost question. An e2e test covers reloading right after landing.
- [Position saved, then conversation creation fails] → Acceptable: the reader chose to save it. The error is shown and the question stays in the composer.
- [The "this conversation only" option confuses readers] → The default is save. The composer labels the one-off scope and offers "Use my position" to undo it.
- [Eagerly loading reading units costs a query per book page] → Units are small and cached by React Query. Not-ready editions skip it.
- [e2e churn: tests use "Start conversation", `/conversations`, and `?q=` on the book page] → Update them in the same change. The redirects keep old deep links working for readers.
- [Preview SQL on large conversations] → It is limited to one message per conversation through the `(conversation_id, seq)` index, and the text is capped at 600 characters.

## Migration Plan

No data migration. Ship as one release. The redirects for `/books/$id/conversations` and `/books/$id?q=` keep bookmarks working. Roll back by reverting. Nothing is persisted in a new shape except the book-composer draft key in `sessionStorage`, which older code ignores.

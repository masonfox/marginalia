# responsive-layout Specification

## Purpose
Keeps every Marginalia page usable on a phone as well as on a desktop browser, so reading and conversation work from whatever device the reader has at hand.

## Requirements

### Requirement: Usable at phone widths
Every page SHALL be usable at viewport widths from 360 CSS pixels up, with no horizontal page scrolling. Long unbroken text such as identifiers, file names, and URLs SHALL wrap or be truncated with the full value available. Controls that take a pointer or touch SHALL have a target of at least 44 by 44 CSS pixels on touch devices. Dialogs and choice sheets SHALL fit within the viewport and scroll within themselves when their content is taller.

#### Scenario: Book page on a phone
- **WHEN** a reader opens any tab of a book page at 360 pixels wide
- **THEN** nothing extends past the right edge of the viewport and no horizontal scroll bar appears

#### Scenario: Long identifier
- **WHEN** the About tab shows an identifier longer than the viewport is wide
- **THEN** it wraps within the page

#### Scenario: Long chapter list
- **WHEN** a reader opens the scope choices for a book with 200 reading units on a phone
- **THEN** the choices scroll within the sheet and its actions stay reachable

### Requirement: Compact app header
On narrow viewports the app header SHALL take one row holding the app name, an icon-only New conversation control, and an icon-only menu button, each with an accessible name ("New conversation" and "Menu"). The menu button SHALL expose whether the menu is open. The menu SHALL list Dashboard, Library, and Conversations, with the current page marked visibly and for assistive technology, followed by Settings and, when a password is set, Log out. Its items SHALL be touch-sized and operable by keyboard and touch. Choosing an item, pressing Escape, or tapping outside the menu SHALL close it, and closing it with Escape SHALL return focus to the menu button. On wider viewports the header SHALL take one row, with the navigation beside the app name and the New conversation, Settings and, when a password is set, Log out controls on the right, and SHALL NOT show the menu button. The notice that the instance has no password SHALL remain visible on every page, and on narrow viewports SHALL take no more than one line of text.

#### Scenario: Header on a phone
- **WHEN** a reader opens the dashboard at 360 pixels wide
- **THEN** the header is one row with the app name and the controls announced as "New conversation" and "Menu", and no navigation entries or Settings control are shown outside the menu

#### Scenario: Navigate from the menu
- **WHEN** a reader on a phone opens the menu and selects Library
- **THEN** the menu closes and the Library page opens

#### Scenario: Current page in the menu
- **WHEN** a reader on a phone opens the menu on the conversations page
- **THEN** Conversations is marked as the current page, and on a book's page no entry is marked

#### Scenario: Settings and log out in the menu
- **WHEN** a reader on a phone opens the menu on an instance with a password
- **THEN** the menu offers Settings and Log out after the navigation entries, and selecting Log out ends the session

#### Scenario: Close with Escape
- **WHEN** a keyboard user opens the menu and presses Escape
- **THEN** the menu closes and focus returns to the menu button

#### Scenario: Header on a desktop
- **WHEN** a reader opens the dashboard at 1280 pixels wide
- **THEN** the app name, the Dashboard, Library, and Conversations entries, and the New conversation and Settings controls share one row, and no menu button is shown

#### Scenario: Unprotected notice stays visible
- **WHEN** an instance without a password is opened on a phone
- **THEN** the notice that the instance has no password is shown on one line

### Requirement: Library grid on small screens
The library list SHALL show at least two books per row at 360 pixels wide. The status filters SHALL stay on one row and scroll horizontally when they do not fit, and the upload action SHALL remain reachable without scrolling the page sideways.

#### Scenario: Library on a phone
- **WHEN** a reader opens the library at 360 pixels wide
- **THEN** books are shown two per row and every status filter can be reached

### Requirement: Book page on small screens
On narrow viewports the book page header SHALL show a small cover beside the title, authors, and reading position, and the tab bar SHALL stay on one row, scrolling horizontally when needed. On wide viewports the header MAY sit beside the tab content. Conversation rows SHALL keep their actions in one actions control, so a long title does not push them off the row.

#### Scenario: Composer near the top on a phone
- **WHEN** a reader opens a ready book's Discuss tab on a phone held upright
- **THEN** the book's title, reading position, and composer are visible without scrolling

#### Scenario: Long conversation title
- **WHEN** a conversation's title is longer than the row is wide
- **THEN** the title is truncated and the actions control stays on the row

### Requirement: Conversation view on small screens
On narrow viewports the conversation view's header SHALL show the title and the book on one line each, with the scope and model controls in a menu or a collapsed area that the reader can open. The composer SHALL remain at the bottom of the viewport, including while the on-screen keyboard is open.

#### Scenario: Conversation on a phone
- **WHEN** a reader opens a conversation at 360 pixels wide
- **THEN** the header does not take more than a quarter of the viewport height and the scope and model controls are reachable from it

#### Scenario: Typing on a phone
- **WHEN** a reader focuses the message input on a phone and the on-screen keyboard opens
- **THEN** the input stays visible above the keyboard

### Requirement: Theme control on every width
The theme control SHALL be reachable from every page at every width. On wider viewports it SHALL sit in the header as a three-option control. On narrow viewports it SHALL be offered inside the header menu (or as a single control that cycles light, sepia, dark), with a touch target of at least 44 by 44 CSS pixels and an accessible name that states the current theme.

#### Scenario: Change theme on a phone
- **WHEN** a reader at 360 pixels wide opens the header menu and chooses Dark
- **THEN** the dark theme is applied and the header is still a single row

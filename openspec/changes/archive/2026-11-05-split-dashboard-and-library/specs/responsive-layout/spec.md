## MODIFIED Requirements

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

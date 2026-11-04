## MODIFIED Requirements

### Requirement: Compact app header
On narrow viewports the app header SHALL take one row: the app name and icon-only controls for New conversation, Settings and, when a password is set, log out, each with an accessible name. The notice that the instance has no password SHALL remain visible on every page, and on narrow viewports SHALL take no more than one line of text.

#### Scenario: Header on a phone
- **WHEN** a reader opens the library at 360 pixels wide
- **THEN** the header fits on one row, the Settings control is announced as "Settings", and the New conversation control is announced as "New conversation"

#### Scenario: Unprotected notice stays visible
- **WHEN** an instance without a password is opened on a phone
- **THEN** the notice that the instance has no password is shown on one line

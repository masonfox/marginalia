## MODIFIED Requirements

### Requirement: Compact app header
On narrow viewports the app header SHALL take two rows: the first holds the app name and icon-only controls for Settings and, when a password is set, log out, each with an accessible name; the second holds the Dashboard and Conversations navigation, both entries on that one row. On wider viewports the header SHALL take one row, with the navigation beside the app name. The notice that the instance has no password SHALL remain visible on every page, and on narrow viewports SHALL take no more than one line of text.

#### Scenario: Header on a phone
- **WHEN** a reader opens the library at 360 pixels wide
- **THEN** the app name and the Settings control share the first row, the Settings control is announced as "Settings", and Dashboard and Conversations share a second row below it

#### Scenario: Header on a desktop
- **WHEN** a reader opens the library at 1280 pixels wide
- **THEN** the app name, the navigation, and the Settings control share one row

#### Scenario: Unprotected notice stays visible
- **WHEN** an instance without a password is opened on a phone
- **THEN** the notice that the instance has no password is shown on one line

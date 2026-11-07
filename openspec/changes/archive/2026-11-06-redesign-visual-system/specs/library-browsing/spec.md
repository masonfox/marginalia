## ADDED Requirements

### Requirement: Typeset cover when there is no cover image
When an edition has no cover image, the system SHALL show a typeset cover in its place: a solid color with the title and author set on it. The color SHALL be chosen from a fixed palette by the title, so the same book always gets the same cover. Typeset covers SHALL keep the 2:3 proportion of real covers and SHALL expose the book title as their accessible name.

#### Scenario: Book without a cover
- **WHEN** the library shows a book whose EPUB has no cover image
- **THEN** a colored cover with its title and author is shown in the grid

#### Scenario: Stable color
- **WHEN** the same coverless book appears on the dashboard and in the library
- **THEN** its typeset cover has the same color in both places

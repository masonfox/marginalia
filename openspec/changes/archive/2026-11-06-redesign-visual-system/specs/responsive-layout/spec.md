## ADDED Requirements

### Requirement: Theme control on every width
The theme control SHALL be reachable from every page at every width. On wider viewports it SHALL sit in the header as a three-option control. On narrow viewports it SHALL be offered inside the header menu (or as a single control that cycles light, sepia, dark), with a touch target of at least 44 by 44 CSS pixels and an accessible name that states the current theme.

#### Scenario: Change theme on a phone
- **WHEN** a reader at 360 pixels wide opens the header menu and chooses Dark
- **THEN** the dark theme is applied and the header is still a single row

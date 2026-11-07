## ADDED Requirements

### Requirement: Light, sepia, and dark themes
The system SHALL offer three display themes: light, sepia, and dark. Every page, dialog, menu, and sheet SHALL render correctly in each theme. Text SHALL meet a contrast ratio of at least 4.5:1 against its background in every theme, and large display text (24px and up) at least 3:1.

#### Scenario: Switch theme from the header
- **WHEN** a reader chooses Sepia in the header theme control
- **THEN** the page switches to the sepia theme without reloading, and the control marks Sepia as selected for assistive technology

#### Scenario: Contrast in every theme
- **WHEN** the token contrast test runs
- **THEN** every foreground/background token pair in light, sepia, and dark meets its required ratio

### Requirement: Theme choice and persistence
By default the theme SHALL follow the operating system's light or dark preference and change when that preference changes. When a reader chooses a theme, the choice SHALL be remembered in that browser and override the system preference until the reader chooses "Match my system" again. Sepia SHALL only be used when chosen. The remembered theme SHALL be applied before the first paint, so a page never flashes another theme on load. When browser storage is unavailable, the system preference SHALL be used.

#### Scenario: Follow the system
- **WHEN** a reader who has never chosen a theme opens Marginalia on a device set to dark mode
- **THEN** the dark theme is shown

#### Scenario: Remembered choice
- **WHEN** a reader chooses Sepia and later reloads or opens another page
- **THEN** the sepia theme is shown from the first frame

#### Scenario: Back to system
- **WHEN** a reader turns on "Match my system" in Settings › Appearance
- **THEN** the theme follows the operating system again

### Requirement: Typefaces by role
The interface SHALL use a sans-serif interface face for controls, labels, and the assistant's prose; a serif display face for page titles, book titles, and section headings; and a reading face for the book's own words, including the reader, quoted passages, and cited passages. Fonts SHALL be served by the instance itself, with no requests to third-party font services.

#### Scenario: Quote stands apart
- **WHEN** an assistant reply quotes the book
- **THEN** the quoted words are set in the reading face and the surrounding reply in the interface face

#### Scenario: No third-party font requests
- **WHEN** any page loads
- **THEN** no request is made to a host other than the instance for fonts

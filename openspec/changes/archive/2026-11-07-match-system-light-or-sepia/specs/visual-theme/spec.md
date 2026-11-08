## MODIFIED Requirements

### Requirement: Theme choice and persistence
By default the theme SHALL follow the operating system's light or dark preference and change when that preference changes. Readers SHALL be able to choose Light or Sepia as the light-side theme in Settings > Appearance while Match my system is enabled; the dark-side theme SHALL always be Dark. The light-side preference SHALL default to Light and SHALL be remembered independently of manual theme choices. When a reader chooses a manual theme, the choice SHALL be remembered in that browser and override the system preference until the reader chooses "Match my system" again. Sepia SHALL only be used when chosen manually or as the system light-side preference. The remembered theme and light-side preference SHALL be applied before the first paint, so a page never flashes another theme on load. Missing or invalid light-side preferences SHALL fall back to Light. When browser storage is unavailable, the system preference with Light as its light-side theme SHALL be used on load; changes made during the page session SHALL remain usable without throwing. Preference changes SHALL synchronize across open tabs in the same browser.

#### Scenario: Follow the system
- **WHEN** a reader who has never chosen a theme opens Marginalia on a device set to dark mode
- **THEN** the dark theme is shown

#### Scenario: Remembered choice
- **WHEN** a reader chooses Sepia and later reloads or opens another page
- **THEN** the sepia theme is shown from the first frame

#### Scenario: Back to system
- **WHEN** a reader turns on "Match my system" in Settings > Appearance
- **THEN** the theme follows the operating system again using the remembered Light or Sepia preference for light mode

#### Scenario: Default system light mode
- **WHEN** a reader without a configured light-side preference uses Match my system on a light-mode device
- **THEN** the Light theme is shown

#### Scenario: Choose Sepia while following the system
- **WHEN** a reader selects Sepia as the light-side preference with Match my system enabled on a light-mode device
- **THEN** Sepia is applied immediately and Match my system remains enabled

#### Scenario: System transitions with Sepia selected
- **WHEN** a reader using the Sepia/Dark pairing changes the device preference from light to dark and back to light
- **THEN** the page changes to Dark and then Sepia without reloading

#### Scenario: Configure the light side during dark mode
- **WHEN** a reader using Match my system on a dark-mode device chooses a different light-side preference
- **THEN** the page remains Dark and uses the new preference when the device returns to light mode

#### Scenario: Remember the system pairing before paint
- **WHEN** a reader with Match my system and the Sepia light-side preference reloads on a light-mode device
- **THEN** Sepia is applied from the first frame

#### Scenario: Manual selection and restoration
- **WHEN** a reader with the Sepia light-side preference chooses a manual theme from the header or Appearance and later enables Match my system again
- **THEN** the manual theme overrides system changes until system matching is restored, and the Sepia light-side preference is retained

#### Scenario: Disable system matching
- **WHEN** a reader turns off Match my system
- **THEN** the currently displayed theme becomes the manual choice

#### Scenario: Invalid preference or unavailable storage
- **WHEN** the saved light-side preference is invalid or browser storage cannot be read on load
- **THEN** system matching uses Light for light mode and Dark for dark mode without an error

#### Scenario: Another tab changes the preference
- **WHEN** another tab changes the light-side preference to Sepia while this tab follows a light-mode system
- **THEN** this tab updates its preference control and displayed theme to Sepia

## ADDED Requirements

### Requirement: Accessible branded system appearance controls
Settings > Appearance SHALL present Match my system as a labeled checkbox using the application's warm surface, border, and amber selection tokens, with an explicit checkmark and visible keyboard focus. While system matching is enabled, a separate labeled Light/Sepia choice SHALL identify the preferred light-side theme without confusing it with the currently displayed theme. Controls SHALL be readable in all three themes, expose their checked or selected states to assistive technology, and support keyboard interaction and a label click target at least 44px high.

#### Scenario: Keyboard interaction
- **WHEN** a reader focuses Match my system using the keyboard and presses Space
- **THEN** its checked state toggles, focus remains visible, and assistive technology can determine the updated state

#### Scenario: Light-side choice while the page is dark
- **WHEN** Match my system is enabled on a dark-mode device
- **THEN** Appearance shows Dark as the current theme and separately exposes the selected Light or Sepia light-side preference

#### Scenario: Theme-aware checkbox styling
- **WHEN** Appearance is viewed in Light, Sepia, or Dark
- **THEN** the checkbox uses theme tokens with a distinguishable border, amber checked state, checkmark, and visible focus treatment

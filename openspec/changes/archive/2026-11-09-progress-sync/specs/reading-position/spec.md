## MODIFIED Requirements

### Requirement: Forward-only with explicit move back
A reader setting the position to a later unit, or to finished, SHALL take effect immediately. A reader setting it to an earlier unit SHALL require the reader to confirm a move back, for example for a re-read. The reader SHALL be able to clear the position back to unset. The position SHALL NOT change automatically when passages are opened, searched, or cited. A position applied by progress sync SHALL take effect immediately in either direction, with no confirmation, because the provider is the authority for synced books.

#### Scenario: Move forward
- **WHEN** the position is Chapter 12 and the reader sets Chapter 15
- **THEN** the position becomes Chapter 15 with no confirmation

#### Scenario: Move back needs confirmation
- **WHEN** the position is Chapter 15 and the reader chooses Chapter 3
- **THEN** the system asks for confirmation, and the position stays at Chapter 15 unless the reader confirms

#### Scenario: Reading a later passage does not advance
- **WHEN** the reader opens a passage in Chapter 30 from a search while their position is Chapter 12
- **THEN** the position stays at Chapter 12

#### Scenario: Sync moves back without confirmation
- **WHEN** the position is Chapter 15 and a sync applies a reading that maps to Chapter 3
- **THEN** the position becomes Chapter 3 with no confirmation

## ADDED Requirements

### Requirement: Position source
Each position SHALL record its source: set by hand, or applied by a named provider. A synced position SHALL also record the raw provider reading and the time it was applied. When the reader sets a synced book's position by hand, its source SHALL become manual until the next applied reading. The position control SHALL show a synced position's source, its raw reading, and how long ago it was applied, for example "synced from Hardcover · 42% · 2h ago". When the last sync moved the position earlier, the control SHALL say so and name the previous unit. This SHALL hold even when the sync cleared the position to unset.

#### Scenario: Synced position shown
- **WHEN** Hardcover's reading of 42% set the position to Chapter 11 two hours ago
- **THEN** the position control reads Chapter 11 and shows that it was synced from Hardcover at 42%, 2 hours ago

#### Scenario: Move back shown
- **WHEN** a sync moved the position from Chapter 14 back to Chapter 2
- **THEN** the position control says it moved back from Chapter 14

#### Scenario: Move back to unset shown
- **WHEN** a re-read reported at 3% moved the position from Chapter 14 back to unset
- **THEN** the position control shows no position, says it was synced from the provider at 3%, and says it moved back from Chapter 14

#### Scenario: Manual edit on a synced book
- **WHEN** the reader sets a synced book's position by hand
- **THEN** the control shows the position as set by hand until a sync applies a new reading

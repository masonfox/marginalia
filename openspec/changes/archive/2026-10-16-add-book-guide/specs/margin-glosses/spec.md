## Purpose

Shows, in the passage reader, what the guide knows about the people, places, and things on the page. Each gloss is bounded by the passage on screen, so nothing beyond it is revealed.

## ADDED Requirements

### Requirement: Subject mentions in the passage reader
When an edition has current preprocessing, the passage reader SHALL mark mentions of subjects in the displayed passages. Matching SHALL be deterministic and SHALL make no model call. A mention SHALL match a name observed for a subject that has at least one observation visible at that passage's bound, or an alias of such a subject that is revealed at that bound. Matching SHALL compare whole words and the observed letter case. Only the first mention of each subject in the displayed range SHALL be marked. Names shorter than three characters SHALL NOT be matched.

#### Scenario: Mention marked
- **WHEN** a displayed passage in Chapter 9 contains "Brawne", and "Brawne Lamia" has observations in Chapters 1 to 8
- **THEN** the first "Brawne" in the displayed range is marked as a gloss

#### Scenario: First chapter
- **WHEN** a passage in the first reading unit is displayed
- **THEN** no mentions are marked, because no unit ends at or before it

### Requirement: Gloss bound is the passage on screen
Each passage's gloss bound SHALL be that passage's own reveal position. It SHALL NOT be the furthest passage the reader has opened, nor the reading position. Gloss content SHALL follow the bounded-access rule: only units ending at or before that position, aliases revealed at or before it, and notes anchored at or before it.

#### Scenario: Jump ahead by search
- **WHEN** a reader whose reading position is Chapter 5 opens a passage in Chapter 30 from a search
- **THEN** glosses on that page use the Chapter 30 passage's position

#### Scenario: Current unit excluded
- **WHEN** a gloss is opened on a passage in the middle of Chapter 9
- **THEN** it shows observations from Chapter 8 and earlier only

### Requirement: Gloss card
Opening a marked mention SHALL show a card with the subject's display name at the bound, its kind, its most recent observations at the bound (with corrections applied and suppressed rows omitted), and the reader's notes attached to the subject and visible at the bound. The card SHALL link to the subject in the Guide.

#### Scenario: Card with note
- **WHEN** the reader opens a gloss for a subject with a note anchored in Chapter 4, on a passage in Chapter 9
- **THEN** the card shows the subject's recent observations and that note

### Requirement: Reader control over glosses
The reader SHALL be able to turn margin glosses off, and the browser SHALL remember that preference. The reader SHALL be able to stop a specific name from being glossed in an edition. That name SHALL then not be marked anywhere in that edition.

#### Scenario: Ambiguous short name
- **WHEN** the reader marks "Will" as not glossed in a book
- **THEN** "Will" is not marked in any passage of that book

#### Scenario: Glosses off
- **WHEN** the reader turns glosses off and reloads the passage reader
- **THEN** no mentions are marked

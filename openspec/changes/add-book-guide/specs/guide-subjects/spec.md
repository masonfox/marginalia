## Purpose

Gives observation names a durable identity, so nicknames, titles, and epithets of one character, place, object, or motif read as one subject. Every alias link carries its own reveal position, so an identity is never disclosed before the reader reaches it.

## ADDED Requirements

### Requirement: Subjects group observation names
Each observation name (by its normalized key) SHALL belong to exactly one subject. A name with no alias link SHALL be its own subject. A subject SHALL have one primary name and any number of alias names. Subjects and alias links SHALL be keyed by normalized name, not by observation row, and SHALL survive regeneration, prompt-version changes, and reparsing. A name with no current observations SHALL keep its links, which take effect again when the name reappears.

#### Scenario: Unlinked names
- **WHEN** no aliases are confirmed for "Brawne", "Lamia", and "Brawne Lamia"
- **THEN** they are three subjects

#### Scenario: Survives regeneration
- **WHEN** "Brawne" is confirmed as an alias of "Brawne Lamia" and the book is preprocessed again under a new prompt version
- **THEN** observations of both names still belong to one subject

### Requirement: Alias reveal position
Every alias link SHALL carry a reveal position anchored to a passage. At a bound, an alias name SHALL be grouped with its subject only when the reveal position is at or before the bound. Otherwise it SHALL be treated as its own separate subject. A primary name SHALL need no reveal position. When the reader links names, the reveal position SHALL default to their reading position, or to the later of the two names' first appearances when the position is unset. The reader SHALL be able to set it to any passage, including the passage where the identity is revealed.

#### Scenario: Identity not yet revealed
- **WHEN** "Strider" is an alias of "Aragorn" with a reveal position in Chapter 10, and the bound is Chapter 8
- **THEN** "Strider" is listed as its own subject and nothing at that bound connects it to "Aragorn"

#### Scenario: Identity revealed
- **WHEN** the same link is viewed with a bound at Chapter 12
- **THEN** observations of "Strider" and "Aragorn" appear under one subject

### Requirement: Display name at a bound
A subject's display name SHALL be one of its names. The reader SHALL be able to choose which. At a bound, a subject SHALL be displayed under its chosen name only when that name is visible at the bound. Otherwise it SHALL be displayed under its earliest-appearing name that is visible at the bound.

#### Scenario: Chosen name would spoil
- **WHEN** the reader chose "Aragorn" as the display name, and at the bound only "Strider" has appeared and the alias is not yet revealed
- **THEN** the subject is shown as "Strider"

### Requirement: Proposed merges
The system SHALL propose merges deterministically, without a model call. It SHALL propose pairs of names of the same kind where one name's significant words are contained in the other's, for example "Brawne" and "Brawne Lamia". A proposal SHALL have no effect on grouping, on assistant tools, or on glosses until the reader confirms it. A confirmed proposal SHALL default its reveal position to the later of the two names' first appearances. The reader SHALL be able to dismiss a proposal, and a dismissed proposal SHALL NOT be proposed again. Proposals SHALL be shown only for names visible at the Guide's bound.

#### Scenario: Containment proposal
- **WHEN** characters "Brawne" and "Brawne Lamia" both have observations within the bound
- **THEN** the Index proposes merging them, and they stay separate until the reader confirms

#### Scenario: Dismissed
- **WHEN** the reader dismisses a proposal to merge "Will" and "Will Treaty"
- **THEN** that pair is not proposed again

### Requirement: Reader editing of subjects
In the Index, the reader SHALL be able to merge two subjects, split an alias name out of a subject so it becomes its own subject, choose the display name, and set the subject's kind. A subject's kind, when set, SHALL be used for display and filtering. It SHALL NOT change the kinds stored on observations. Merging subjects SHALL keep each moved alias's reveal position, or use the merge's reveal position if that is later. Any alias link SHALL be removable, which restores the name as its own subject.

#### Scenario: Merge
- **WHEN** the reader merges "Lamia" into "Brawne Lamia" with a reveal position in Chapter 2
- **THEN** from Chapter 2 on, "Lamia" observations appear under "Brawne Lamia"

#### Scenario: Split
- **WHEN** the reader splits "Lamia" out of "Brawne Lamia"
- **THEN** "Lamia" is its own subject again at every bound

#### Scenario: Kind override
- **WHEN** the reader sets a subject's kind to motif
- **THEN** the Index lists it under motif, and its observations keep their stored kinds

### Requirement: Bounded name resolution
Resolving a name at a bound SHALL normalize it, find its subject through alias links visible at that bound, and return the observations of every name of that subject that is visible at that bound. Name resolution SHALL be the single rule used by the Guide Index, the assistant's observation lookup, and margin glosses.

#### Scenario: Lookup by alias
- **WHEN** a lookup for "Strider" is made at a bound after the alias's reveal position
- **THEN** observations recorded under "Aragorn" and "Strider" are returned together

#### Scenario: Lookup before reveal
- **WHEN** the same lookup is made at a bound before the reveal position
- **THEN** only observations recorded under "Strider" are returned

### Requirement: Anchors survive reparsing
Reveal positions SHALL be anchored by passage locator. On reparse, in the same transaction that replaces the structure, each reveal anchor SHALL be forwarded to the passage that now holds its text. When the anchored passage was removed, the anchor SHALL move to the first surviving passage after it. The anchor SHALL never move earlier than the text it covered.

#### Scenario: Anchored passage removed
- **WHEN** the passage holding an alias's reveal position is removed by a reparse
- **THEN** the reveal position moves to the next surviving passage, never to an earlier one

### Requirement: Subjects deleted with the edition
Deleting an edition SHALL delete its subjects, alias links, and dismissed proposals.

#### Scenario: Edition deleted
- **WHEN** an edition is deleted
- **THEN** its subjects and alias links no longer exist

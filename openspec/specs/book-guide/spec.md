# book-guide Specification

## Purpose

Lets a reader browse what has been derived about a book (unit summaries, a subject index, subject timelines, and their own notes), always limited to a spoiler bound and showing where each item came from.

## Requirements

### Requirement: Guide for a book
Every ready edition SHALL have a Guide reachable from its detail page, with three views: Chapters, Index, and Notes. When the edition has no current preprocessing, Chapters and Index SHALL say so and point to preprocessing on the detail page, and Notes SHALL still work. The Guide SHALL work whether or not an AI provider is configured, and SHALL make no model calls.

#### Scenario: Open the Guide
- **WHEN** a reader opens the Guide of a preprocessed book
- **THEN** Chapters, Index, and Notes views are offered

#### Scenario: Not preprocessed
- **WHEN** a reader opens the Guide of a book with no current preprocessing
- **THEN** Chapters and Index say no guide data exists yet, and Notes is still usable

### Requirement: Guide bound
The Guide SHALL show nothing derived or reader-authored until a bound is established. When the edition has a reading position, the bound SHALL default to it. When the position is unset, the Guide SHALL ask the reader on each visit to choose a reading unit or whole book, with nothing preselected. The current bound SHALL always be visible as "Through <unit label>" or "Whole book".

#### Scenario: Default from position
- **WHEN** the reading position is Chapter 12 and the reader opens the Guide
- **THEN** the Guide opens bounded through Chapter 12

#### Scenario: No position
- **WHEN** the position is unset and the reader opens the Guide
- **THEN** the Guide asks how far they have read and shows no summaries, subjects, or notes until they choose

### Requirement: Peeking past the position
The reader SHALL be able to widen the Guide's bound past their reading position for the current visit only, after a confirmation that warns about spoilers. A peek SHALL NOT change the stored reading position, SHALL NOT be stored on the server or in browser storage, and SHALL end when the reader leaves the Guide or reloads it. While peeking, the Guide SHALL show that it is past the reader's position and SHALL offer a way back to it. Narrowing the Guide's bound below the position SHALL be allowed without confirmation.

#### Scenario: Peek
- **WHEN** the position is Chapter 12 and the reader confirms a peek through Chapter 20
- **THEN** the Guide shows content through Chapter 20, marks it as past the position, and the stored position stays Chapter 12

#### Scenario: Peek is not remembered
- **WHEN** the reader peeks to Chapter 20 and later reopens the Guide
- **THEN** the Guide is bounded through Chapter 12 again

### Requirement: Bounded content
The Guide SHALL show a unit summary or an observation only when its unit's end position is at or before the bound, including when the bound falls inside the unit. It SHALL apply the same rule to subject aliases (by reveal position) and reader notes (by "as of" position). Stale machine rows SHALL NOT be shown. Reader corrections SHALL be applied to the rows they correct, and suppressed rows SHALL NOT be shown.

#### Scenario: Bound inside a unit
- **WHEN** the Guide is bounded at a position in the middle of Chapter 13
- **THEN** no summary, observation, or note from Chapter 13 or later is shown

#### Scenario: Corrected row
- **WHEN** a summary in scope has a reader correction
- **THEN** the corrected text is shown in place of the generated text

### Requirement: Chapters view
The Chapters view SHALL list the unit summaries within the bound in reading order, each with its unit label and summary. Each citation SHALL link to its passage in the reader, and unverified citations SHALL be marked as unverified. A unit within the bound that has no current summary SHALL be shown as not yet summarized. Reader notes attached to a unit and visible at the bound SHALL be shown with that unit.

#### Scenario: Citation link
- **WHEN** the reader clicks a citation on a Chapter 2 summary
- **THEN** the passage reader opens at that passage

#### Scenario: Unverified citation
- **WHEN** a summary's citation was not verified
- **THEN** it is shown marked as unverified

#### Scenario: Missing unit
- **WHEN** preprocessing failed for Chapter 7 and the bound is Chapter 12
- **THEN** Chapter 7 is listed as not yet summarized

### Requirement: Index view
The Index view SHALL list the subjects that have at least one observation visible at the bound. Each subject SHALL be shown with its display name at the bound, its kind, and the number of units it appears in. The reader SHALL be able to filter the list by kind (character, place, object, motif) and by name text. Names SHALL be grouped into subjects as defined by the guide's subjects and aliases, using only alias links visible at the bound.

#### Scenario: Filter by kind
- **WHEN** the reader filters the Index to places
- **THEN** only place subjects are listed

#### Scenario: Subject appears later
- **WHEN** a character's first observation is in Chapter 15 and the bound is Chapter 12
- **THEN** that character is not listed

### Requirement: Subject timeline
Opening a subject SHALL show its timeline: the subject's observations visible at the bound, in reading order, each with its unit label, the name it was observed under when that differs from the display name, its note, and its citations. The timeline SHALL also show reader notes attached to the subject and visible at the bound. The timeline SHALL be assembled at view time and SHALL NOT be stored.

#### Scenario: Timeline across aliases
- **WHEN** "Brawne" and "Brawne Lamia" are confirmed aliases of one subject and both appear before the bound
- **THEN** the subject's timeline contains observations under both names in reading order

### Requirement: Provenance shown
The Guide SHALL show, for the derived data it displays, the model that generated it, its prompt version, and whether the edition's preprocessing is current, stale, or partial. Each corrected item SHALL be marked "corrected by reader". Each reader note SHALL be visibly distinct from generated content.

#### Scenario: Provenance line
- **WHEN** the Chapters view is shown for a book preprocessed with model M at prompt version 2
- **THEN** the view states model M and prompt version 2

### Requirement: No whole-book synthesis
The Guide SHALL NOT offer book-level themes or any other whole-book summary.

#### Scenario: No themes view
- **WHEN** a reader opens the Guide
- **THEN** no themes or whole-book summary view is offered

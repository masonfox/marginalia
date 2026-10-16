## Purpose

Lets readers write their own guide pages (theories, timelines, glossaries, character notes). Each page is visible only from the point in the book it was written "as of", so reader context never spoils an earlier-scoped view.

## ADDED Requirements

### Requirement: Reader notes
The reader SHALL be able to create, edit, and delete notes for an edition. A note SHALL have a title of at most 200 characters, a Markdown body of at most 20,000 characters, and an "as of" anchor. The reader SHALL be able to attach a note to at most one subject or one reading unit. Notes SHALL be rendered as Markdown without raw HTML.

#### Scenario: Create a note
- **WHEN** a reader creates a note titled "Who is the Shrike?" as of Chapter 8
- **THEN** it is saved and listed in the Guide's Notes view at bounds from Chapter 8 on

#### Scenario: Too long
- **WHEN** a reader saves a note body longer than 20,000 characters
- **THEN** the save is rejected with the limit stated

### Requirement: "As of" anchor
Every note SHALL have an "as of" anchor: a reading unit (stored as its last passage), a specific passage, or the end of the book. The anchor SHALL default to the reader's reading position. When the position is unset the reader SHALL choose one. When the position is finished, the anchor SHALL default to the end of the book. The reader SHALL be able to change it later.

#### Scenario: Default anchor
- **WHEN** the reading position is Chapter 12 and the reader starts a new note
- **THEN** its anchor defaults to Chapter 12

#### Scenario: No position
- **WHEN** the position is unset and the reader starts a new note
- **THEN** the reader must choose the anchor before saving

### Requirement: Bounded visibility
A note SHALL be visible only where its anchor position is at or before the bound in use: the Guide bound, a conversation's bound for that book, or the passage on screen for glosses. A note anchored at the end of the book SHALL be visible only at whole-book bounds.

#### Scenario: Theory written after finishing
- **WHEN** a note is anchored at the end of the book and a conversation is scoped through Chapter 5
- **THEN** the note is not visible to that conversation

### Requirement: Attachments
A note attached to a subject SHALL be stored against the subject's normalized name, so it survives regeneration. It SHALL be shown on the subject's timeline wherever that name resolves to the subject at the bound. A note attached to a unit SHALL be stored against the unit's anchor, and SHALL be shown with that unit in the Chapters view. All visible notes SHALL be listed in the Notes view.

#### Scenario: Subject note
- **WHEN** a note is attached to "Brawne Lamia" and visible at the bound
- **THEN** it appears on her timeline and in the Notes view

### Requirement: Notes survive reparsing
On reparse, in the same transaction that replaces the structure, each note's "as of" anchor SHALL be forwarded to the passage that now holds its text. When that passage was removed, the anchor SHALL move to the first surviving passage after it, never earlier. A unit attachment whose anchor no longer starts a reading unit SHALL be cleared, and the note SHALL remain in the Notes view.

#### Scenario: Anchor passage removed
- **WHEN** a note's anchor passage is removed by a reparse
- **THEN** the note becomes visible from the next surviving passage, not from an earlier one

### Requirement: Notes deleted with the edition
Deleting an edition SHALL delete its notes.

#### Scenario: Edition deleted
- **WHEN** an edition is deleted
- **THEN** its notes no longer exist

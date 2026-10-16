## ADDED Requirements

### Requirement: Reading position suggested when choosing a scope
When a book has a reading position, the scope choices for a new conversation SHALL highlight the choice that matches it (a unit, or whole book when the position is finished) as the reader's position. The highlighted choice SHALL NOT be preselected. The reader SHALL still choose a scope before the conversation can be started. When the conversation is started from a passage and the position's choice is not among the offered choices, nothing SHALL be highlighted.

#### Scenario: Position highlighted
- **WHEN** a book's reading position is Chapter 12 and the reader opens the new-conversation dialog
- **THEN** Chapter 12 is marked as their position, nothing is selected, and the conversation cannot be started until a choice is made

#### Scenario: Position before the starting passage
- **WHEN** the position is Chapter 5 and the reader starts a conversation from a passage in Chapter 9
- **THEN** no choice is highlighted

### Requirement: Offer to update the reading position after widening
When the reader widens a conversation's scope for a book past that book's reading position, or while the position is unset, the system SHALL offer to set the reading position to the new scope. Declining SHALL leave the position unchanged. Accepting SHALL set the position as an ordinary forward move. Widening SHALL NOT change the position without the reader accepting.

#### Scenario: Widen past position
- **WHEN** the position is Chapter 12 and the reader widens a conversation to Chapter 18
- **THEN** the system offers to update the position to Chapter 18, and the position stays at Chapter 12 unless the reader accepts

#### Scenario: Widen within position
- **WHEN** the position is Chapter 20 and the reader widens a conversation from Chapter 10 to Chapter 15
- **THEN** no offer is made

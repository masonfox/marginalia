## ADDED Requirements

### Requirement: Guide context in the trail
When a reply was generated with a book map, its trail SHALL begin with a guide step per book, such as "Used chapter summaries through Chapter 12" or "Used chapter summaries for the whole book". The step SHALL be described from what the reply recorded: the book, its scope label, and a fingerprint of the map that was sent. The map text SHALL NOT be stored per message. Expanding the step SHALL list the summaries now within that scope, with corrections applied. When the current map no longer matches the recorded fingerprint, the step SHALL say that the guide has changed since this reply. The guide step SHALL NOT count as a search or a passage read in the trail's summary line. Replies created before this change SHALL show no guide step.

#### Scenario: Reply used the map
- **WHEN** a reply in a conversation scoped through Chapter 12 was generated with a book map
- **THEN** its trail starts with "Used chapter summaries through Chapter 12"

#### Scenario: Guide changed since
- **WHEN** the reader corrects a summary within scope after a reply was generated
- **THEN** that reply's guide step says the guide has changed since the reply

### Requirement: Readable guide lookups
An observation lookup step SHALL show the name looked up, the subject it resolved to when that differs, and the number of observations returned. Expanding it SHALL list each observation with its unit label and note, marking reader corrections. A notes lookup step SHALL be described as checking the reader's notes, with the number of notes returned. Expanding it SHALL list each note's title linked to the note.

#### Scenario: Observation lookup
- **WHEN** the model looked up "Strider" and received 4 observations under subject "Aragorn"
- **THEN** the step reads as looking up "Strider" (Aragorn) with 4 results

### Requirement: Correct from the trail
Each summary listed under a guide step, and each observation listed under an observation lookup step, SHALL offer a "Correct this" action that opens the correction flow for that item. A correction made this way SHALL affect later replies only. Earlier replies and their stored tool results SHALL be unchanged. The action SHALL NOT be offered for an item whose book was deleted, or for an item whose unit no longer has a current row.

#### Scenario: Correct an observation
- **WHEN** the reader chooses "Correct this" on an observation in a lookup step and replaces its text
- **THEN** the correction is saved, the next reply's lookups return the corrected text, and the earlier reply's stored result is unchanged

### Requirement: Save a reply excerpt as a note
When the reader selects text in an assistant reply, the selection actions SHALL include "Save as note". It SHALL open a new note for the conversation's book, prefilled with the excerpt as a quotation and a link back to the conversation. The note's "as of" anchor SHALL default to the conversation's scope for that book: the scope's unit, or the end of the book for whole-book scope. In a conversation with several books, the reader SHALL choose the book. The note SHALL NOT be created until the reader saves it.

#### Scenario: Save as note
- **WHEN** the reader selects a sentence in a reply of a conversation scoped through Chapter 12 and chooses "Save as note"
- **THEN** a draft note opens with the quoted sentence, a link to the conversation, and an anchor of Chapter 12

## ADDED Requirements

### Requirement: Passage reference actions
The passage view SHALL offer a reference action for each displayed passage, and for a non-whitespace text selection that lies wholly within the text of one passage. Selections that span passages, or that include footnote panels, navigation, or other page chrome, SHALL get no action. A selection reference SHALL identify its text by character offsets into that passage's text, and those offsets SHALL produce the same highlight when the reference's link is opened. The action SHALL offer:
- "Copy link", which copies the passage view URL for the passage, with the selection's range when there is one.
- "Discuss in a new conversation", which starts a conversation about the passage's book with the reference attached.
- "Add to a conversation", which lists the book's existing conversations with their scopes and opens the chosen one with the reference attached.

The action SHALL be reachable and operable by pointer, touch, and keyboard, SHALL have an accessible name, and SHALL NOT interfere with ordinary text selection and copying. Pressing Escape or clearing the selection SHALL dismiss a selection action. When AI is not configured, only "Copy link" SHALL be offered.

#### Scenario: Copy a passage link
- **WHEN** the reader activates "Copy link" on a passage
- **THEN** the clipboard holds this instance's passage view URL for that passage's current locator, and the page confirms the copy

#### Scenario: Copy a selection link
- **WHEN** the reader selects a phrase inside one passage and activates "Copy link"
- **THEN** the copied URL includes the phrase's range, and opening it shows the passage with exactly that phrase highlighted

#### Scenario: Selection across passages
- **WHEN** the reader's selection spans two passages or includes a footnote panel
- **THEN** no selection reference action is offered

#### Scenario: Discuss in a new conversation
- **WHEN** the reader activates "Discuss in a new conversation" on a passage and chooses a scope
- **THEN** a conversation about the book is created and opened, with the passage attached to its composer

#### Scenario: Add to an existing conversation
- **WHEN** the reader activates "Add to a conversation" and picks one of the book's conversations
- **THEN** that conversation opens with the passage attached to its composer, and the existing draft is kept

#### Scenario: Keyboard use
- **WHEN** the reader moves through the passages with the keyboard
- **THEN** each passage's reference action can be focused and its options chosen without a pointer

#### Scenario: AI not configured
- **WHEN** AI is not configured on the instance
- **THEN** the reference action offers only "Copy link"

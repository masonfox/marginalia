## MODIFIED Requirements

### Requirement: Position is a default, never a conversation's authority
The reading position SHALL be used only as the default bound for browsing the guide, as the default "as of" anchor for reader notes, as the default scope of a conversation started from the book page composer, and as a suggestion when choosing a conversation's scope in the new-conversation dialog. The position SHALL be settable from the book page header and from the book page composer. It SHALL NOT change the bound of any existing conversation, and changing the position SHALL NOT change any conversation. Starting a conversation with a scope chosen for that conversation only SHALL NOT change the position.

#### Scenario: Conversation unaffected
- **WHEN** a conversation is scoped through Chapter 10 and the reader moves their position to Chapter 20
- **THEN** the conversation remains scoped through Chapter 10

#### Scenario: Default for the composer
- **WHEN** the position is Chapter 10 and the reader starts a conversation from the book page composer without changing its scope
- **THEN** the conversation is scoped through Chapter 10

#### Scenario: One-off scope leaves the position alone
- **WHEN** the position is Chapter 10 and the reader starts a conversation from the composer through Chapter 20 for this conversation only
- **THEN** the position stays at Chapter 10

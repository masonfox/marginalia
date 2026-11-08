## ADDED Requirements

### Requirement: Thread drawer on small screens
On narrow viewports, a thread SHALL open as a full-screen drawer over the conversation instead of a side panel. The drawer's header SHALL show a control that returns to the main conversation, and the anchor quote SHALL be shown at the top of its content. Its composer SHALL stay at the bottom of the viewport, including while the on-screen keyboard is open. Browser back navigation SHALL close the drawer and return to the main conversation at the scroll position it had. When the viewport widens past the narrow breakpoint while a thread is open, the thread SHALL be shown as a side panel without losing its draft, and the reverse SHALL also hold.

#### Scenario: Open a thread on a phone
- **WHEN** a reader at 360 pixels wide opens a thread
- **THEN** the thread fills the screen with the anchor quote at the top and a control to return to the conversation

#### Scenario: Back closes the drawer
- **WHEN** a reader with a thread drawer open uses the browser's back navigation
- **THEN** the drawer closes and the conversation is shown at its previous scroll position

#### Scenario: Typing in a thread on a phone
- **WHEN** a reader focuses the thread's message input on a phone and the on-screen keyboard opens
- **THEN** the input stays visible above the keyboard

#### Scenario: Rotate with a thread open
- **WHEN** a reader with a thread open and a typed draft widens the viewport past the narrow breakpoint
- **THEN** the thread is shown as a side panel with the same draft

## Purpose

Lets a reader take a selected passage of an assistant response into a side thread, discuss it there, and return to the main conversation without the tangent filling it.

## ADDED Requirements

### Requirement: Start a thread from an assistant response
The selection actions offered for eligible text in an assistant response in the main conversation SHALL include a "Thread" action alongside "Reply to selection" and, where available, "Save as note". Eligibility SHALL be the same as for "Reply to selection". Activating "Thread" SHALL open the thread panel in a new-thread state that shows the selected text as the anchor quote, labelled with the response it came from, and SHALL focus the thread's message input. The selected text SHALL follow the same 1 to 2,000 character rule as a reply quote, and an over-limit selection SHALL show the same explanation without opening a thread. Opening a new thread SHALL NOT store anything. The thread SHALL be created only when its first message is sent, and closing the panel before that SHALL leave the conversation unchanged. Threads SHALL NOT be started from reader messages, from book text, or from any message inside a thread.

#### Scenario: Start a thread
- **WHEN** the reader selects text in a saved assistant response in the main conversation and activates "Thread"
- **THEN** the thread panel opens showing that text as the anchor quote, its message input has focus, and the main conversation's composer and draft are unchanged

#### Scenario: Abandon a new thread
- **WHEN** the reader opens a new thread and closes the panel without sending a message
- **THEN** no thread is stored and the response shows no new thread marker

#### Scenario: Reader message selection
- **WHEN** the reader selects text in one of their own messages
- **THEN** no "Thread" action is offered

#### Scenario: Several threads on one response
- **WHEN** the reader starts threads from two different selections in the same response
- **THEN** both threads are kept, each with its own anchor quote

### Requirement: Thread persistence and validation
Sending the first message of a new thread SHALL create the thread and store that message in one step. The thread records its anchor response and anchor quote. Before storing anything or contacting the provider, the system SHALL reject a new thread whose anchor is unknown, belongs to another conversation, is a reader message, is a message inside a thread, is still being generated, or failed with an error and can be retried, and SHALL reject an anchor quote that is empty or over 2,000 characters after trimming. A rejected request SHALL create no thread, append no message, and make no provider call, and the reader SHALL see a validation error. A message sent to an existing thread SHALL be rejected the same way when the thread is not in the conversation. Threads and their messages SHALL survive reloads and restarts, and deleting a conversation SHALL delete its threads. An anchor response from a saved incomplete generation SHALL be a valid anchor.

#### Scenario: Thread survives a restart
- **WHEN** the reader reopens a conversation with a thread after the application restarts
- **THEN** the thread's anchor quote, messages, tool activity, and citations are shown as before

#### Scenario: Invalid anchor
- **WHEN** a request tries to start a thread on a reader message, a thread message, or a response in another conversation
- **THEN** it is rejected, and no thread, message, or provider call is created

#### Scenario: Conversation deleted
- **WHEN** a conversation with threads is deleted
- **THEN** its threads and their messages are removed

### Requirement: Threads are one level deep
Text in messages inside a thread SHALL NOT offer a "Thread" action, and the system SHALL reject any request to anchor a thread to a message inside a thread.

#### Scenario: Selecting inside a thread
- **WHEN** the reader selects eligible text in an assistant reply inside a thread
- **THEN** the selection actions do not include "Thread"

### Requirement: Thread context for the model
For each turn in a thread, the model SHALL receive the main conversation's messages up to and including the anchor response, then the anchor quote supplied as labelled user-selected context from that response (not verified book evidence), then the thread's messages in order. It SHALL NOT receive main-conversation messages after the anchor response or messages from other threads. The system prompt, tool definitions, and book scope SHALL be the conversation's own, unchanged and byte-identical to those of the main conversation. Earlier thread messages SHALL be replayed unchanged from turn to turn. Threads SHALL use the conversation's model in effect, and SHALL offer no model choice of their own.

#### Scenario: Thread after the main conversation moved on
- **WHEN** the reader continues the main conversation past the anchor response and then sends a message in the thread
- **THEN** the model receives the main conversation only up to the anchor response, plus the anchor quote and the thread's messages

#### Scenario: Same prompt and tools as the main conversation
- **WHEN** the reader sends a message in the main conversation and then one in a thread
- **THEN** both requests use identical system prompt and tool definitions

#### Scenario: Model change
- **WHEN** the reader changes the conversation's model
- **THEN** later replies in its threads use the new model

### Requirement: Main conversation isolated from threads
The main conversation's model input SHALL NOT include thread messages, anchor quotes, or thread existence. Thread content SHALL reach the main conversation only as text the reader explicitly carries back (see "Bring thread text to the main conversation").

#### Scenario: Main turn after a thread
- **WHEN** the reader discusses a passage in a thread and then sends a message in the main conversation
- **THEN** the model's input for that turn contains no thread messages or thread quote

### Requirement: Bring thread text to the main conversation
The selection actions for eligible text in an assistant reply inside a thread SHALL include "Reply to selection", which attaches the text to the thread's composer, and "Bring to main", which attaches the text to the main conversation's composer as an assistant-response quote. "Bring to main" SHALL follow the pending-quote rules of the main composer: it replaces any existing main-conversation quote and preserves both composers' typed drafts. On wide screens the thread panel SHALL stay open and the main composer's input SHALL receive focus. On small screens the drawer SHALL close and return to the main conversation with its input focused.

#### Scenario: Carry an insight back
- **WHEN** the reader selects text in a thread reply and activates "Bring to main"
- **THEN** the main composer shows that text as an assistant-response quote, the thread composer's draft is unchanged, and sending it stores the quote with the main-conversation message

### Requirement: Thread panel
Threads SHALL open in a panel beside the main conversation on wide viewports, so that the main conversation stays visible and usable. The panel SHALL show the anchor quote with a way to scroll the main conversation to the anchor response, the thread's messages with their research activity, citations, and usage, a composer, and a close control. At most one thread SHALL be open at a time, and opening another thread SHALL replace the open one. The open thread, including a new thread that has not been sent, SHALL be reflected in the page address so that reloading the page or using browser history restores or closes it. An address that names a thread not in the conversation SHALL open the conversation without a panel. The panel's controls SHALL be keyboard reachable and have accessible names. Escape SHALL close the panel when no selection action, popover, or menu inside it is open.

#### Scenario: Reload with a thread open
- **WHEN** the reader reloads the page while a thread is open
- **THEN** the conversation opens with the same thread panel open

#### Scenario: Switch threads
- **WHEN** a thread is open and the reader opens another thread's marker
- **THEN** the panel shows the other thread, and each thread's composer draft is kept

#### Scenario: Unknown thread in the address
- **WHEN** the reader opens a conversation address naming a deleted or foreign thread
- **THEN** the conversation is shown without a thread panel

### Requirement: Thread markers in the main conversation
Each assistant response in the main conversation that anchors one or more threads SHALL show a thread chip below it with the number of threads. With one thread, the chip SHALL open it. With several, the chip SHALL list them by anchor quote excerpt and most recent activity. Where an anchor quote can be found in the displayed response text, that text SHALL be subtly underlined, and activating it SHALL open its thread. When it cannot be found, the chip SHALL still be shown. Markers SHALL update when a new thread is created without a page reload. Markers SHALL NOT interfere with selecting text, copying, or citation interactions.

#### Scenario: Thread created
- **WHEN** the reader sends the first message of a new thread
- **THEN** the anchor response shows a thread chip and an underline on the anchor text, without a reload

#### Scenario: Several threads on a response
- **WHEN** a response anchors three threads and the reader activates its chip
- **THEN** the three threads are listed, and choosing one opens it in the panel

### Requirement: One generation across a conversation's threads
Only one generation SHALL run at a time across a conversation's main conversation and all its threads. While one runs, every send control in that conversation SHALL be unavailable, and the idle composer SHALL say a reply is in progress. A request that arrives while another generation runs SHALL be rejected without storing a message or creating a thread.

#### Scenario: Send in the main conversation while a thread replies
- **WHEN** a thread reply is streaming and the reader types in the main composer
- **THEN** the main send control is unavailable with a notice that a reply is in progress, and the typed draft is kept

### Requirement: Thread retry
Retrying a failed generation in a thread SHALL replay that thread's last reader message with the context described in "Thread context for the model", without appending a second reader message. Retrying in the main conversation SHALL be unaffected by threads. A failure in one SHALL NOT offer a retry in the other.

#### Scenario: Retry a failed thread reply
- **WHEN** a thread reply fails after the reader's message was saved and the reader retries
- **THEN** the same message is replayed once in that thread and the main conversation is unchanged

### Requirement: Thread usage total
The thread panel SHALL show the thread's running total of tokens and estimated cost, including failed and retried attempts, updated when a reply finishes without a page reload. Each thread reply SHALL show its own usage as replies in the main conversation do.

#### Scenario: Thread total
- **WHEN** a thread reply finishes
- **THEN** the thread panel's total and the conversation total both include it

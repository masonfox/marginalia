## Purpose

Keeps each book's reading position in step with an external reading tracker. Progress is pulled one way from configurable providers, and the provider always wins. Sync never moves the position past the last reading unit the reader has finished.

## ADDED Requirements

### Requirement: Progress providers
The system SHALL support progress providers of these kinds: BookOrbit, Hardcover, and Goodreads. Each kind SHALL be configured at most once per instance. Each provider SHALL declare its own configuration fields, and each field SHALL be marked plain or secret. The system SHALL store secret fields encrypted at rest and SHALL NOT return their values to the browser after saving. Instead it SHALL show only a short hint, such as the last four characters. A provider SHALL be disabled until the reader enables it, and a disabled provider SHALL make no network requests.

#### Scenario: Configure Hardcover
- **WHEN** a reader enters a Hardcover API token and enables Hardcover
- **THEN** the token is stored encrypted, and the settings page shows only a hint of it

#### Scenario: Disabled provider is silent
- **WHEN** Hardcover is configured but disabled
- **THEN** no request is made to Hardcover, on a schedule or otherwise

#### Scenario: One configuration per kind
- **WHEN** Hardcover is already configured and the reader opens the settings
- **THEN** the reader can edit the existing Hardcover configuration but cannot add a second one

### Requirement: Test connection
The reader SHALL be able to test a provider's configuration before or after saving it. The result SHALL say whether the provider accepted the credentials. When the provider did not accept them, the result SHALL give a reason the reader can act on: unreachable, rejected credentials, or rate limited.

#### Scenario: Rejected credentials
- **WHEN** a reader tests a BookOrbit configuration with a wrong KOReader key
- **THEN** the result says BookOrbit rejected the credentials

#### Scenario: Unreachable instance
- **WHEN** a reader tests a BookOrbit configuration whose URL does not respond
- **THEN** the result says BookOrbit could not be reached

### Requirement: Sync schedule per provider
Each enabled provider SHALL have its own sync schedule: manual only, or one of a fixed set of intervals. A change to a schedule SHALL take effect without restarting the instance. A scheduled sync SHALL run once per interval across all instances that share a database.

#### Scenario: Change interval
- **WHEN** a reader changes Hardcover's schedule from daily to every 6 hours
- **THEN** the next scheduled Hardcover sync runs within about 6 hours, with no restart

#### Scenario: Manual only
- **WHEN** a provider's schedule is manual only
- **THEN** it syncs only when the reader asks it to

### Requirement: Manual sync
The reader SHALL be able to start a sync of one provider from Settings, and a sync of one book from that book's position control. Asking again while the same sync is pending or running SHALL NOT start a second sync. Settings SHALL show when each provider last synced, how many books it matched, and its last error, if any.

#### Scenario: Sync now
- **WHEN** a reader clicks "Sync now" for Hardcover
- **THEN** a Hardcover sync runs, and Settings then shows the new last-synced time

#### Scenario: Repeated clicks
- **WHEN** a reader clicks "Sync now" twice while the first sync is still running
- **THEN** only one sync runs

#### Scenario: Sync one book
- **WHEN** a reader clicks sync in a linked book's position control
- **THEN** only that book's link is synced, and the control shows the result

### Requirement: Matching books to provider books
The system SHALL link an edition to a provider's book automatically when they match unambiguously:
- **BookOrbit**: by the KOReader partial-MD5 digest of the edition's file.
- **Hardcover**: by ISBN or Hardcover id.
- **Goodreads**: by ISBN or Goodreads id.

ISBNs SHALL be compared after normalizing to ISBN-13. A provider book that matches more than one edition SHALL NOT be linked automatically. Provider books the reader is currently reading that match no edition SHALL be listed in Settings, where the reader can link each one to an edition by hand. A manual link SHALL take precedence over automatic matching. Provider books that the reader is not reading and that match no edition SHALL be ignored.

#### Scenario: Same file in BookOrbit and Marginalia
- **WHEN** BookOrbit and Marginalia import the same EPUB file
- **THEN** the edition is linked to the BookOrbit book by digest with no action from the reader

#### Scenario: ISBN match
- **WHEN** Hardcover reports a book being read with ISBN 978-0-00-000000-2 and an edition carries ISBN 0000000002 in another form
- **THEN** the edition is linked to that Hardcover book

#### Scenario: Unmatched book in progress
- **WHEN** Hardcover reports a book being read that matches no edition
- **THEN** it is listed in Settings as unmatched, with a picker to link it to an edition

#### Scenario: Ambiguous match
- **WHEN** a Hardcover book's ISBN matches two editions
- **THEN** neither edition is linked automatically, and the book is listed as unmatched

### Requirement: One source per book
When more than one enabled provider is linked to the same edition, the provider with the highest priority SHALL be that edition's only source of progress. Readings from other providers SHALL be ignored for that edition. The reader SHALL be able to reorder provider priority in Settings.

#### Scenario: Two providers disagree
- **WHEN** BookOrbit has priority over Hardcover, BookOrbit reports Chapter 14 finished and Hardcover reports a reading that maps to Chapter 11
- **THEN** the position follows BookOrbit

#### Scenario: Higher-priority provider disabled
- **WHEN** the reader disables BookOrbit for a book linked to both BookOrbit and Hardcover
- **THEN** that book's later syncs follow Hardcover

### Requirement: Spoiler-safe mapping to a reading unit
The system SHALL turn a provider reading into a reading position by rounding down to the last reading unit the reader has finished. It SHALL never choose the unit that contains the reader's current place.
- A reading with a precise location SHALL map to the last unit that ends before that location.
- A reading given as a fraction SHALL map that fraction onto the edition's linear text, weighted by text length, and then take the last unit that ends at or before that point. A reading given as pages SHALL be treated as the fraction current divided by total.
- When a reading has both a precise location and a fraction, the precise location SHALL be used.
- A reading short of the end of the first unit SHALL give an unset position.
- A reading the provider reports as finished, or a fraction of 1, SHALL give "finished".
- A reading the provider reports as not started SHALL give an unset position.

#### Scenario: Mid-chapter percentage
- **WHEN** a provider reports 42% and that point falls inside Chapter 12
- **THEN** the position is set to the end of Chapter 11

#### Scenario: Exactly at a chapter end
- **WHEN** a provider reports a fraction that falls exactly at the end of Chapter 11
- **THEN** the position is set to the end of Chapter 11

#### Scenario: Precise location
- **WHEN** BookOrbit reports a location inside the spine section where Chapter 9 starts
- **THEN** the position is set to the end of Chapter 8

#### Scenario: Early in the book
- **WHEN** a provider reports 2% and Chapter 1 ends at 4%
- **THEN** the position is unset

#### Scenario: Finished
- **WHEN** a provider reports the book as read
- **THEN** the position is "finished"

### Requirement: Provider wins on change
When a linked edition's source provider reports a reading that differs from the last reading applied to that edition, the system SHALL apply it. This holds even when it moves the position earlier. When the reading is unchanged, the system SHALL leave the position as it is, so a manual edit made after the last applied reading is kept. A change in the raw reading SHALL count as a change even when it maps to the same reading unit.

#### Scenario: Re-read moves back
- **WHEN** the position is the end of Chapter 14 from Hardcover and Hardcover starts a new read at 3%
- **THEN** the position moves back without asking the reader for confirmation

#### Scenario: Manual edit survives an unchanged reading
- **WHEN** Hardcover last reported 42% and the reader then sets Chapter 20 by hand, and the next sync still reports 42%
- **THEN** the position stays at Chapter 20

#### Scenario: Manual edit replaced by new progress
- **WHEN** the reader set Chapter 20 by hand after Hardcover reported 42%, and Hardcover then reports 44%
- **THEN** the position becomes the one mapped from 44%

### Requirement: Per-book opt-out
The reader SHALL be able to exclude a single edition from sync. An excluded edition's position SHALL NOT be changed by any sync, and its position control SHALL behave as it does for a book with no provider. The reader SHALL be able to include the edition again, and the next sync SHALL then apply the source provider's current reading.

#### Scenario: Excluded book
- **WHEN** a reader excludes a book from sync and Hardcover then reports new progress for it
- **THEN** the book's position does not change

#### Scenario: Re-included book
- **WHEN** a reader includes a previously excluded book again
- **THEN** the next sync applies its source provider's current reading

### Requirement: Built-in providers
The system SHALL provide these providers:
- **BookOrbit**: configured with an instance URL, a KOReader username, and a KOReader key (secret). It reads progress through BookOrbit's KOReader sync API, one book at a time, by digest.
- **Hardcover**: configured with a personal API token (secret). It reads the reader's books and their read progress, and stays within Hardcover's published rate limit.
- **Goodreads**: configured with a public profile id. It reads the reader's public shelves and status updates. It SHALL be delivered only if a spike confirms the public feeds give usable progress, and it SHALL say in its settings that the reader's profile must be public.

#### Scenario: BookOrbit precise location
- **WHEN** BookOrbit returns a KOReader location for a linked book
- **THEN** the mapping uses that location rather than BookOrbit's percentage

#### Scenario: Hardcover rate limit
- **WHEN** a Hardcover sync would exceed Hardcover's request rate limit
- **THEN** the sync slows down or resumes later rather than failing the remaining books

### Requirement: Deleting an edition removes its links
Deleting an edition SHALL delete its provider links, its opt-out, and the record of its last applied reading.

#### Scenario: Edition deleted
- **WHEN** an edition linked to Hardcover is deleted
- **THEN** its Hardcover link no longer exists, and the Hardcover book is treated as unmatched if it is still being read

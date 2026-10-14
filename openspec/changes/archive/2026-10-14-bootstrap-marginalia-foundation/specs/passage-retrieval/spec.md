## Purpose

Finds relevant passages in the reader's books and resolves and verifies citations, providing the retrieval layer that future conversations and spoiler boundaries depend on.

## ADDED Requirements

### Requirement: Full-text passage search
The system SHALL search passage text using PostgreSQL full-text search, scoped to a single edition or to all editions, using the language-appropriate text search configuration for each edition (falling back to a language-neutral configuration for unsupported or missing languages). Results SHALL be ordered by relevance and SHALL include the locator, section title, passage kind, position, and a snippet with the matching terms highlighted.

#### Scenario: Search within a book
- **WHEN** a search for `green light` is run against one edition
- **THEN** results contain only passages from that edition, ordered by relevance, each with a highlighted snippet and its locator

#### Scenario: Stemming
- **WHEN** an English edition contains "dreaming" and a search is run for `dreams`
- **THEN** the passage containing "dreaming" is returned

#### Scenario: Unsupported language
- **WHEN** an edition's language has no matching text search configuration
- **THEN** search still matches exact word forms in that edition

### Requirement: Search query syntax
The system SHALL accept free-text queries supporting quoted phrases, `OR`, and `-` exclusion, and SHALL never fail because of query syntax; malformed input SHALL be interpreted leniently.

#### Scenario: Exact phrase
- **WHEN** a search for `"old sport"` is run
- **THEN** only passages containing those words adjacently are returned

#### Scenario: Unbalanced quote
- **WHEN** a search query contains an unmatched quotation mark
- **THEN** the search returns results rather than an error

### Requirement: Position-bounded search
Search SHALL accept an optional maximum position; when provided, the system SHALL return only passages whose reveal position is less than or equal to that bound. The bound SHALL be applied in the database query, not by filtering results after ranking.

#### Scenario: Bound excludes later passages
- **WHEN** a search is run with a maximum position of 500 and matching passages exist at positions 100 and 900
- **THEN** only the passage at position 100 is returned

#### Scenario: Footnote revealed by an earlier reference
- **WHEN** a search with maximum position 500 matches a footnote whose reveal position is 120
- **THEN** the footnote is returned

#### Scenario: Result limit with a bound
- **WHEN** a bounded search requests 10 results and more than 10 matches exist within the bound
- **THEN** exactly 10 results are returned, all within the bound

### Requirement: Citation resolution
The system SHALL resolve a locator to its passage text, edition, section title, table-of-contents path, and position, and SHALL optionally return a requested number of neighboring passages before and after it in document order. An unknown locator SHALL produce a not-found result, not an error.

#### Scenario: Resolve with context
- **WHEN** a locator is resolved with two passages of context
- **THEN** the passage and up to two passages before and after it in the same section are returned in order

#### Scenario: Unknown locator
- **WHEN** a locator does not match any passage and was never issued
- **THEN** the system returns a not-found result

### Requirement: Resolution of locators from earlier parser versions
When a locator issued under an earlier parser version is resolved, the system SHALL follow the edition's recorded locator mapping and return the current passage as if its current locator had been given, together with that current locator and an indication that the input was superseded. A locator recorded as removed SHALL produce a distinct "moved or removed" result, never a different passage's text. Quote verification SHALL follow the same mapping.

#### Scenario: Resolve a superseded locator
- **WHEN** a locator from parser version 1 is resolved after the edition was reparsed with version 2
- **THEN** the mapped version 2 passage is returned along with its current locator and a superseded indication

#### Scenario: Resolve a removed locator
- **WHEN** a locator recorded as removed is resolved
- **THEN** the system returns a "moved or removed" result that is distinguishable from not-found

#### Scenario: Verify a quote against a superseded locator
- **WHEN** a quote taken from a version 1 passage is verified against its version 1 locator after a reparse that only renumbered passages
- **THEN** verification runs against the mapped current passage and succeeds

### Requirement: Quote verification
The system SHALL verify whether a quoted string appears in the passage identified by a locator, ignoring differences in whitespace, letter case, and typographic quote and dash variants, and SHALL report the matching character range when it does.

#### Scenario: Quote with straight quotes
- **WHEN** the passage contains `“So we beat on,”` and the quote `"so we beat on,"` is verified against it
- **THEN** verification succeeds and reports the matching range

#### Scenario: Fabricated quote
- **WHEN** a quote that does not appear in the passage is verified
- **THEN** verification fails

### Requirement: Retrieval is an internal service boundary
Search, citation resolution, and quote verification SHALL be available to other server-side modules through a typed interface, independent of the UI, so later capabilities can use the same bounded retrieval.

#### Scenario: Server-side caller
- **WHEN** a server-side module calls the search interface with an edition, query, and maximum position
- **THEN** it receives the same bounded results the UI would receive for that input

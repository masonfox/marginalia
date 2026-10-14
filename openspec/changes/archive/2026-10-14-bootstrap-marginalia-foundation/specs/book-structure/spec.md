## Purpose

Turns an EPUB edition into canonical, ordered, citable text — metadata, sections, table of contents, passages, and footnotes — with stable edition-specific locators and a reading-order position that later capabilities use for citations and spoiler boundaries.

## ADDED Requirements

### Requirement: Extract edition metadata
The system SHALL extract title, authors (in declared order), language, publisher, publication date, identifiers (such as ISBN), and description from the EPUB package document, and SHALL extract the cover image when one is declared. Missing optional fields SHALL be left empty; a missing title SHALL fall back to the file name without extension.

#### Scenario: EPUB 3 metadata
- **WHEN** an EPUB 3 package declares a title, two creators, a language, and an ISBN identifier
- **THEN** the edition shows that title, both authors in declared order, the language, and the ISBN

#### Scenario: Missing title
- **WHEN** an EPUB package declares no title
- **THEN** the edition title is the source file name without its extension

### Requirement: Support EPUB 2 and EPUB 3
The system SHALL parse both EPUB 2 (OPF 2 with NCX table of contents) and EPUB 3 (OPF 3 with navigation document) publications. When an EPUB 3 publication has no navigation document but has an NCX, the NCX SHALL be used.

#### Scenario: EPUB 2 publication
- **WHEN** an EPUB 2 file with an NCX table of contents is ingested
- **THEN** its sections, table of contents, and passages are extracted

#### Scenario: EPUB 3 publication
- **WHEN** an EPUB 3 file with a navigation document is ingested
- **THEN** its sections, table of contents, and passages are extracted

### Requirement: Sections follow the spine
The system SHALL create one section per spine item, in spine order, recording whether the item is linear. Each section SHALL carry the title of the table-of-contents entry that points into it, if any.

#### Scenario: Spine order
- **WHEN** an EPUB's spine lists three content documents
- **THEN** the edition has three sections in that order

#### Scenario: Non-linear item
- **WHEN** a spine item is marked `linear="no"`
- **THEN** its section is recorded as non-linear

### Requirement: Table of contents hierarchy
The system SHALL extract the table of contents as a nested hierarchy of entries, each with its label, nesting level, and the passage it points to (resolving fragment identifiers to the passage containing that element, or to the first passage of the section when no fragment is given).

#### Scenario: Nested parts and chapters
- **WHEN** a navigation document nests chapters within parts
- **THEN** the table of contents preserves that nesting and each entry resolves to a passage

#### Scenario: Entry points into the middle of a document
- **WHEN** a table-of-contents entry links to `chapter.xhtml#ch3`
- **THEN** the entry resolves to the passage containing the element with id `ch3`

### Requirement: Block-level passage segmentation
The system SHALL segment each section's content into passages at block-level elements (paragraphs, headings, list items, block quotes, preformatted blocks, table cells' containing rows, and definition list items), SHALL preserve verse and line breaks as newlines, SHALL normalize other whitespace, and SHALL exclude scripts, styles, and empty blocks. Each passage SHALL record its kind (such as heading, paragraph, quote, list item, or footnote).

#### Scenario: Paragraphs become passages
- **WHEN** a section contains five non-empty paragraphs
- **THEN** five passages of kind paragraph are created with their text in document order

#### Scenario: Verse line breaks
- **WHEN** a paragraph of poetry uses `<br/>` between lines
- **THEN** the passage text contains those lines separated by newline characters

#### Scenario: Very long block
- **WHEN** a single block exceeds the maximum passage length
- **THEN** it is split at sentence boundaries into consecutive passages that together contain the full text, each no longer than the maximum unless a single sentence exceeds it

### Requirement: Footnotes and endnotes
The system SHALL identify notes — elements marked with the EPUB `footnote`, `endnote`, `rearnote`, or `note` semantic types, or targets of links marked `noteref` — as passages of kind footnote, and SHALL record links from each referencing passage to the note passage it references.

#### Scenario: EPUB 3 footnote
- **WHEN** a paragraph contains `<a epub:type="noteref" href="#fn1">` and an `<aside epub:type="footnote" id="fn1">` exists
- **THEN** the aside becomes a footnote passage linked from the referencing paragraph

#### Scenario: Endnotes in a separate document
- **WHEN** note references point to an endnotes document elsewhere in the spine
- **THEN** each endnote becomes a footnote passage linked from its referencing passage

### Requirement: Stable edition-specific locators
Every passage SHALL have a locator that is unique within its edition, identifies the edition, the parser version that produced it, the section, and the passage, and is deterministic: ingesting the same file bytes with the same parser version SHALL produce identical locators and identical passage text. Because locators include the parser version, a locator issued under one parser version SHALL never be identical to a locator issued under another. Every passage SHALL also record an EPUB CFI pointing to its element.

#### Scenario: Re-ingesting the same file
- **WHEN** the same EPUB bytes are ingested twice with the same parser version
- **THEN** every passage has the same locator and text both times

#### Scenario: Locator identifies the edition
- **WHEN** two editions of the same title are ingested
- **THEN** no locator from one edition resolves to a passage in the other

### Requirement: Reading-order position
Every passage SHALL have an integer reading-order position. Passages in linear sections SHALL be numbered in strictly increasing order following spine and document order. Each passage SHALL also have a reveal position: equal to its own position for linear-section passages; for a footnote, the position of the first passage that references it; and for an unreferenced passage in a non-linear section, a value greater than every linear position. The edition SHALL record its total count of linear passages.

#### Scenario: Ordering across chapters
- **WHEN** chapter 2 follows chapter 1 in the spine
- **THEN** every passage in chapter 2 has a greater position than every passage in chapter 1

#### Scenario: Footnote reveal position
- **WHEN** a footnote in an endnotes section is first referenced from a passage at position 120
- **THEN** the footnote's reveal position is 120

#### Scenario: Unreferenced appendix
- **WHEN** a non-linear section contains passages that nothing references
- **THEN** those passages have a reveal position after the last linear passage

### Requirement: Parser versioning and reindexing
The system SHALL record the parser version used for each edition. When the application's parser version is newer than an edition's, the system SHALL allow that edition to be reparsed, replacing its structure atomically so that readers never observe a partially replaced edition.

#### Scenario: Reparse after parser upgrade
- **WHEN** an edition parsed with an older parser version is reparsed
- **THEN** its sections and passages are replaced in a single transaction and its parser version is updated

### Requirement: Locators survive reparsing
When an edition is reparsed, the system SHALL record, in the same transaction that replaces the structure, a mapping from every locator of the previous structure to the passage that now holds its text, so that every locator ever issued for the edition remains resolvable. Old passages SHALL be matched to new passages in reading order: first by identical normalized text, then — for passages whose text was split across several new passages or merged into one — by greatest text overlap within the same stretch of the book. An old passage with no sufficiently overlapping new passage SHALL be recorded as removed. Mappings recorded by earlier reparses SHALL be updated so that every historical locator maps directly to a current passage.

#### Scenario: Unchanged passage
- **WHEN** a passage's text is identical before and after a reparse but its locator changes
- **THEN** its old locator maps to the new locator of the passage with that text

#### Scenario: Repeated text
- **WHEN** a book contains the same sentence as separate passages in two chapters and both are renumbered by a reparse
- **THEN** each old locator maps to the new passage in its own chapter, not to the other occurrence

#### Scenario: Passage split by the new parser
- **WHEN** a passage under the old parser version becomes two passages under the new one
- **THEN** its old locator maps to the new passage containing the beginning of its text

#### Scenario: Passages merged by the new parser
- **WHEN** two passages under the old parser version become one passage under the new one
- **THEN** both old locators map to the merged passage

#### Scenario: Passage removed by the new parser
- **WHEN** an old passage's text no longer appears in any new passage (for example, boilerplate the new parser excludes)
- **THEN** its old locator is recorded as removed

#### Scenario: Two successive reparses
- **WHEN** an edition is reparsed from version 1 to 2 and later from version 2 to 3
- **THEN** locators issued under version 1 and version 2 both map directly to version 3 passages

### Requirement: Canonical text is separate from derived data
Passage text and structure SHALL be stored only as extracted from the EPUB and SHALL NOT be altered by AI-generated or user-generated content.

#### Scenario: Canonical text integrity
- **WHEN** a passage is retrieved by locator
- **THEN** its text is exactly the text produced by the parser for that edition and parser version

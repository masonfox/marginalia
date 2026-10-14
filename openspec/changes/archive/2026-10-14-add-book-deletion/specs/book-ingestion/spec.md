## ADDED Requirements

### Requirement: Delete an edition
The system SHALL allow a user to permanently delete an edition in any status (processing, ready, failed, or unavailable). Deleting an edition SHALL remove its metadata, sections, passages, table of contents, note links, locator mappings, its uploaded copy and upload source records, and its stored cover image, and SHALL complete without leaving partial data visible to readers. The system SHALL NEVER create, modify, or delete files inside a library directory as part of deletion.

#### Scenario: Delete an uploaded book
- **WHEN** a user deletes a ready edition that was uploaded
- **THEN** the edition no longer appears in the library, its passages no longer appear in any search, its cover image is no longer served, and its uploaded EPUB file is removed from application storage

#### Scenario: Delete a book from a library directory
- **WHEN** a user deletes an edition whose EPUB is in a configured library directory
- **THEN** the edition and all its stored data are removed and the EPUB file in the library directory is left unchanged

#### Scenario: Delete a failed import
- **WHEN** a user deletes an edition whose import failed
- **THEN** the edition and its failure reason no longer appear in the library

#### Scenario: Delete during ingestion
- **WHEN** a user deletes an edition while its ingestion or reparse is in progress
- **THEN** the edition stays deleted, the in-progress job finishes without recreating any of its data or reporting a failure, and no cover image is left in application storage

#### Scenario: Locators of a deleted edition
- **WHEN** a locator belonging to a deleted edition is resolved or quote-verified
- **THEN** the result is "not found", the same as for a locator that was never issued

#### Scenario: Edition already deleted
- **WHEN** a delete is requested for an edition that does not exist
- **THEN** the request reports that the book was not found and nothing else is changed

### Requirement: Deleted editions stay excluded from scans
When an edition is deleted, the system SHALL record its content hash as excluded. Scans SHALL NOT create an edition or enqueue ingestion for a library file whose content hash is excluded. Uploading a file whose content hash is excluded SHALL remove the exclusion and import the file as a new edition, after which library files with the same content SHALL again be treated as sources of that edition.

#### Scenario: Rescan after deleting a scanned book
- **WHEN** an edition from a library directory has been deleted and the library is rescanned, including a full rescan that re-hashes every file
- **THEN** no edition is created for that file and no ingestion is enqueued

#### Scenario: Copy of a deleted book at a new path
- **WHEN** a file with the same bytes as a deleted edition is added to a library directory at a different path
- **THEN** the scan does not import it

#### Scenario: Re-upload a deleted book
- **WHEN** a user uploads a file whose bytes are identical to a deleted edition
- **THEN** the exclusion is removed, the book is imported as a new edition with status "processing", and a later scan lists any library copy of the same bytes as an additional source

## MODIFIED Requirements

### Requirement: Scan read-only library mounts
The system SHALL scan each configured library directory recursively for files with the `.epub` extension, on startup, on a configurable interval, and on demand from the UI, and SHALL NEVER create, modify, or delete files inside a library directory. Files whose content hash is excluded because their edition was deleted SHALL NOT be imported.

#### Scenario: New file in library
- **WHEN** a scan finds an EPUB file that has not been seen before and whose content hash is not excluded
- **THEN** the file is hashed and ingestion is enqueued for it

#### Scenario: Library mounted read-only
- **WHEN** a library directory is mounted read-only
- **THEN** scanning and ingestion succeed without errors caused by the lack of write access

#### Scenario: Manual rescan
- **WHEN** a user triggers a rescan from the UI
- **THEN** a scan of all configured libraries is enqueued, unless one is already pending or running

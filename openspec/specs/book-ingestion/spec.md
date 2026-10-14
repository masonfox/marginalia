# book-ingestion Specification

## Purpose

Brings the reader's EPUB files into Marginalia, by upload or by scanning read-only library mounts, identifying each edition by its content so books are imported exactly once and unchanged files are never reprocessed.

## Requirements

### Requirement: Upload EPUB files
The system SHALL accept EPUB file uploads through the web UI, SHALL store each accepted file in persistent application storage, and SHALL enqueue ingestion for it.

#### Scenario: Successful upload
- **WHEN** a user uploads a valid EPUB file within the size limit
- **THEN** the file is stored, the book appears in the library with status "processing", and it becomes "ready" once ingestion completes

#### Scenario: Upload exceeds size limit
- **WHEN** a user uploads a file larger than the configured maximum upload size
- **THEN** the upload is rejected with a message stating the limit, and nothing is stored

#### Scenario: Upload is not an EPUB
- **WHEN** a user uploads a file that is not a ZIP container with an EPUB `mimetype` or `META-INF/container.xml`
- **THEN** the upload is rejected with a message that the file is not a valid EPUB, and nothing is stored

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

### Requirement: Content-hash edition identity
The system SHALL identify each edition by the SHA-256 hash of the EPUB file bytes. Two files with identical bytes SHALL map to one edition; files that differ in any byte SHALL map to different editions.

#### Scenario: Same file uploaded and present in library
- **WHEN** a file is uploaded whose bytes are identical to a file already ingested from a library mount
- **THEN** no new edition is created, the existing edition is shown, and the upload is recorded as an additional source of that edition

#### Scenario: Different edition of the same title
- **WHEN** two EPUBs of the same title with different bytes are imported
- **THEN** two distinct editions exist, each with its own passages and locators

### Requirement: Skip unchanged files
On rescan, the system SHALL NOT re-hash or re-ingest a library file whose path, size, and modification time are unchanged since the last successful scan.

#### Scenario: Rescan with no changes
- **WHEN** a library is rescanned and no file has changed
- **THEN** no ingestion jobs are enqueued and no file contents are read

#### Scenario: File replaced with new content
- **WHEN** a library file at an existing path is replaced with different bytes
- **THEN** the new content is hashed and ingested as a new edition, and the path is associated with the new edition

### Requirement: Handle removed library files
When a previously seen library file is no longer present, the system SHALL mark that file source as missing and SHALL NOT delete the edition or its passages. An edition with no remaining available source SHALL be shown as unavailable but remain readable and searchable.

#### Scenario: File deleted from library
- **WHEN** a scan no longer finds a previously ingested library file and the edition has no other source
- **THEN** the edition is marked unavailable in the library and its passages remain searchable

#### Scenario: File returns
- **WHEN** a file marked missing reappears with the same content
- **THEN** its source is marked available again without re-ingesting

### Requirement: Report import failures
The system SHALL record a human-readable reason when an EPUB cannot be ingested (for example a corrupt archive, missing package document, or DRM-encrypted content) and SHALL show it in the library without blocking other imports.

#### Scenario: DRM-protected file
- **WHEN** ingestion encounters an EPUB whose content documents are encrypted (as declared in `META-INF/encryption.xml` for content other than fonts)
- **THEN** the import is marked failed with the reason "DRM-protected content is not supported" and other imports continue

#### Scenario: Corrupt archive
- **WHEN** ingestion encounters a file that cannot be read as a ZIP archive
- **THEN** the import is marked failed with a reason describing the corruption

#### Scenario: Retry a failed import
- **WHEN** a user requests a retry for a failed import
- **THEN** ingestion is enqueued again for that file

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

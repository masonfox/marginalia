## Purpose

Brings the reader's EPUB files into Marginalia, by upload or by scanning read-only library mounts, identifying each edition by its content so books are imported exactly once and unchanged files are never reprocessed.

## ADDED Requirements

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
The system SHALL scan each configured library directory recursively for files with the `.epub` extension, on startup, on a configurable interval, and on demand from the UI, and SHALL NEVER create, modify, or delete files inside a library directory.

#### Scenario: New file in library
- **WHEN** a scan finds an EPUB file that has not been seen before
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

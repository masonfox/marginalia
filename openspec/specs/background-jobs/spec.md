# background-jobs Specification

## Purpose

Provides durable, PostgreSQL-backed execution of background work such as library scans, ingestion, and indexing, so that this work is reliable, idempotent, and observable without extra infrastructure.

## Requirements

### Requirement: Durable job execution
Background work SHALL be recorded in PostgreSQL before execution and SHALL survive application restarts; a job interrupted by a restart SHALL be executed again after the application returns.

#### Scenario: Restart during a job
- **WHEN** the application stops while an ingestion job is running
- **THEN** after restart the job is picked up again and runs to completion

### Requirement: Job deduplication by key
Each job kind SHALL define a deduplication key, and the system SHALL NOT enqueue a second pending or running job with the same kind and key.

#### Scenario: Duplicate ingestion request
- **WHEN** ingestion of the same file content is requested twice before the first job finishes
- **THEN** only one ingestion job exists for that content

### Requirement: Idempotent job handlers
Executing a job more than once with the same input SHALL produce the same persisted result as executing it once, with no duplicate records.

#### Scenario: Ingestion re-run after partial failure
- **WHEN** an ingestion job fails after writing some passages and is retried
- **THEN** the edition ends with exactly one complete set of sections and passages

### Requirement: Retries with backoff
Failed jobs SHALL be retried with increasing delay up to a per-kind maximum number of attempts, after which the job SHALL be marked failed with its last error recorded.

#### Scenario: Transient failure
- **WHEN** a job fails once due to a transient error and succeeds on retry
- **THEN** the job is marked completed and its result is persisted

#### Scenario: Permanent failure
- **WHEN** a job fails on every attempt up to its maximum
- **THEN** the job is marked failed and its last error message is retrievable

### Requirement: Bounded concurrency
The system SHALL limit how many jobs of each kind run concurrently, with limits configurable by environment variable, so that ingestion does not starve request handling.

#### Scenario: Many files discovered at once
- **WHEN** a library scan discovers more new files than the ingestion concurrency limit
- **THEN** no more than the configured number of ingestion jobs run at the same time and the rest wait

### Requirement: Worker can be disabled per process
The system SHALL allow job processing to be disabled for a given application process by configuration, while that process still enqueues jobs.

#### Scenario: Web-only process
- **WHEN** an instance starts with job processing disabled and a user uploads a book
- **THEN** the ingestion job is enqueued but not executed by that instance

### Requirement: Recurring jobs
The system SHALL support jobs scheduled on a fixed interval, and SHALL run at most one instance of a given recurring job at a time across all processes.

#### Scenario: Two instances share a database
- **WHEN** two application instances with job processing enabled share one database
- **THEN** each scheduled library scan runs once per interval, not once per instance

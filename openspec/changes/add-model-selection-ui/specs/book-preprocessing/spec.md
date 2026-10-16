## MODIFIED Requirements

### Requirement: Preprocessing job
Preprocessing SHALL run as an `analysis.preprocess` background job, one per edition and deduplicated by edition. The provider and model of a job SHALL be fixed when it is enqueued, from the reader's choice or otherwise the preprocessing default at that time, and every attempt and retry of the job SHALL use them. The job SHALL split work per reading unit, SHALL skip units that already have a current summary and observations, and SHALL record each unit's result as it completes, so that a retry repeats only unfinished units. A failed unit SHALL NOT discard completed units. Handlers SHALL be idempotent. When no provider is available, or the model the job would use cannot be resolved or names a provider without credentials, the system SHALL NOT enqueue the job. A queued job whose provider loses its credentials before it runs SHALL fail with an error naming the unavailable model and SHALL NOT call another model.

#### Scenario: Retry after partial failure
- **WHEN** a job fails on unit 17 of 30 and is retried
- **THEN** units 1 to 16 are not processed again, processing resumes at unit 17, and the retry uses the job's original model

#### Scenario: Duplicate request
- **WHEN** preprocessing is requested twice for one edition while a job is pending or running, the second time with a different model
- **THEN** only one job exists, it keeps its original model, and the second request reports that a run is already in progress with that model

#### Scenario: AI not configured
- **WHEN** no provider has credentials and preprocessing is requested
- **THEN** no job is enqueued and the request reports that AI is not configured

#### Scenario: Default changed after enqueue
- **WHEN** a job is queued and the preprocessing default is changed before it starts
- **THEN** the job runs with the model it was enqueued with

### Requirement: Triggers
When automatic preprocessing is enabled, the system SHALL enqueue the job at the end of a successful ingest and of a successful reparse, using the preprocessing default. If the default cannot be resolved at that moment, the system SHALL skip enqueuing and log a warning that names no secrets. Independently of that setting, a reader SHALL be able to start or restart preprocessing for an edition from its detail page, choosing the provider and model for the run with the preprocessing default preselected. The choice SHALL apply to that run only and SHALL NOT change the default. Automatic preprocessing SHALL default to off.

#### Scenario: Automatic on ingest
- **WHEN** automatic preprocessing is enabled and a book finishes ingest
- **THEN** a preprocessing job is enqueued for it with the preprocessing default

#### Scenario: Automatic off
- **WHEN** automatic preprocessing is off and a book finishes ingest
- **THEN** no job is enqueued until a reader requests it

#### Scenario: Reader picks a cheaper model for one book
- **WHEN** a reader starts preprocessing for a long book and chooses a small model instead of the preselected default
- **THEN** the run uses the small model, and the next run for another book preselects the unchanged default

#### Scenario: Resume with a different model
- **WHEN** a run was cancelled after 10 of 30 units and the reader restarts it with a different model
- **THEN** units 11 to 30 are processed with the new model and units 1 to 10 keep the model recorded when they were produced

### Requirement: Status
The system SHALL expose, per edition, preprocessing status (not started, queued, running, complete, partially failed, cancelled, or stale), the number of units done out of total, the provider and model of the queued, running, or last run, the preprocessing default that a new run would preselect, and the last error. Status SHALL never include credentials.

#### Scenario: Progress
- **WHEN** 12 of 30 units are done and the job is running
- **THEN** status reports running with 12 of 30 and the run's provider and model

#### Scenario: Stale after reparse
- **WHEN** an edition was preprocessed and then reparsed
- **THEN** status reports stale until regenerated

#### Scenario: Run model differs from default
- **WHEN** an edition's last run used a small model and the preprocessing default is a different model
- **THEN** status shows the small model for the last run and the default as the model a new run would preselect

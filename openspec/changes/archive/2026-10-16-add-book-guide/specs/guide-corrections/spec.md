## Purpose

Lets readers fix or hide generated summaries and observations through a durable overlay that survives regeneration and reparsing, without editing machine rows or canonical text.

## ADDED Requirements

### Requirement: Correction overlay
The reader SHALL be able to replace the text of a unit summary or an observation note, or suppress either one as wrong. A correction SHALL be stored separately from machine rows, which SHALL NOT be modified. A summary correction SHALL be keyed by edition and the unit's anchor (the locator of the unit's first passage). An observation correction SHALL be keyed by edition, unit anchor, and the observation's normalized name. A correction SHALL apply to every current observation of that name in that unit. The reader SHALL be able to remove a correction, which restores the machine row.

#### Scenario: Replace a summary
- **WHEN** a reader replaces the summary of Chapter 4
- **THEN** every view of Chapter 4's summary shows the reader's text

#### Scenario: Suppress an observation
- **WHEN** a reader suppresses the "Lamia" observation in Chapter 6
- **THEN** it no longer appears in the Index, timelines, glosses, or assistant results

#### Scenario: Remove a correction
- **WHEN** the reader removes their correction of Chapter 4
- **THEN** the generated summary is shown again

### Requirement: Merged view
Every read of derived data for the reader or the assistant SHALL return the merged view. A replaced row SHALL carry the reader's text. Its citations SHALL be only the citation the reader supplied, if any. A suppressed row SHALL be omitted. A correction SHALL be visible only where the row it corrects is visible: it SHALL follow the same bound and staleness rules. A correction whose machine row is not current SHALL NOT be shown, and SHALL apply again when the row is regenerated.

#### Scenario: Bounded like the row
- **WHEN** Chapter 20's summary is corrected and the bound is Chapter 12
- **THEN** neither the correction nor the summary is shown

#### Scenario: Reapplied after regeneration
- **WHEN** Chapter 4 is regenerated under a new prompt version
- **THEN** the reader's correction of Chapter 4 applies to the regenerated summary

### Requirement: Regenerated since correction
A correction SHALL record a fingerprint of the machine text it corrected. When the current machine row's text no longer matches that fingerprint, the correction SHALL still apply, and SHALL be flagged "regenerated since your correction". The reader SHALL be able to keep the correction, which clears the flag, or drop it.

#### Scenario: Flag after regeneration
- **WHEN** a corrected summary is regenerated with different text
- **THEN** the Guide shows the correction flagged "regenerated since your correction", with actions to keep or drop it

### Requirement: Re-anchoring after reparse
On reparse, each correction's unit anchor SHALL be forwarded to the passage that now holds its text. When the forwarded anchor is the first passage of a current reading unit, the correction SHALL apply to that unit. Otherwise the correction SHALL be marked detached: it SHALL NOT apply anywhere, and it SHALL be listed in the Guide for the reader to drop. A detached correction SHALL NOT be shown to the assistant.

#### Scenario: Positions shift
- **WHEN** a reparse shifts Chapter 4's positions but its first passage survives
- **THEN** the correction still applies to Chapter 4

#### Scenario: Unit boundary moved
- **WHEN** a reparse merges Chapter 4 into Chapter 3 so Chapter 4's first passage no longer starts a unit
- **THEN** the correction is listed as detached and applies nowhere

### Requirement: Correction provenance and citation
A corrected item SHALL be shown as "corrected by reader". A suppressed item SHALL remain listable in the Guide behind a "show hidden" control so the reader can restore it. The reader SHALL be able to attach at most one citation (a locator and an exact quote) to a correction. The citation SHALL be restricted to passages of the corrected unit, SHALL be verified against stored passage text the same way generated citations are, and SHALL be shown verified or unverified accordingly.

#### Scenario: Corrected label
- **WHEN** a corrected observation is shown in a timeline
- **THEN** it is marked "corrected by reader"

#### Scenario: Citation outside the unit
- **WHEN** a reader attaches a citation from Chapter 9 to a correction of Chapter 4
- **THEN** the citation is rejected

### Requirement: Corrections deleted with the edition
Deleting an edition SHALL delete its corrections.

#### Scenario: Edition deleted
- **WHEN** an edition is deleted
- **THEN** its corrections no longer exist

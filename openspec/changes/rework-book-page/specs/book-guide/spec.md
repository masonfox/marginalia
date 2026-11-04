## MODIFIED Requirements

### Requirement: Guide for a book
Every ready edition SHALL have a Guide, shown as the Guide tab of its book page under the book page's shared header, with three views: Chapters, Index, and Notes. Each view SHALL keep its existing URL. The Guide tab SHALL show preprocessing status and actions (see library-browsing). When the edition has no current preprocessing, Chapters and Index SHALL say so and point to the preprocessing action on the same tab, and Notes SHALL still work. The Guide SHALL work whether or not an AI provider is configured, and SHALL make no model calls.

#### Scenario: Open the Guide
- **WHEN** a reader opens the Guide of a preprocessed book
- **THEN** Chapters, Index, and Notes views are offered under the book page header, with the Guide tab marked as current

#### Scenario: Not preprocessed
- **WHEN** a reader opens the Guide of a book with no current preprocessing
- **THEN** Chapters and Index say no guide data exists yet and point to the preprocessing action on the Guide tab, and Notes is still usable

#### Scenario: Existing Guide links
- **WHEN** a reader opens a Guide chapters, index, subject, or note URL saved before this change
- **THEN** the same view opens, now within the book page's Guide tab

## MODIFIED Requirements

### Requirement: Library list
The system SHALL list editions in title order (case-insensitive), each with cover thumbnail (or a placeholder), title, authors, and one status. An edition that is processing, failed, or unavailable SHALL show that status, and a failed edition SHALL show the failure reason with an action to retry. A ready edition SHALL show its reading state instead: "Not started" when it has no reading position, "Finished" when its position is finished, and "Reading" otherwise. The list SHALL show how many editions the library holds.

#### Scenario: Mixed statuses
- **WHEN** the library contains one processing book, one failed book, and one ready book with no reading position
- **THEN** the books show Processing, Failed, and Not started, and the failed book shows its reason and a retry action

#### Scenario: Reading states
- **WHEN** the library contains ready books with no position, a position at Chapter 3, and a finished position
- **THEN** they show Not started, Reading, and Finished, and none of them shows "Ready"

#### Scenario: Unavailable book with a position
- **WHEN** a ready book with a reading position has no available source file
- **THEN** it shows Unavailable

#### Scenario: Empty library
- **WHEN** no books have been imported
- **THEN** the library shows guidance to upload a book or configure a library directory

## ADDED Requirements

### Requirement: Library list loads as the reader scrolls
The library list SHALL load editions in pages and SHALL load the next page when the reader scrolls near the end of the loaded books, without a pagination control, until every matching edition is shown. An edition SHALL appear at most once while the reader scrolls, even when books are imported or deleted in the meantime. The list SHALL remain usable for libraries of up to 5,000 editions. When the reader opens a book and returns with the browser's back action, the list SHALL show the same search, filter, and loaded books.

#### Scenario: Scroll to load more
- **WHEN** the library holds more books than the first page and the reader scrolls to the end of the list
- **THEN** the next books in title order are added to the list, and loading stops after the last book

#### Scenario: Import during scrolling
- **WHEN** a book whose title sorts before the loaded books finishes importing while the reader scrolls
- **THEN** no book already in the list appears a second time

#### Scenario: Back from a book
- **WHEN** the reader has scrolled past the first page, opens a book, and goes back
- **THEN** the library shows the same books loaded, with the same search and filter

### Requirement: Search the library by title and author
The library page SHALL provide a search box that narrows the list to editions whose title, or any of whose authors, contains the search text, ignoring case and surrounding whitespace. Results SHALL keep title order and load as the reader scrolls. The list SHALL update as the reader types, without a submit action. While a search is active, the count SHALL show the matching books out of the library total. The search text SHALL be kept in the page URL, so reloading or opening the URL shows the same results, and typing SHALL NOT add a browser history entry for every change.

#### Scenario: Search by title
- **WHEN** the reader types "lighthouse" and the library contains "To the Lighthouse"
- **THEN** the list shows that book, and the count reads as matching books out of the total

#### Scenario: Search by author
- **WHEN** the reader types "woolf"
- **THEN** every book with an author whose name contains "Woolf" is listed, and no other book

#### Scenario: Shared link
- **WHEN** a reader opens the library URL that includes a search
- **THEN** the search box holds that text and the list shows its results

#### Scenario: No match
- **WHEN** a search matches no book
- **THEN** the page says that no books match and offers to clear the search and filter, instead of the upload guidance

### Requirement: Filter the library by status
The library page SHALL offer a status filter with the options All, Not started, Reading, Finished, and Needs attention. Not started, Reading, and Finished SHALL match ready editions in that reading state. Needs attention SHALL match editions that are processing, failed, or unavailable. Needs attention SHALL be offered only while at least one edition is in one of those states, or while it is the selected filter. The filter SHALL combine with the search, so a book is listed only when it matches both. The filter SHALL be kept in the page URL like the search.

#### Scenario: Filter to books being read
- **WHEN** the reader chooses Reading
- **THEN** only ready books with a reading position that is not finished are listed

#### Scenario: Filter with search
- **WHEN** the reader chooses Finished and searches "woolf"
- **THEN** only finished books by an author matching "woolf", or with a title matching it, are listed

#### Scenario: Needs attention
- **WHEN** one import has failed and the reader chooses Needs attention
- **THEN** the failed book is listed with its reason and retry action, and ready books are not

#### Scenario: Nothing needs attention
- **WHEN** every book is ready
- **THEN** the filter does not offer Needs attention

#### Scenario: Status changes while filtered
- **WHEN** the reader filters to Needs attention and a processing book finishes importing
- **THEN** the book leaves the list within a few seconds without a reload

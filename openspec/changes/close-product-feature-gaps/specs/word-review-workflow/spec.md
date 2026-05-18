# Word Review Workflow Specification

## Purpose
Provide a complete Word-native contract review workflow that turns Livebook review findings into user-approved comments and redlines while preserving existing tabular review behavior.

## ADDED Requirements

### Requirement: Full-Document Review From Word
The system SHALL let a user run a review against the active Microsoft Word document or a supported uploaded contract and return review findings for the reviewed document.

#### Scenario: Review active Word document
- GIVEN a user has an active Word document available to the add-in
- WHEN the user starts a full-document review
- THEN the system returns review findings for the document
- AND each finding includes severity, status, confidence, issue summary, source location when available, and recommended next action

#### Scenario: Word context unavailable
- GIVEN the Word add-in cannot read the active document
- WHEN the user starts a full-document review
- THEN the system does not create review findings
- AND the UI explains that document context is unavailable
- AND the UI offers a retry or upload-based alternative when available

### Requirement: Review Finding Organization
The system SHALL show findings grouped and filterable by severity, clause, and status.

#### Scenario: User filters findings by severity
- GIVEN a completed review has findings across multiple severity levels
- WHEN the user filters to high severity
- THEN only high-severity findings are shown
- AND the review summary still indicates the total number of hidden findings

#### Scenario: User reviews status groups
- GIVEN findings have pending, applied, skipped, and rejected statuses
- WHEN the user selects a status group
- THEN the UI shows only findings in that status
- AND status changes are reflected without rerunning the review

### Requirement: Comments And Redline Suggestions
The system SHALL generate a proposed comment and redline suggestion for each issue when enough context exists.

#### Scenario: Finding has enough context
- GIVEN a review finding is grounded in document text and playbook guidance
- WHEN the finding is displayed
- THEN the UI shows a proposed comment
- AND the UI shows proposed replacement or insertion language when a redline is appropriate
- AND the UI exposes the grounding used for the suggestion

#### Scenario: Finding lacks enough context
- GIVEN a review finding is low-confidence or lacks enough source context
- WHEN the finding is displayed
- THEN the UI marks the suggestion as low-confidence
- AND the finding is not eligible for bulk apply
- AND the user can still inspect, edit, skip, reject, or escalate it

### Requirement: Apply, Edit, Skip, Accept, And Reject
The system SHALL let users apply, edit before applying, skip, accept, or reject individual suggestions.

#### Scenario: User applies one redline
- GIVEN a pending finding has a redline suggestion
- WHEN the user applies the redline
- THEN the change is inserted into the Word document as a reviewable change
- AND the finding status becomes applied
- AND the applied action is recorded with timestamp and actor

#### Scenario: User edits before applying
- GIVEN a pending finding has suggested replacement language
- WHEN the user edits the language and applies it
- THEN the edited language is inserted into the Word document
- AND the finding records both the original suggestion and the applied edited language

#### Scenario: User rejects a finding
- GIVEN a pending finding is not relevant
- WHEN the user rejects the finding
- THEN no document change is applied
- AND the finding status becomes rejected
- AND the rejected finding remains visible in review history

### Requirement: Bulk Approval
The system SHALL support bulk approval for selected findings that are eligible for application.

#### Scenario: User bulk-applies high-confidence findings
- GIVEN a review has multiple pending high-confidence findings with suggested fixes
- WHEN the user selects those findings and confirms bulk apply
- THEN each selected suggestion is applied as a reviewable document change
- AND any ineligible finding remains unapplied with a reason
- AND the review summary reports applied and skipped counts

#### Scenario: User confirms before bulk mutation
- GIVEN selected findings would change the document
- WHEN the user chooses bulk apply
- THEN the UI shows a confirmation summary of the selected changes
- AND no document change is made until the user confirms

### Requirement: Audit Trail
The system SHALL preserve an audit trail for every generated, applied, edited, skipped, accepted, and rejected suggestion.

#### Scenario: User views review history
- GIVEN a review has completed user actions
- WHEN the user opens the review history
- THEN the system shows each finding action, actor, timestamp, original suggestion, final applied text when applicable, and status

### Requirement: Tabular Review Compatibility
The system SHALL keep existing Livebook tabular review behavior compatible with the Word review workflow.

#### Scenario: Existing tabular review remains usable
- GIVEN a user has a tabular review session
- WHEN the Word review workflow is added
- THEN the user can still open and use the tabular review session
- AND tabular review rows can still be used as a source for Word comments or redlines where currently supported

# Proofread Final Check Specification

## Purpose
Add a final cleanup workflow that finds drafting and consistency issues separately from legal-risk review.

## Requirements

### Requirement: Separate Proofread Workflow
The system SHALL provide proofread as a separate workflow from legal-risk review.

#### Scenario: User runs proofread
- GIVEN a user has a document available
- WHEN the user runs proofread
- THEN the system returns non-legal drafting and cleanup findings
- AND proofread findings are visually distinct from legal-risk review findings

#### Scenario: Proofread does not overwrite legal review
- GIVEN a document has existing legal review findings
- WHEN the user runs proofread
- THEN legal review findings remain unchanged
- AND proofread findings are stored and displayed separately

### Requirement: Defined Term Checks
The system SHALL detect defined terms that are never used and capitalized terms that are used but not defined.

#### Scenario: Unused defined term found
- GIVEN a document defines a term that is never used
- WHEN proofread completes
- THEN the system shows an unused-definition finding
- AND the finding identifies the definition location

#### Scenario: Undefined capitalized term found
- GIVEN a document uses a capitalized term that is not defined
- WHEN proofread completes
- THEN the system shows an undefined-term finding
- AND the user can ignore it if intentional

### Requirement: Cross-Reference Checks
The system SHALL detect broken or suspicious cross-references.

#### Scenario: User fixes broken cross-reference
- GIVEN proofread finds a broken section reference
- WHEN the user opens the finding
- THEN the UI shows the reference and likely target if available
- AND the user can apply a correction selectively

### Requirement: Placeholder And Drafting Note Checks
The system SHALL detect placeholders, bracketed text, and internal drafting notes.

#### Scenario: User resolves placeholder
- GIVEN proofread finds bracketed placeholder text
- WHEN the user opens the finding
- THEN the UI shows the placeholder location and text
- AND the user can replace, remove, or ignore it

### Requirement: Language Cleanup Checks
The system SHALL detect typos, grammar issues, and capitalization inconsistencies.

#### Scenario: User applies typo fixes
- GIVEN proofread finds multiple typo suggestions
- WHEN the user selects and applies typo fixes
- THEN only the selected fixes are staged or applied
- AND each fix remains reviewable before final acceptance

#### Scenario: User ignores capitalization issue
- GIVEN proofread reports a capitalization inconsistency
- WHEN the user marks it ignored
- THEN no document change is applied
- AND the finding status becomes ignored

### Requirement: Selective Application
The system SHALL let users apply cleanup fixes selectively.

#### Scenario: User applies one proofread fix
- GIVEN proofread has multiple findings
- WHEN the user applies one finding
- THEN only that finding changes status to applied
- AND other findings remain pending

#### Scenario: Low-confidence cleanup finding
- GIVEN a proofread finding is low-confidence
- WHEN the finding is displayed
- THEN it is labeled low-confidence
- AND it is not included in any default bulk apply selection


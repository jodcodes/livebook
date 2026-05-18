# Proofread Finalization Specification

## Purpose
Provide a final cleanup lane inside Review Center that is separate from legal-risk review and helps users prepare a document for circulation.

## ADDED Requirements

### Requirement: Separate Final Proofread
The system SHALL provide Proofread as a separate Review Center lane from legal review.

#### Scenario: User runs proofread after review
- GIVEN a document has legal review findings
- WHEN the user runs Proofread
- THEN proofread findings are shown separately
- AND legal review findings remain unchanged

### Requirement: Drafting Cleanup Checks
The system SHALL detect placeholders, bracketed drafting notes, typos, grammar issues, capitalization inconsistency, undefined terms, unused definitions, broken references, numbering issues, and inconsistent defined-term usage.

#### Scenario: Placeholder detected
- GIVEN a document contains bracketed placeholder text
- WHEN proofread completes
- THEN the system shows a placeholder finding
- AND the finding includes the affected text or location when available

#### Scenario: Broken reference detected
- GIVEN a document references a section that appears missing or suspicious
- WHEN proofread completes
- THEN the system shows a broken-reference finding
- AND it suggests verification or a likely correction when available

#### Scenario: Defined term issue detected
- GIVEN a document uses an undefined capitalized term
- WHEN proofread completes
- THEN the system shows an undefined-term finding
- AND the user can apply a fix, comment, or ignore it

### Requirement: Finding Groups
The system SHALL group proofread findings by issue type and confidence.

#### Scenario: User filters proofread findings
- GIVEN proofread returned multiple issue types
- WHEN the user filters to typos
- THEN only typo findings are shown
- AND the summary still shows counts for all issue types

### Requirement: Proofread Actions
The system SHALL support apply fix, edit fix, ignore, ignore all like this, comment, and stage as tracked change where available.

#### Scenario: User edits proofread fix
- GIVEN proofread suggests replacement text
- WHEN the user edits and applies the fix
- THEN the edited text is staged or applied
- AND the finding records the edited final text

#### Scenario: User ignores all matching issues
- GIVEN multiple findings are the same issue type and text pattern
- WHEN the user chooses ignore all like this
- THEN matching findings become ignored
- AND non-matching findings remain pending

### Requirement: Finalization Checklist
The system SHALL show a finalization checklist before circulation.

#### Scenario: User opens checklist
- GIVEN proofread has completed
- WHEN the user opens the finalization checklist
- THEN the checklist shows unresolved proofread issues by type and severity
- AND it indicates whether the document has pending reviewable changes

### Requirement: Low-Confidence Handling
The system SHALL label low-confidence proofread findings and exclude them from default bulk actions.

#### Scenario: Low-confidence finding shown
- GIVEN proofread finds a weakly grounded issue
- WHEN the finding is displayed
- THEN it is labeled low-confidence
- AND it is not selected by default for bulk apply

# Review Modes And Redline Summary Specification

## Purpose
Expand the Review Center beyond one generic pass by supporting single-document review modes, batch review continuity, custom instructions, and a redline summary that helps users understand proposed changes before applying them.

## ADDED Requirements

### Requirement: Review Center Lanes
The system SHALL present Single Document Review, Batch Review, and Proofread as distinct lanes inside one Review Center.

#### Scenario: User chooses review lane
- GIVEN the user opens Review
- WHEN Review Center loads
- THEN Single Document Review, Batch Review, and Proofread are shown as separate lanes
- AND each lane explains the kind of result it produces

#### Scenario: Batch review remains available
- GIVEN existing tabular review sessions exist
- WHEN the user opens the Batch Review lane
- THEN prior tabular review sessions remain accessible
- AND they use the same status and activity vocabulary as other Review Center lanes

### Requirement: Review Mode Selection
The system SHALL let users choose General Review, Negotiation Review, or Custom Review before starting a document review.

#### Scenario: User runs general review
- GIVEN a user has an active document
- WHEN the user runs General Review
- THEN the system returns broad legal, business, drafting, and missing-context findings
- AND each finding is labeled with its category

#### Scenario: User runs negotiation review
- GIVEN a user has an active document and party position
- WHEN the user runs Negotiation Review
- THEN the system prioritizes findings that affect negotiating position
- AND suggested language is framed for the selected party position

### Requirement: Custom Review Instructions
The system SHALL let users provide matter-specific custom review instructions.

#### Scenario: User creates custom review
- GIVEN a user wants to check a matter-specific issue
- WHEN the user enters custom review instructions
- THEN the instructions are included in the review
- AND findings generated from those instructions are labeled as custom-instruction findings

#### Scenario: User saves custom instructions
- GIVEN a custom instruction was useful
- WHEN the user saves it for reuse
- THEN it becomes available in future Custom Review runs
- AND the user can edit it before reuse

### Requirement: Finding Categories
The system SHALL categorize review findings by legal risk, business issue, drafting issue, missing term, inconsistency, or custom-instruction match.

#### Scenario: User filters by category
- GIVEN a review contains multiple finding categories
- WHEN the user filters to drafting issues
- THEN only drafting issues are shown
- AND the review summary still shows total finding counts by category

### Requirement: Redline Summary
The system SHALL generate a redline summary for proposed document changes.

#### Scenario: User opens redline summary
- GIVEN a review has proposed changes
- WHEN the user opens Redline Summary
- THEN the system shows a clause-by-clause summary of proposed changes
- AND each summary item includes severity, status, issue, proposed change, and expected effect

#### Scenario: Review has no proposed redlines
- GIVEN a review produced comments but no replacement language
- WHEN the user opens Redline Summary
- THEN the system explains that no redlines are ready to apply
- AND it still lists comment-only findings

### Requirement: Before And After Preview
The system SHALL show before and after language before a redline is applied.

#### Scenario: User previews redline
- GIVEN a finding has suggested replacement language
- WHEN the user opens the finding
- THEN the UI shows original language and proposed language side by side
- AND the user can edit the proposed language before applying it

### Requirement: Controlled Application
The system SHALL support accept, reject, skip, edit-before-apply, and bulk apply for eligible findings.

#### Scenario: User edits before apply
- GIVEN a finding has a suggested redline
- WHEN the user edits and applies it
- THEN only the edited language is staged or inserted
- AND the finding records that the applied text differs from the original suggestion

#### Scenario: Bulk apply excludes low-confidence findings
- GIVEN a review contains high-confidence and low-confidence findings
- WHEN the user chooses bulk apply
- THEN low-confidence findings are excluded by default
- AND the confirmation explains which findings will not be applied

# Word-Native Product Suite Specification

## Purpose
Make Word the primary work surface for Livebook document workflows by exposing Review, Draft, Ask, Projects, and Proofread from one task pane while preserving one active matter context.

## ADDED Requirements

### Requirement: Workflow Tabs
The system SHALL expose Review, Draft, Ask, Projects, and Proofread as first-class workflow tabs in the Word task pane.

#### Scenario: User switches workflows
- GIVEN a user has the Word task pane open
- WHEN the user switches from Review to Draft
- THEN the Draft workflow opens without losing the active document context
- AND Review results remain available when the user returns to Review

#### Scenario: Workflow is unavailable
- GIVEN a workflow requires Word document text
- WHEN Word document text is unavailable
- THEN the workflow shows a capability-specific empty state
- AND no document-changing action is enabled

### Requirement: Shared Document Context
The system SHALL reuse active document text, selected text, and current Word capability state across workflow tabs.

#### Scenario: User selects text then asks a question
- GIVEN a user selected text in Word
- WHEN the user opens Ask
- THEN the selected text is available as question context
- AND the UI shows that selected text is being used

#### Scenario: User changes selection
- GIVEN the task pane has cached selected text
- WHEN the user refreshes context after changing the Word selection
- THEN the task pane updates the selected text
- AND subsequent workflows use the refreshed context

### Requirement: Matter Context Continuity
The system SHALL keep Word workflow state attached to the active matter context.

#### Scenario: User returns to a workflow
- GIVEN the user ran Review and then opened Draft
- WHEN the user returns to Review
- THEN previous Review results for the active matter remain available
- AND the UI identifies the matter or document context those results belong to

#### Scenario: User changes matter
- GIVEN a user switches to another matter or project
- WHEN the Word task pane loads the new context
- THEN prior Ask, Review, Draft, and Proofread state is not reused silently
- AND the task pane shows that a different matter context is active

### Requirement: Shared Result Controls
The system SHALL use consistent controls for reviewing suggestions across workflows.

#### Scenario: User reviews a suggested change
- GIVEN a workflow returns suggested language
- WHEN the suggestion is displayed
- THEN the user can inspect the suggestion, grounding, status, and available actions
- AND document-changing actions require explicit user selection

### Requirement: Word Actions
The system SHALL support Word actions where the host capability is available.

#### Scenario: User inserts approved text
- GIVEN generated text is available
- AND Word insertion is available
- WHEN the user chooses insert
- THEN the generated text is inserted at the current insertion point or replaces the current selection
- AND the UI confirms the action

#### Scenario: Comments are unavailable
- GIVEN generated feedback is available
- AND Word comments are unavailable
- WHEN the user views the feedback
- THEN the comment action is disabled
- AND the UI explains that comments are not available in the current Word host

### Requirement: Activity History
The system SHALL show recent workflow activity for the active document session.

#### Scenario: User reviews recent actions
- GIVEN the user has run multiple workflows
- WHEN the user opens activity history
- THEN the system shows recent review, draft, ask, associate, and proofread actions
- AND each entry identifies the workflow, status, and user-visible result summary

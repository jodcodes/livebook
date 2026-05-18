# Associate Supervised Execution Specification

## Purpose
Move Projects beyond planning into supervised, approval-gated execution across user-provided document sets. Projects orchestrate Ask, Review, Draft, and Proofread rather than replacing those workflows.

## ADDED Requirements

### Requirement: Project Orchestration
The system SHALL treat the project workflow as an orchestration layer over Ask, Review, Draft, and Proofread.

#### Scenario: Project task references existing workflow
- GIVEN a project task requires document risk analysis
- WHEN the task plan is generated
- THEN the task can reference Review as the execution workflow
- AND the user can inspect the workflow result before approving any document change

#### Scenario: Project proposes drafted update
- GIVEN a project task requires new or revised language
- WHEN the project creates a drafting task
- THEN Draft is used as the source of proposed language
- AND the project records the drafting source and approval status

### Requirement: Multi-Document Project Workspace
The system SHALL let users create a project workspace containing multiple user-provided documents.

#### Scenario: User creates project
- GIVEN a user starts an associate project
- WHEN the user adds multiple supported documents
- THEN the workspace lists each document with name, type when known, analysis status, and available actions
- AND the user can remove or replace documents before execution begins

### Requirement: Project Templates
The system SHALL provide templates for consistency review, financing-document package review, disclosure schedule support, employment package review, and closing checklist support.

#### Scenario: User selects template
- GIVEN a user starts an associate project
- WHEN the user selects a template
- THEN the project goal and initial task plan are prefilled
- AND the user can edit them before running the workflow

### Requirement: Task Plan Approval
The system SHALL create a task plan and require user review before execution.

#### Scenario: User approves task plan
- GIVEN the system generated a task plan
- WHEN the user approves the plan
- THEN the associate workflow begins executing approved tasks
- AND tasks that could change documents remain subject to separate change approval

#### Scenario: Goal is too vague
- GIVEN the project goal is vague or incomplete
- WHEN the system cannot create a useful plan
- THEN it asks for clarifying details
- AND no execution begins

### Requirement: Document Summaries
The system SHALL summarize each document using only the provided document set.

#### Scenario: User reviews document summaries
- GIVEN documents were added to the project
- WHEN summaries are generated
- THEN each summary lists parties, dates, defined terms, key obligations, and unresolved issues when available
- AND the summary identifies the document it came from

### Requirement: Cross-Document Inconsistency Findings
The system SHALL detect inconsistencies in party names, dates, defined terms, section references, obligations, and unresolved placeholders.

#### Scenario: Party names conflict
- GIVEN two documents use different names for the same party
- WHEN the associate workflow checks consistency
- THEN it reports the conflict
- AND it identifies affected documents and source text

#### Scenario: Defined term differs across documents
- GIVEN a defined term has inconsistent wording across documents
- WHEN consistency review runs
- THEN the system reports the inconsistency
- AND it proposes a normalization only when enough context exists

### Requirement: Approval-Gated Updates
The system SHALL require approval for each proposed cross-document update or selected batch.

#### Scenario: User approves one update
- GIVEN multiple proposed updates are pending
- WHEN the user approves one update
- THEN only that update is staged or applied
- AND all other updates remain pending

#### Scenario: User rejects batch
- GIVEN a batch of proposed updates is shown
- WHEN the user rejects the batch
- THEN no document changes are made
- AND the updates remain recorded as rejected suggestions

### Requirement: Project Summary Export
The system SHALL produce a project summary with completed tasks, open issues, pending approvals, and next actions.

#### Scenario: User exports summary
- GIVEN the associate workflow has run
- WHEN the user exports the summary
- THEN the output includes completed tasks, open issues, pending approvals, next actions, and affected documents
- AND it does not imply review of documents that were not provided

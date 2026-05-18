# Product Model And Navigation Specification

## Purpose
Define Livebook as one coherent legal workspace model so Ask, Review, Draft, Projects, Legal Queue, Playbook, and History work together instead of appearing as separate AI tools.

## ADDED Requirements

### Requirement: Playbook-Centered Product Model
The system SHALL present the approved playbook as the source of truth for legal guidance, escalation rules, drafting preferences, and playbook evolution.

#### Scenario: User reviews product structure
- GIVEN a user opens Livebook
- WHEN the workspace navigation and workflow labels are shown
- THEN the product explains workflow boundaries through labels and state, not through duplicate tools
- AND Playbook is identifiable as the approved guidance source for Ask, Review, Draft, and Projects

#### Scenario: Workflow needs approved guidance
- GIVEN a workflow uses playbook guidance
- WHEN it returns an answer, finding, or draft
- THEN it identifies the approved clause or playbook source used
- AND it does not treat library material or generated text as approved playbook policy

### Requirement: Active Matter Context
The system SHALL maintain an active matter context shared by document workflows.

#### Scenario: User moves from Review to Ask
- GIVEN a user reviewed an active Word document
- WHEN the user opens Ask
- THEN the active document context and selected text remain available
- AND the user can include or exclude that context before asking

#### Scenario: User starts new matter
- GIVEN a user starts a new matter or project
- WHEN the new context is created
- THEN prior document-specific review, draft, ask, and proofread state does not silently apply to the new matter
- AND the UI indicates which matter context is active

### Requirement: Unified Ask
The system SHALL expose playbook questions and document questions through one Ask workflow with explicit context controls.

#### Scenario: User asks playbook-only question
- GIVEN no document context is selected
- WHEN the user asks about an approved playbook position
- THEN Ask answers from playbook guidance when available
- AND the answer is labeled as playbook-grounded

#### Scenario: User asks document-grounded question
- GIVEN active document or selected text context is available
- WHEN the user asks about the document
- THEN Ask shows which document context was used
- AND playbook guidance is shown separately when it influenced the answer

### Requirement: Review Center
The system SHALL organize single-document review, batch review, and proofread as lanes of one Review Center.

#### Scenario: User opens Review
- GIVEN a user opens the Review area
- WHEN review lanes are displayed
- THEN the user can distinguish Single Document Review, Batch Review, and Proofread
- AND each lane shares status, filters, recent activity, and approval patterns where applicable

#### Scenario: Proofread runs after legal review
- GIVEN legal review findings already exist
- WHEN Proofread is run from the Review Center
- THEN proofread findings remain separate from legal-risk findings
- AND neither result type overwrites the other

### Requirement: Single Legal Queue
The system SHALL route all lawyer-approval items to one Legal Queue.

#### Scenario: Multiple sources create approval items
- GIVEN chat escalations, playbook changes, batch review insights, Word review findings, and email negotiation insights exist
- WHEN a lawyer opens Legal Queue
- THEN all pending approval items are shown in one queue
- AND each item identifies its source workflow, matter, status, and required decision

#### Scenario: Lawyer approves queue item
- GIVEN a queue item is approved
- WHEN approval completes
- THEN the originating workflow state is updated
- AND any playbook, document, review, or chat status change is recorded in history or activity

### Requirement: Draft And Library Boundaries
The system SHALL distinguish approved playbook policy from reusable drafting language.

#### Scenario: User saves generated language
- GIVEN a user saves generated or edited drafting language
- WHEN the item is added to the library
- THEN it is labeled as reusable library material
- AND it is not treated as approved playbook guidance until separately approved through the playbook workflow

### Requirement: Projects Orchestrate Capabilities
The system SHALL treat Projects as an orchestration layer over existing workflows.

#### Scenario: Project creates tasks
- GIVEN a project contains multiple documents
- WHEN the project plan is generated
- THEN tasks may reference Ask, Review, Draft, and Proofread actions
- AND document-changing tasks require separate approval before execution

### Requirement: Benchmarks Deferred
The system SHALL not expose market benchmark workflows in this change.

#### Scenario: User expects market comparison
- GIVEN no benchmark data source is configured
- WHEN the user looks for market comparison or prevalence claims
- THEN Livebook does not show benchmark review as an available workflow
- AND any future benchmark entry point is disabled or omitted until reliable data is available

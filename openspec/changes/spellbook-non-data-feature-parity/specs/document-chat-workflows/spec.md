# Document Chat Workflows Specification

## Purpose
Expand Ask into one practical, context-aware workflow for playbook questions, document-aware summaries, explanations, emails, risk checks, open issues, and negotiation responses.

## ADDED Requirements

### Requirement: Unified Ask Surface
The system SHALL expose playbook-backed questions and document-backed questions through one Ask surface.

#### Scenario: User asks about playbook guidance
- GIVEN approved playbook guidance is available
- WHEN the user asks a playbook-only question
- THEN Ask answers from the approved playbook where possible
- AND the answer is labeled as playbook-grounded

#### Scenario: User asks about document context
- GIVEN selected text or active document text is available
- WHEN the user asks about the current document
- THEN Ask uses the selected context when enabled
- AND the answer distinguishes document grounding from playbook grounding

### Requirement: Workflow Prompt Set
The system SHALL offer prompt shortcuts for summarize document, explain selected clause, identify risks, draft client email, list open issues, and propose negotiation response.

#### Scenario: User selects document summary
- GIVEN an active document is available
- WHEN the user chooses Summarize Document
- THEN the system returns a structured summary
- AND the summary identifies the document context used

#### Scenario: User selects explain selected clause
- GIVEN selected text is available
- WHEN the user chooses Explain Selected Clause
- THEN the system explains the selected clause in plain language
- AND the answer cites the selected text

### Requirement: Explicit Context Controls
The system SHALL let users include or exclude selected text, active document, approved playbook guidance, and prior conversation from an answer.

#### Scenario: User excludes prior conversation
- GIVEN prior conversation exists
- WHEN the user disables prior conversation context
- THEN the next answer does not rely on earlier turns
- AND the UI shows that prior context was excluded

### Requirement: Prompt Enhancement
The system SHALL improve vague prompts into clearer legal instructions when requested.

#### Scenario: User enhances vague prompt
- GIVEN the user enters "check this"
- WHEN the user chooses Enhance Prompt
- THEN the system proposes a clearer instruction
- AND the user can edit or submit the enhanced instruction

### Requirement: Output Types
The system SHALL render answers as explanation, summary, email, risk checklist, negotiation position, or proposed clause language when the task calls for it.

#### Scenario: User drafts client email
- GIVEN document or selection context is available
- WHEN the user asks for a client email
- THEN the output is formatted as an email draft
- AND material statements include grounding labels

#### Scenario: User asks for risk checklist
- GIVEN a document is available
- WHEN the user asks for risks
- THEN the answer is organized as a checklist
- AND each risk identifies the relevant source context when available

### Requirement: Citations And Grounding
The system SHALL show citations or grounding labels for answers that rely on source material.

#### Scenario: Answer uses selected text and playbook
- GIVEN the answer uses selected text and playbook guidance
- WHEN the answer is displayed
- THEN the selected text and playbook clause are shown as separate grounding sources
- AND generated recommendations are distinguishable from source excerpts

### Requirement: Follow-Up Handling
The system SHALL use prior conversation for follow-up questions when enabled.

#### Scenario: User asks follow-up
- GIVEN the prior answer discussed a termination clause
- WHEN the user asks "make it more customer-friendly"
- THEN the system states that it is applying the request to the termination clause
- AND it returns revised language or guidance for that context

### Requirement: Missing Context Behavior
The system SHALL avoid unsupported document-specific answers when context is missing.

#### Scenario: User asks about absent document
- GIVEN no active document or selected text is available
- WHEN the user asks "what are the issues in this agreement"
- THEN the system explains that document context is needed
- AND it offers to use playbook guidance or asks the user to provide a document

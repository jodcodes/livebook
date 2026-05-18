# Drafting Word Workflows Specification

## Purpose
Support practical drafting and rewriting workflows directly inside Word using active document context, selected text, approved playbook guidance, and user-provided library material.

## ADDED Requirements

### Requirement: Drafting Actions
The system SHALL offer drafting actions for new clause, rewrite selection, make more favorable, simplify, tighten, and convert to client-ready language.

#### Scenario: User drafts a new clause
- GIVEN a user provides drafting instructions
- WHEN the user chooses New Clause
- THEN the system returns proposed clause language
- AND the user can insert, copy, save, edit, or discard it

#### Scenario: User rewrites selected language
- GIVEN a user has selected language in Word
- WHEN the user chooses Rewrite Selection
- THEN the system returns revised language based on the selected text
- AND the original selection remains unchanged until the user approves a Word action

### Requirement: Drafting Inputs
The system SHALL let users provide party position, tone, style, document context, selected text, and optional playbook grounding.

#### Scenario: User selects party position
- GIVEN the user is drafting from a customer position
- WHEN the draft is generated
- THEN the output reflects the selected position
- AND the response shows that party position influenced the draft

#### Scenario: Missing optional context
- GIVEN the user omits tone or style
- WHEN the draft is generated
- THEN the output uses default drafting style
- AND the assumptions are shown to the user

### Requirement: Original And Proposed Comparison
The system SHALL compare original and proposed language for rewrites.

#### Scenario: User previews rewrite
- GIVEN selected text was rewritten
- WHEN the result is displayed
- THEN the UI shows original text and proposed text
- AND the user can edit the proposed text before applying it

### Requirement: Word Insertion Modes
The system SHALL support insert as new text, replace selection, insert comment, and stage as redline when available.

#### Scenario: User stages rewrite as redline
- GIVEN Word tracked changes or equivalent review mode is available
- WHEN the user stages the rewrite as redline
- THEN the proposed rewrite is added as a reviewable document change
- AND the user can still accept or reject it in Word

#### Scenario: User inserts as comment
- GIVEN Word comments are available
- WHEN the user inserts the draft as a comment
- THEN the comment is attached to the current selection or insertion point
- AND the task pane records the action

### Requirement: Playbook And Library Reuse
The system SHALL let users ground drafting in approved playbook clauses and user-provided library items.

#### Scenario: Draft uses playbook language
- GIVEN an approved playbook clause is relevant to the drafting request
- WHEN the user generates language with playbook grounding enabled
- THEN the draft cites the approved clause
- AND the draft does not claim external authority

#### Scenario: Draft uses library item
- GIVEN a user selects a library item as drafting context
- WHEN the draft is generated
- THEN the output reflects the selected library item
- AND the result identifies the item as user-provided context

### Requirement: Save For Reuse
The system SHALL let users save generated or edited language to the library for reuse.

#### Scenario: User saves generated clause
- GIVEN generated clause language is displayed
- WHEN the user saves it to the library
- THEN the item is available in future drafting workflows
- AND it includes title, clause type, source note, and updated timestamp

# Drafting And Clause Library Specification

## Purpose
Add drafting and reusable clause-library workflows beyond current playbook rule management.

## Requirements

### Requirement: Clause Drafting
The system SHALL generate new clause language from user intent, document context, party position, jurisdiction, and writing style when those inputs are provided.

#### Scenario: User drafts a clause from scratch
- GIVEN a user provides drafting instructions, party position, jurisdiction, and writing style
- WHEN the user requests a new clause
- THEN the system returns proposed clause language
- AND the response identifies which inputs shaped the draft
- AND the user can edit, insert, save, or discard the draft

#### Scenario: User drafts with missing optional context
- GIVEN a user provides drafting instructions without jurisdiction or writing style
- WHEN the user requests a new clause
- THEN the system returns a draft with assumptions clearly labeled
- AND the user can refine the missing context and regenerate

### Requirement: Full-Document First Drafts
The system SHALL generate first-draft documents from a selected document type and user instructions.

#### Scenario: User generates a first draft
- GIVEN a user selects a document type and provides drafting instructions
- WHEN the user requests a first draft
- THEN the system generates a structured draft document
- AND the draft can be previewed before insertion or export

#### Scenario: User lacks enough draft context
- GIVEN a user requests a first draft with insufficient instructions
- WHEN the system cannot produce a useful draft
- THEN the UI asks for the missing material details
- AND no draft is inserted into a document

### Requirement: Rewrite Selected Language
The system SHALL let users rewrite selected document language according to preferred style, party position, or playbook guidance.

#### Scenario: User rewrites selected text
- GIVEN a user has selected text in Word
- WHEN the user asks to rewrite it using preferred style
- THEN the system returns revised language
- AND the user can compare the original and revised text before applying

### Requirement: Clause Library
The system SHALL let users save, search, and reuse favorite clauses and precedent clauses.

#### Scenario: User saves a generated clause
- GIVEN a user has generated clause language
- WHEN the user saves it as a favorite
- THEN the clause is added to the clause library
- AND the saved item includes title, clause type, visibility, source, and last updated timestamp

#### Scenario: User searches precedent clauses
- GIVEN precedent clauses or documents exist in the library
- WHEN the user searches by clause topic or text
- THEN matching library items are shown with source and preview text
- AND the user can open, copy, insert, or use a result as drafting context

#### Scenario: No precedent matches
- GIVEN no library item matches the search
- WHEN the user searches the clause library
- THEN the UI shows an empty-state
- AND the UI offers to draft from scratch or upload precedent material

### Requirement: Precedent Upload
The system SHALL let users upload precedent documents and make their useful language searchable for drafting.

#### Scenario: User uploads a precedent document
- GIVEN a user has permission to add library material
- WHEN the user uploads a supported precedent document
- THEN the system creates searchable library entries or source references
- AND the uploaded material can be used as drafting context

### Requirement: Insert Into Word
The system SHALL let users insert saved or generated drafting content directly into Word.

#### Scenario: User inserts a library clause
- GIVEN a user has selected a clause library item
- WHEN the user chooses insert into Word
- THEN the clause is inserted at the current Word insertion point or replaces the current selection
- AND the UI confirms the inserted source

### Requirement: Sharing And Visibility
The system SHALL support private and shared library items where permissions allow.

#### Scenario: User shares a clause with the team
- GIVEN a user has permission to share library items
- WHEN the user marks a clause as shared
- THEN the clause becomes available to permitted team members
- AND the item records who shared it and when

#### Scenario: User lacks sharing permission
- GIVEN a user does not have permission to share library items
- WHEN the user views a private library item
- THEN the share action is disabled
- AND the UI explains the permission requirement

### Requirement: Playbook And Precedent Reuse
The system SHALL reuse preferred language from approved playbook clauses and relevant precedent library items when drafting.

#### Scenario: Draft uses approved preferred language
- GIVEN an approved playbook clause matches the drafting request
- WHEN the user generates clause language
- THEN the system uses the approved preferred position as grounding
- AND the draft cites the playbook clause as a source


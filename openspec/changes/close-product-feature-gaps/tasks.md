# Implementation Tasks

## 1. Word Review Workflow
- [x] Define review finding model and UI states for severity, clause, status, confidence, comments, and redlines.
- [x] Add Word add-in workflow for full-document review.
- [x] Add edit-before-apply and reject/skip states.
- [x] Add selected bulk approval for high-confidence findings.
- [x] Preserve compatibility with tabular review sessions.
- [x] Add tests for single apply, edited apply, bulk apply, reject, and unavailable Word context.

## 2. Drafting And Clause Library
- [x] Add drafting flows for clauses, rewrites, and first-draft documents.
- [x] Add library item model for generated clauses, favorites, and uploaded precedents.
- [x] Add library search and no-match states.
- [x] Add insert-into-Word actions.
- [x] Add private/shared visibility controls.
- [x] Add tests for drafting, saving, searching, sharing, and inserting.

## 3. Enhanced Document Chat
- [x] Add chat context selection for active document, selected text, playbook, and conversation history.
- [x] Add prompt suggestions and prompt enhancement.
- [x] Add cited answers for summaries, explanations, emails, and risk checks.
- [x] Add multilingual answer behavior.
- [x] Add tests for selected text, follow-ups, prompt enhancement, generated email, and multilingual flows.

## 4. Associate Multi-Document Agent
- [x] Add multi-document project workspace.
- [x] Add project goal intake and task plan review.
- [x] Add cross-document inconsistency detection.
- [x] Add user-approved cross-document updates.
- [x] Add project summary with completed tasks, open issues, and next actions.
- [x] Add tests for upload, task planning, approval gating, inconsistency detection, and summary output.

## 5. Proofread Final Check
- [x] Add proofread workflow separate from legal-risk review.
- [x] Detect unused definitions, undefined capitalized terms, broken references, placeholders, drafting notes, typos, grammar, and capitalization inconsistencies.
- [x] Add selective apply and ignore states.
- [x] Prevent proofread results from overwriting legal review results.
- [x] Add tests for each proofread finding type and selective application.

## 6. Product Workspace Settings
- [x] Add product roles for legal reviewer, business user, admin, and viewer.
- [x] Add permission-aware actions for playbooks, clause approval, library sharing, and document changes.
- [x] Add team tone/style settings.
- [x] Add document-source import/export workflow.
- [x] Add tests for role limits, disabled UI reasons, style defaults, and import/export product flows.

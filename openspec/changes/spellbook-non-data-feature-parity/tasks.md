# Implementation Tasks

## 1. Product Model And Navigation
- [x] Define the shared product model in UI labels and workflow boundaries: Playbook, Matter, Ask, Review, Draft, Projects, Legal Queue, and History.
- [x] Replace duplicate navigation concepts with one coherent structure: Ask, Review, Draft, Projects, Playbook, History, Legal Queue, and Settings where role-appropriate.
- [x] Remove benchmark or market-review entry points from this change until reliable benchmark data exists.
- [x] Add an active matter/document context model shared by Ask, Review, Draft, Projects, and Proofread.
- [x] Add source labels that distinguish approved playbook guidance, active document context, selected text, reusable library material, and generated suggestions.
- [x] Add tests for navigation visibility by role, matter context switching, source labeling, and no benchmark workflow exposure.

## 2. Word-Native Product Suite
- [x] Add a Word task pane home that exposes Review, Draft, Ask, Projects, and Proofread through the shared product model.
- [x] Reuse the active Word document, current selection, matter context, and recent workflow state across all tabs.
- [x] Add capability-aware empty states when Word cannot provide document text, selection text, comments, or tracked changes.
- [x] Add a shared result panel pattern for findings, suggested language, citations, approval controls, and activity history.
- [x] Add insert, comment, redline, copy, export summary, and escalate actions where each workflow supports them.
- [x] Add tests for tab switching, document-context reuse, selection-context reuse, unavailable Word capability states, and non-destructive workflow transitions.

## 3. Review Center
- [x] Organize Single Document Review, Batch Review, and Proofread as lanes of one Review Center.
- [x] Preserve Tabular Review behavior as the Batch Review lane instead of creating a competing review surface.
- [x] Add review mode selection for General Review, Negotiation Review, and Custom Review inside Single Document Review.
- [x] Add matter-specific custom review instructions that can be entered, edited, saved for reuse, and applied to future reviews.
- [x] Add finding categories for legal risk, business issue, drafting issue, missing term, inconsistency, and custom-instruction match.
- [x] Add a Redline Summary view that summarizes proposed changes by clause, severity, status, and business impact.
- [x] Add before/after previews for every redline suggestion.
- [x] Add accept, reject, skip, edit-before-apply, and bulk-apply controls for eligible findings.
- [x] Add tests for review lane switching, each review mode, custom instruction matching, redline summary generation, edited apply, reject, skip, bulk apply, and low-confidence exclusion.

## 4. Legal Queue
- [x] Replace parallel lawyer dashboards with one Legal Queue for all approval-required items.
- [x] Route chat escalations, pending playbook clauses, evolve suggestions, batch review insights, Word review findings requiring approval, and email negotiation insights into the queue.
- [x] Add queue columns and filters for source workflow, matter, counterparty, playbook, status, created by, created at, and required decision.
- [x] Update approval, rejection, decline, and resolve actions to write back to the originating workflow state.
- [x] Add activity/history records when queue decisions affect playbook, review, chat, document, or project state.
- [x] Add tests for mixed-source queue loading, approval writeback, rejection writeback, filtering, and status history.

## 5. Unified Ask
- [x] Merge playbook Q&A and document chat into one Ask workflow with explicit context controls.
- [x] Add Ask workflows for summarize document, explain selected clause, identify risks, draft client email, list open issues, and propose negotiation response.
- [x] Add context toggles for selected text, active document, approved playbook guidance, and prior conversation.
- [x] Add prompt suggestions and prompt enhancement for vague prompts such as "check this" or "make it better".
- [x] Add answer output types for explanation, summary, email, risk checklist, negotiation position, and proposed clause language.
- [x] Add citations or grounding labels for every answer that uses source material.
- [x] Add follow-up handling that shows the assumed prior context before answering.
- [x] Add tests for playbook-only questions, selected-text questions, full-document summaries, follow-ups, prompt enhancement, client email generation, missing-context behavior, and citation display.

## 6. Drafting Word Workflows
- [x] Add Word-native drafting actions for new clause, rewrite selection, make language more favorable, simplify, tighten, and convert to client-ready language.
- [x] Add drafting inputs for document context, selected text, party position, tone, style, and optional playbook clause grounding.
- [x] Add side-by-side original and proposed language for rewrites before insertion.
- [x] Add insert-as-new-text, replace-selection, insert-comment, and stage-as-redline actions.
- [x] Add clause reuse from approved playbook clauses and user-provided precedent/library items without external legal-content dependencies.
- [x] Add save-to-library and use-library-item-as-context actions.
- [x] Ensure saved library items are not treated as approved playbook policy unless they pass the playbook approval workflow.
- [x] Add tests for draft-from-scratch, rewrite selection, favorable rewrite, style override, playbook-grounded draft, library reuse, library/playbook boundary, and Word insertion.

## 7. Projects
- [x] Treat Projects as an orchestration layer over Ask, Review, Draft, and Proofread rather than a duplicate review tool.
- [x] Add a multi-document project workspace that can be opened from the web app and from Word.
- [x] Add project templates for consistency review, financing-document package review, disclosure schedule support, employment package review, and closing checklist support.
- [x] Add task-plan generation with user review before execution.
- [x] Add document summaries showing parties, dates, defined terms, key obligations, and unresolved issues using only provided documents.
- [x] Add cross-document inconsistency findings for party names, dates, defined terms, section references, obligations, and unresolved placeholders.
- [x] Add proposed cross-document updates with approval gates for each update or selected batch.
- [x] Add project summary export with completed tasks, open issues, pending approvals, and next actions.
- [x] Add tests for project creation, template selection, vague-goal clarification, task-plan approval, workflow orchestration, inconsistency detection, selective approval, summary export, and no-unapproved-document-change behavior.

## 8. Proofread Finalization
- [x] Keep Proofread as a finalization lane inside Review Center while preserving separation from legal-risk review.
- [x] Detect placeholders, bracketed drafting notes, typos, grammar issues, capitalization inconsistency, undefined terms, unused definitions, broken references, numbering issues, and inconsistent defined-term usage.
- [x] Group proofread findings by issue type and confidence.
- [x] Add quick actions for apply fix, edit fix, ignore, ignore all like this, comment, and stage as tracked change.
- [x] Add a finalization checklist showing unresolved proofread issues before circulation.
- [x] Ensure proofread findings do not overwrite legal review findings, playbook review state, or batch review results.
- [x] Add tests for every proofread issue type, selective apply, ignore, ignore-all, edited fix, finalization checklist, and separation from legal review.

## 9. Cross-Capability Polish
- [x] Add consistent status vocabulary across workflows: pending, applied, rejected, skipped, ignored, needs context, needs approval, and complete.
- [x] Add a shared "why this suggestion" disclosure for grounded suggestions.
- [x] Add undo or reversal affordances for document changes where the host supports it.
- [x] Add recent activity and saved result history across Word and web surfaces.
- [x] Add localization-ready UI copy for all new workflow labels, empty states, errors, and confirmation dialogs.
- [x] Add end-to-end smoke tests for Review to Draft to Ask to Proofread on one active Word document.

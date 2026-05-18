# Product Design Decisions

## Non-Data Scope
The change intentionally avoids product claims that require external market datasets, licensed legal content, analytics, model training, or security/compliance programs. If a workflow needs an example standard or precedent, it should use existing playbook guidance, user-provided document context, or manually supplied workspace content.

## Product Model
Livebook is a playbook-centered legal workspace. The approved playbook is the source of truth, the matter/document is the active work context, Ask answers questions, Review evaluates documents, Draft proposes language, Projects orchestrates multi-document work, Legal Queue controls approval, and History preserves auditability.

## One Matter Context
Document text, selected text, playbook grounding, prior conversation, review results, draft suggestions, and proofread findings should attach to the same active matter context. Switching workflow tabs should not create unrelated sessions unless the user starts a new matter or project.

## Unified Ask
Playbook Q&A and document chat should be one Ask experience with explicit context controls. The product should distinguish playbook-only answers from document-grounded answers, but users should not have to choose between two separate chat products.

## Review Center
Single-document review, batch/tabular review, and proofread should appear as lanes of one Review Center. Legal-risk review and final proofread remain separate result types, but they share context, status vocabulary, filtering, and activity history.

## Legal Queue
Every item that requires lawyer approval should route to a single Legal Queue. This includes chat escalations, pending playbook clauses, evolve suggestions, batch review insights, Word review findings marked for approval, and email negotiation insights.

## Projects As Orchestrator
The associate/project workflow should orchestrate existing capabilities rather than duplicate them. It may call Ask, Review, Draft, and Proofread against a document set, but any document-changing action still requires explicit approval.

## Word As Primary Work Surface
For document workflows, Word is the primary work surface. The web app may configure, review, or inspect workflows, but the user should be able to run core actions from the Word task pane when a document is active.

## Approval Before Mutation
No AI-generated legal suggestion changes a document without explicit user approval. This includes redlines, rewrites, proofread fixes, drafting insertions, and cross-document associate updates.

## Reviewable Changes
Applied document changes must be reviewable before final acceptance. In Word, this should use comments, tracked changes, staged insertion, or an equivalent review state depending on available host capabilities.

## Grounding Without External Data
Recommendations should cite available grounding such as selected text, document passages, playbook clauses, uploaded precedents, prior conversation context, or user-supplied instructions. The product must not imply market or external legal authority when no such source is in scope.

## Benchmarks Deferred
Market benchmarks are not part of this change. The UI should not expose benchmark review, market prevalence, or off-market claims until the product has reliable benchmark sources. Future benchmark work can be added as a grounded evidence source for Review and Draft after the data problem is solved.

## Custom Instructions
Users can provide review or drafting instructions for a specific matter. Saved custom instructions are product configuration, not a security permission or data-governance system.

## Low-Confidence Behavior
Low-confidence or weakly grounded suggestions should be labeled and excluded from default bulk application. Users may still inspect, edit, apply individually, ignore, or escalate them.

## Existing Workflow Compatibility
Current Livebook playbook management, question answering, tabular review, escalation, history, and Word add-in workflows remain valid. New behavior should extend these workflows rather than replacing them.

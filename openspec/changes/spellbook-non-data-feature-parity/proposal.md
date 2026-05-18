# Spellbook Non-Data Feature Parity

## Why
Livebook already covers the foundation for playbook-backed question answering, tabular review, escalation, version history, and a Microsoft Word add-in. The next product gap is not market data, external legal datasets, compliance, or enterprise security. The priority is making the existing legal AI workflows feel complete, Word-native, supervised, and usable end to end.

This change specifies the non-data and non-security product capabilities needed to approach Spellbook-like workflow parity while keeping Livebook organized around one product model:

- A playbook-centered workspace model with one active matter/document context
- Word-native access to review, drafting, chat, proofread, and associate workflows
- A unified Ask experience instead of separate playbook chat and document chat surfaces
- A Review Center that contains single-document review, batch review, and proofread lanes
- A single Legal Queue for chat escalations, playbook approvals, review findings, and evolve suggestions
- Review modes, custom review instructions, and redline summaries
- Drafting, rewriting, and clause reuse directly from Word
- Document-aware chat workflows for summaries, explanations, client emails, and risk checks
- Associate-style supervised project workflows across document sets
- Final proofread workflows for drafting cleanup before circulation

## What Changes
- Add future-state specs for seven product capabilities:
  - Product model and navigation
  - Word-native product suite
  - Review modes and redline summary
  - Drafting Word workflows
  - Document chat workflows
  - Associate supervised execution
  - Proofread finalization
- Define user-visible states, inputs, outputs, approval gates, Word interactions, and acceptance scenarios.
- Keep all document-changing behavior user-approved, reviewable, and reversible before final acceptance.
- Remove benchmark workflows from this change until Livebook has reliable benchmark data.

## Out Of Scope
- Market benchmark workflows, benchmark datasets, external legal-content datasets, data licensing, data pipelines, analytics, and model-training data
- Security certifications, compliance programs, enterprise security controls, SSO, audit/compliance reporting, and deployment hardening
- Storage engine, hosting, cloud-provider, vendor-selection, or migration details
- Replacing existing playbook, tabular review, escalation, history, or Word add-in behavior

## Impact
These specs provide an implementation-ready product target for non-data Spellbook parity. They should be implemented incrementally, starting with product model consolidation, Word-native workflow consolidation, and review improvements before expanding drafting, chat, associate, and proofread workflows.

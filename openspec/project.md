# Livebook Product Context

## Purpose
Livebook is an AI-assisted legal workspace for contract playbooks, contract review, and lawyer-approved guidance. It helps legal and business users ask questions against approved guidance, review contract deviations, manage playbook evolution, and work from Microsoft Word.

## Current Product Baseline
Livebook already includes these product capabilities:

- Playbook-backed legal question answering
- Clause-aware citations and suggested next actions
- Structured playbook rule management with preferred, fallback, and redline positions
- Lawyer review and approval flows for playbook changes
- Escalation queue for legal review
- Playbook upload and extraction
- Playbook version history and restore
- Tabular contract review against the current playbook
- Microsoft Word task pane add-in with document reading, asking, commenting, and redline support

## Product Gap Focus
The active product direction is defined by the `spellbook-non-data-feature-parity` change. Livebook should evolve as a playbook-centered legal workspace rather than a collection of unrelated AI tools.

The near-term product model is:

- Playbook as the approved source of truth
- Matter and document context as the active work surface
- Ask for playbook and document questions through one context-aware chat experience
- Review Center for single-document review, batch review, and final proofread lanes
- Legal Queue for every item that requires lawyer approval
- Draft for approved-playbook-grounded drafting, rewriting, and reusable clause language
- Projects for supervised multi-document work that orchestrates Ask, Review, Draft, and Proofread
- History for auditability, versioning, and rollback

Market benchmarks are intentionally out of current scope until Livebook has licensed or user-provided benchmark data that can support reliable product claims.

## Spec Boundaries
Specs in this project describe product behavior, user workflows, expected UI states, inputs, outputs, and acceptance scenarios. They intentionally avoid infrastructure, deployment, cloud provider, compliance implementation, storage engine, and vendor-selection details unless such details are directly visible to users as product behavior.

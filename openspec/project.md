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
The `close-product-feature-gaps` change specifies missing or incomplete product capabilities needed to approach a broader Spellbook-like product suite:

- Full Word-native contract review workflow
- Drafting and clause library
- Enhanced document chat
- Market benchmarks
- Multi-document legal agent
- Final proofread checks
- Product workspace roles, permissions, and settings

## Spec Boundaries
Specs in this project describe product behavior, user workflows, expected UI states, inputs, outputs, and acceptance scenarios. They intentionally avoid infrastructure, deployment, cloud provider, compliance implementation, storage engine, and vendor-selection details unless such details are directly visible to users as product behavior.


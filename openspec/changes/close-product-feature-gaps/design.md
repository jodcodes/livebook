# Product Design Decisions

## Baseline Compatibility
Existing Livebook playbook, chat, tabular review, escalation, history, and Word add-in workflows remain valid. New capabilities extend those workflows rather than replacing them.

## Approval Before Document Mutation
Generated legal suggestions, redlines, document edits, and cross-document updates require explicit user approval before they change a document. Bulk actions are allowed only when the affected findings are visible and selectable.

## Grounding And Citations
Answers and recommendations that rely on source material must expose grounding. Grounding may reference document passages, selected text, playbook clauses, precedent library items, or prior conversation context.

## Benchmarks Deferred
Market benchmarks are out of scope until Livebook has reliable benchmark data. The product should not expose market prevalence, off-market, or benchmark-backed claims without a configured data source.

## Reviewability
Document changes must be reviewable before final acceptance. The product must preserve enough state for users to see what changed, why it changed, and which user action applied or rejected it.

## Product-First Specs
Specs describe user-facing behavior and acceptance scenarios. Implementation details are left to future design work unless required to avoid product ambiguity.

## Permission-Aware UX
Users should see available actions based on their product role. Restricted actions should be visible when contextually useful, disabled when not allowed, and accompanied by a concise reason.

## Low-Confidence Behavior
AI outputs that are low-confidence, weakly grounded, or missing required context should be clearly labeled and should not be eligible for automatic application. Users may still inspect, edit, or escalate them.

# OpenSpec Instructions

## Format
Write specs in OpenSpec markdown format:

- Use one focused capability per `openspec/changes/<change>/specs/<capability>/spec.md`.
- Start each spec with a clear title and short purpose.
- Use `## Requirements` for normative product behavior.
- Use `### Requirement: <name>` for each requirement.
- Every requirement MUST include at least one `#### Scenario: <name>` block.
- Scenarios SHOULD use `GIVEN`, `WHEN`, `THEN`, and `AND` bullets.

## Scope
Keep specs product-facing. Describe what users can do and what the product must show or preserve. Do not prescribe hosting, deployment, cloud services, storage engines, compliance implementation details, or vendor integrations unless the spec is explicitly about a user-visible product workflow.

## Change Specs
Specs inside `openspec/changes/` describe the complete intended future behavior for the capability. Do not use diff syntax inside capability specs. Put rationale in `proposal.md`, implementation sequencing in `tasks.md`, and shared decisions in `design.md`.

## Legal Product Defaults
Generated legal suggestions MUST require user approval before changing a document. Source-backed answers MUST expose grounding or citations. Document edits MUST be reviewable or reversible before final acceptance.


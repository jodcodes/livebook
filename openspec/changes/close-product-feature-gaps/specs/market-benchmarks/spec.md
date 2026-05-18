# Market Benchmarks Specification

## Purpose
Add market and benchmark review capabilities that compare contract terms to relevant standards and suggest data-backed fixes.

## Requirements

### Requirement: Benchmark Review
The system SHALL compare contract terms to benchmark standards and produce benchmark findings.

#### Scenario: User runs benchmark review
- GIVEN a user has a contract available for review
- WHEN the user runs benchmark review
- THEN the system returns benchmark findings for relevant deal points
- AND each finding shows whether the term appears standard, missing, unusual, or off-market

#### Scenario: No benchmark applies
- GIVEN no benchmark standard applies to the contract context
- WHEN the user runs benchmark review
- THEN the UI shows a clear unavailable-state
- AND no unsupported benchmark conclusions are shown

### Requirement: Contract Type Matching
The system SHALL automatically suggest relevant contract types for benchmark comparison.

#### Scenario: System matches contract type
- GIVEN a contract contains enough contextual signals
- WHEN benchmark review starts
- THEN the system suggests one or more matched contract types
- AND the user can accept or change the selected contract type

#### Scenario: User changes matched contract type
- GIVEN the system selected a contract type
- WHEN the user chooses a different contract type
- THEN benchmark findings update for the selected type

### Requirement: Benchmark Filters
The system SHALL let users filter benchmarks by contract type, jurisdiction, industry, deal type, and party position.

#### Scenario: User changes jurisdiction filter
- GIVEN benchmark findings are displayed
- WHEN the user changes the jurisdiction filter
- THEN findings and prevalence data update to match the new filter
- AND the UI shows the active filter set

### Requirement: Off-Market And Missing Term Detection
The system SHALL flag missing, unusual, and off-market terms with explanations.

#### Scenario: User sees why a term is off-market
- GIVEN a term differs from the selected benchmark standard
- WHEN the user opens the finding
- THEN the system explains why the term is off-market
- AND the explanation references the benchmark context used

#### Scenario: Missing term is detected
- GIVEN a benchmark standard expects a material term not found in the contract
- WHEN benchmark review completes
- THEN the system shows a missing-term finding
- AND the finding explains why the term matters

### Requirement: Market Prevalence And Alternatives
The system SHALL show market prevalence and alternative term distributions when benchmark data supports it.

#### Scenario: User drills into a deal point
- GIVEN a benchmark finding has prevalence data
- WHEN the user opens the deal point details
- THEN the UI shows how common the current term is
- AND the UI shows common alternatives with percentage breakdowns

### Requirement: Benchmark-Backed Fixes
The system SHALL generate suggested fixes grounded in benchmark standards.

#### Scenario: User inserts a benchmark-backed fix
- GIVEN an off-market finding has a suggested fix
- WHEN the user chooses to insert the fix
- THEN the fix is staged as a redline suggestion
- AND the user must approve it before the document changes
- AND the finding records the benchmark context that supported the fix

### Requirement: Custom Standards
The system SHALL allow permitted teams to define and share custom benchmark standards.

#### Scenario: User creates a custom standard
- GIVEN a user has permission to manage custom standards
- WHEN the user creates a standard for a contract type and deal context
- THEN the standard becomes available for benchmark review
- AND it is labeled as a custom team standard

#### Scenario: User shares a standard firm-wide
- GIVEN a custom standard exists
- WHEN a permitted user shares it with the team
- THEN permitted users can select it in benchmark review
- AND the standard records who shared it and when


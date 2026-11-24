> Part of [PROJECT.md](PROJECT.md)

# Requirement-Level Credit Ledger

## Purpose and status

The v0.2 credit ledger replaces free-form whole-answer mark guessing with a deterministic sum of explicit assessable units. It is an internal, unvalidated prototype. It does not reproduce an official ACCA mark and must not create credit that is absent from supplied marking context or a supported paper rule.

## Data flow

```text
requirement + marking context
    → explicit credit units
    → classified findings
    → root-issue deduplication
    → unit credit ranges
    → requirement range
    → whole-response range or refusal
```

Each requirement records its available marks, allocated units and any unallocated credit. Each credit unit records:

- a stable unit ID and label;
- credit type and marks available;
- status: `AWARDED`, `PARTIAL`, `NOT_AWARDED`, `INSUFFICIENT_EVIDENCE`, `UNAVAILABLE`, or `NOT_APPLICABLE`;
- low/high credit, confidence, evidence and reason;
- credit basis: explicit marking context, diagnostic inference, or unavailable;
- paper-rule ID and evidence status; and
- linked finding IDs.

Unallocated marks become an explicit `UNAVAILABLE` unit with a 0-to-available range. They are never silently treated as lost credit.

## Findings are not marks

The finding layer distinguishes:

| Classification | Meaning | Direct credit effect |
|---|---|---|
| `STYLE_NOTE` | Non-material presentation observation or accepted alternative. | None. |
| `DIAGNOSTIC_WEAKNESS` | A useful weakness that lacks supported direct mark effect. | None unless explicit marking context separately determines the unit. |
| `MARK_MATERIAL_WEAKNESS` | A weakness tied to a supported paper rule and assessable unit. | May reduce that unit once. |

A diagnostic inference can reduce a unit only when a linked, deduplicated finding remains `MARK_MATERIAL_WEAKNESS` and its paper rule is `SUPPORTED_BY_EXISTING_PROJECT_EVIDENCE`. Style-only reductions fail closed.

## No double penalty

Before credit is derived, findings are grouped by an explicit `root_issue_id` or a configured related-tag group plus requirement and credit unit. All findings and evidence remain in the audit trail, but only the root-primary supported finding can have `effective_mark_penalty = true`. A group therefore has at most one effective penalty.

The initial automatic related-tag groups are deliberately `UNVALIDATED`: scenario connection, analysis development, evaluation depth, requirement coverage, quantitative decision chain and conclusion support. They must be benchmarked before production use.

## Deriving a mark or range

The ledger sums unit lows and highs. A point value is returned only when the uncertainty policy selects `SCORE_NORMALLY` and the range collapses to one value. Otherwise it returns a broad range or refuses numerical estimation. Every numerical output states that it is indicative and not official.

The executable implementation is [prototype/acca_engine/credit_ledger.py](prototype/acca_engine/credit_ledger.py); classifications, statuses, deduplication groups and thresholds are in [prototype/credit_ledger_config.json](prototype/credit_ledger_config.json).

## Known limits

- The prototype consumes already-structured units; it does not parse an ACCA marking guide.
- Current rules prove architecture, not marking validity.
- Automatic deduplication groups are hypotheses.
- Ledger tests are synthetic and cannot establish real-case accuracy or range calibration.
- Student-visible numerical marks remain out of scope until a fresh blind benchmark passes pre-registered gates.

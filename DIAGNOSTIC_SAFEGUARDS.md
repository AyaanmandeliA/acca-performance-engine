> Part of [PROJECT.md](PROJECT.md)

# False-Criticism and Deduplication Safeguards

## False-criticism controls

The controller evaluates a proposed criticism before it can affect credit. It downgrades the following to `STYLE_NOTE`:

- an explicitly accepted format;
- a valid alternative working;
- a concise but complete answer; and
- a format finding covered by a paper rule whose effect is `ACCEPT_FORMAT`.

A valid own-figure/follow-through safeguard becomes `DIAGNOSTIC_WEAKNESS`, preserving the observation while preventing an automatic direct penalty. A proposed mark-material finding without a paper rule also becomes `DIAGNOSTIC_WEAKNESS`. A rule with insufficient evidence cannot authorise a direct reduction.

These controls do not award credit on their own. They stop presentation preference or unsupported materiality inference from removing credit that an explicit ledger unit preserves.

## Root-cause deduplication

Findings first use an explicit `root_issue_id` when one is available. Otherwise, configured related tags are grouped only when they occur in the same requirement and credit unit. Deterministic selection uses classification, severity, confidence and stable finding ID order.

Each group records:

- the root ID and root-primary finding;
- every member finding and evidence trail;
- whether each member is primary; and
- the number of effective mark penalties.

At most one supported finding in a root group can directly affect credit. The adapter also emits one primary weakness per deduplicated group, preventing related tags from independently inflating downstream priority.

## Boundary

The automatic related-tag groups are unvalidated hypotheses. They prevent obvious duplicate effects but may over-group distinct failures. A fresh benchmark must review both false merges and missed merges; until then the full evidence trail must be retained and student-facing severity/priority remains experimental.

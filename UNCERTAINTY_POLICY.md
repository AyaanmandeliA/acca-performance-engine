> Part of [PROJECT.md](PROJECT.md)

# Uncertainty Policy

## Decision table

| Evidence state | Dimension handling | Mark handling | Student-facing effect |
|---|---|---|---|
| Applicable, usable confidence, no blocking flag | Use with confidence weight. | Score normally only from supported, complete ledger units. | “Ledger-derived indicative credit; not an official mark.” |
| `NOT_APPLICABLE` | Exclude; weight 0. | No invented unit. | State non-applicability. |
| `INSUFFICIENT_EVIDENCE` | Abstain; weight 0. | Broad range if bounded safely. | Explain incomplete evidence. |
| Paper rules unavailable but finding evidence exists | Allow downstream evidence with confidence capped at `MEDIUM`. | Block point estimate; use broad range or no mark. | State that paper-rule support is missing. |
| Unallocated credit, unsupported rule or range width at least 20% | Preserve audit; do not fabricate evidence. | `BROAD_RANGE`. | Explain which evidence or rules are incomplete. |
| `SOURCE_UNREADABLE`, `OUTSIDE_SUPPORTED_SCOPE`, `INDICATIVE_MARK_UNSAFE`, or range width at least 60% | Abstain from affected downstream use. | `REFUSE_ESTIMATE`. | Say no safe numerical estimate is available. |

## Confidence and downstream weight

Applicable dimensions carry nominal downstream weights of 1.0 for `HIGH`, 0.7 for `MEDIUM`, and 0.4 for `LOW`. The current Weakness Engine intentionally excludes low-confidence dimension exposure, so a retained low-confidence attempt does not become pattern evidence. Confidence caps are applied before engine ingestion.

## No false precision

A point mark exists only when all used rule statuses support normal scoring and ledger low equals high. `UNVALIDATED` or `INSUFFICIENT_EVIDENCE` rules, unallocated marks, mark-only flags, or any non-zero safe range produce a broad range. Unsafe evidence or a very wide range produces refusal.

Thresholds are versioned in [prototype/credit_ledger_config.json](prototype/credit_ledger_config.json) and are unvalidated hypotheses. They require prospective benchmark calibration before student use.

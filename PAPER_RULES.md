> Part of [PROJECT.md](PROJECT.md)

# AFM and SBR Paper-Rule Layer

## Contract

Paper rules are versioned JSON modules loaded by a deterministic registry. Each module identifies its evidence basis, context defaults, credit types, professional-skill components, accepted presentations and individual rules. Every rule is explicitly labelled:

- `SUPPORTED_BY_EXISTING_PROJECT_EVIDENCE` — the existing project evidence supports the narrow statement;
- `UNVALIDATED` — plausible and represented structurally, but not established; or
- `INSUFFICIENT_EVIDENCE` — the current evidence cannot support a general rule.

The module-level status for both first-pass papers is `UNVALIDATED`. This is intentional: individual supported statements do not validate a complete paper marking model.

## AFM v0.2

[prototype/paper_rules/afm_v0.2.json](prototype/paper_rules/afm_v0.2.json) supports explicit units for technical, method, own-figure, application, quantitative accuracy, quantitative interpretation, analysis/evaluation, scepticism, commercial acumen and communication.

Current evidence supports:

- technical credit at a supplied assessable point;
- separate calculation and interpretation units;
- separate professional components for analysis/evaluation, scepticism and commercial acumen; and
- labelled calculation workings.

Current evidence does not support a general AFM follow-through rule or general communication-mark logic. Those rules are respectively `UNVALIDATED` and `INSUFFICIENT_EVIDENCE`; they cannot drive normal scoring without explicit context.

## SBR v0.2

[prototype/paper_rules/sbr_v0.2.json](prototype/paper_rules/sbr_v0.2.json) supports technical reporting, method, workings/calculations, own-figure/follow-through, consequential treatment, application, narrative explanation and professional-skill units.

Current evidence supports:

- identifiable technical reporting points;
- narrative application as a separate unit;
- own-figure credit when method and traceable working satisfy supplied context;
- clearly labelled adjustment columns; and
- labelled tabular workings without requiring a stylistically preferred separate final column.

Alternative valid workings remain `UNVALIDATED` as a general rule. Concise-but-complete answers and SBR professional-skills treatment remain `INSUFFICIENT_EVIDENCE` outside explicit marking context.

## Audit and extension rules

- Do not place mark logic in Python when it belongs in paper configuration.
- Do not upgrade an evidence status without a cited project evidence change and regression tests.
- Unknown paper/rule IDs fail closed.
- New papers require a separate versioned module and fresh synthetic plus blind-benchmark coverage.
- A rule change is a benchmark-relevant version change, not a copy edit.

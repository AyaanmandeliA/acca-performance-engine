> Part of [PROJECT.md](PROJECT.md)

# Diagnostic Taxonomy

## Purpose

This taxonomy describes *why* a student may be gaining or losing marks in an ACCA written or practice answer. It is a universal layer for SBL, SBR, AFM, APM, and AAA. Paper-specific rules may add context, evidence expectations, and topic mappings, but must not redefine the universal tag meanings.

The taxonomy is diagnostic rather than punitive. A weakness tag must be tied to observable evidence in the submitted answer and the supplied question/marking context. Absence of evidence is not automatically evidence of weakness.

## Shared conventions

### Diagnostic unit

Apply a tag to the smallest useful unit: a requirement, sub-requirement, calculation, paragraph, or conclusion. Store the affected scope alongside the tag so the longitudinal engine can distinguish a local mistake from a broad weakness.

### Severity

| Level | Meaning |
|---|---|
| `MINOR` | Localised issue with limited effect on the response; the core approach remains sound. |
| `MODERATE` | Material gap affecting several points, a meaningful part of a requirement, or the reliability of a result. |
| `MAJOR` | Fundamental misunderstanding, missing core requirement, invalid method, or issue likely to affect a substantial share of available credit. |

Severity is about impact in this attempt, not how often the issue has occurred. Frequency is calculated later by the Weakness Engine.

### Confidence

Every diagnosis must also carry `LOW`, `MEDIUM`, or `HIGH` confidence. Confidence depends on the completeness of the question, answer, marking material, and the clarity of the evidence. A forceful-sounding explanation must not substitute for evidence.

### Tag types

- `WEAKNESS`: an evidenced problem.
- `STRENGTH`: an evidenced capability worth preserving.
- `NOT_RELEVANT` / `INSUFFICIENT_EVIDENCE`: dimension statuses used when the task did not test the capability or the supplied material cannot support a judgement. These are statuses, not tags.

## 1. Technical Knowledge (`TECHNICAL_KNOWLEDGE`)

**Meaning:** Accuracy, completeness, and appropriate use of the accounting, audit, finance, performance-management, governance, strategy, and professional concepts needed for the requirement.

**Relevant when:** The requirement depends on rules, models, definitions, methods, standards, or topic-specific knowledge. It may be less central when the task is mainly judgement, communication, or scenario interpretation.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `TECHNICAL_CONCEPT_INCORRECT` | Weakness | States or relies on a materially incorrect concept. | Treats an option as an obligation, or reverses a core reporting treatment. | Moderate–major |
| `TECHNICAL_KNOWLEDGE_MISSING` | Weakness | Omits technical knowledge necessary to address a material part of the requirement. | Does not identify the relevant valuation approach or audit risk principle. | Moderate–major |
| `TECHNICAL_RULE_MISAPPLIED` | Weakness | Knows a rule or method but applies it in the wrong circumstances. | Uses a correct formula with the wrong cash-flow basis. | Minor–major |
| `TECHNICAL_ASSUMPTION_UNSTATED` | Weakness | Uses a method whose material assumptions or limitations should have been stated. | Calculates a value using constant growth without acknowledging the assumption. | Minor–moderate |
| `TECHNICAL_TERMINOLOGY_IMPRECISE` | Weakness | Uses technical language imprecisely enough to reduce clarity or change meaning. | Confuses business risk with financial risk. | Minor–moderate |
| `TECHNICAL_KNOWLEDGE_ACCURATE` | Strength | Demonstrates accurate, relevant technical knowledge without material error. | Selects the correct method and explains why it fits. | — |

## 2. Requirement Interpretation (`REQUIREMENT_INTERPRETATION`)

**Meaning:** Understanding what the requirement asks, including its verb, scope, audience, format, time horizon, and mark allocation.

**Relevant when:** Always, although the particular cues differ by question.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `REQUIREMENT_MISREAD` | Weakness | Answers a materially different question from the one asked. | Explains benefits when asked to evaluate risks and recommend an action. | Major |
| `REQUIREMENT_PARTIALLY_ANSWERED` | Weakness | Addresses some, but not all, material parts of the requirement. | Covers valuation but omits the separate financing recommendation. | Moderate–major |
| `REQUIREMENT_VERB_NOT_FOLLOWED` | Weakness | Response depth does not match the command verb. | Lists points for an “evaluate” requirement without weighing them. | Moderate |
| `REQUIREMENT_SCOPE_IGNORED` | Weakness | Ignores a stated entity, period, stakeholder, scenario boundary, or other scope condition. | Discusses the group when the requirement is limited to one subsidiary. | Moderate–major |
| `REQUIRED_FORMAT_NOT_FOLLOWED` | Weakness | Does not use a requested format where format affects professional effectiveness. | Writes unstructured notes instead of the requested board memo. | Minor–moderate |
| `REQUIREMENT_INTERPRETED_ACCURATELY` | Strength | Correctly identifies and responds to all material parts, verbs, and constraints. | Separates analysis and recommendation in line with two sub-requirements. | — |

## 3. Application to Scenario (`SCENARIO_APPLICATION`)

**Meaning:** Selecting relevant case facts and using them to support a point, rather than giving generic textbook commentary.

**Relevant when:** A scenario, exhibits, client facts, company data, or case context is supplied.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `GENERIC_NOT_SCENARIO_SPECIFIC` | Weakness | Gives a generally true point without applying it to the case. | Describes gearing risk without referring to the company’s proposed debt. | Moderate |
| `SCENARIO_FACT_NOT_CONNECTED` | Weakness | Quotes or mentions a fact but does not explain why it matters. | Repeats that demand fell 12% without linking it to cash flow or strategy. | Minor–moderate |
| `SCENARIO_FACT_MISUSED` | Weakness | Draws a conclusion that is inconsistent with, or unsupported by, the cited fact. | Treats a higher receivables balance as proof of stronger liquidity. | Moderate–major |
| `MATERIAL_SCENARIO_FACT_OMITTED` | Weakness | Fails to use a prominent fact needed for a balanced answer. | Ignores a covenant breach when assessing financing options. | Moderate–major |
| `SCENARIO_APPLICATION_EFFECTIVE` | Strength | Uses specific facts accurately and connects them to the argument. | Links volatile foreign receipts to the suitability of a hedging method. | — |

## 4. Analysis / Development (`ANALYSIS_DEVELOPMENT`)

**Meaning:** Developing identified points through reasoning, causality, implications, and material consequences.

**Relevant when:** The verb or marking approach rewards explanation, analysis, discussion, assessment, or developed points.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `POINT_IDENTIFIED_NOT_DEVELOPED` | Weakness | Names a relevant point but stops before explaining it. | Says “currency risk increases” with no reason or effect. | Minor–moderate |
| `CONSEQUENCE_NOT_EXPLAINED` | Weakness | Does not state the operational, financial, stakeholder, or reporting consequence. | Notes staff turnover but not its effect on control quality or delivery. | Moderate |
| `CAUSAL_LINK_WEAK` | Weakness | The link between evidence, point, and claimed outcome is incomplete or implausible. | Claims a policy change will raise profit without explaining the mechanism. | Moderate–major |
| `ANALYSIS_DEPTH_LIMITED` | Weakness | Reasoning is directionally valid but too shallow for the requirement or marks. | Gives one short implication where several dimensions are material. | Minor–moderate |
| `ANALYSIS_WELL_DEVELOPED` | Strength | Builds a clear evidence → reasoning → consequence chain. | Connects a scenario fact to financing flexibility, covenant headroom, and decision impact. | — |

## 5. Evaluation / Judgement (`EVALUATION_JUDGEMENT`)

**Meaning:** Comparing evidence and alternatives, challenging assumptions, weighing trade-offs, and reaching a proportionate judgement.

**Relevant when:** The requirement asks to evaluate, assess, advise, recommend, discuss critically, or exercise professional judgement.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `EVALUATION_ONE_SIDED` | Weakness | Considers only one side of a material issue. | Lists benefits of an acquisition without risks or limitations. | Moderate |
| `ALTERNATIVES_NOT_WEIGHED` | Weakness | Presents options but does not compare them against decision criteria. | Describes forward and option hedges without judging suitability. | Moderate |
| `EVALUATION_CRITERIA_NOT_APPLIED` | Weakness | Reaches a preference without applying relevant criteria. | Recommends a project without considering risk, return, strategy, or constraints. | Moderate–major |
| `MATERIAL_ASSUMPTION_NOT_CHALLENGED` | Weakness | Accepts a consequential assumption or claim without scrutiny. | Accepts management’s growth forecast despite conflicting evidence. | Moderate–major |
| `TRADE_OFFS_WEIGHED` | Strength | Explicitly compares benefits, risks, constraints, and stakeholder effects. | Weighs option flexibility against the premium and risk appetite. | — |
| `JUDGEMENT_PROPORTIONATE` | Strength | Reaches a balanced judgement whose certainty matches the evidence. | Gives a conditional recommendation where key data is unavailable. | — |

## 6. Quantitative Accuracy (`QUANTITATIVE_ACCURACY`)

**Meaning:** Choice and execution of numerical methods, including inputs, formulas, workings, signs, units, and arithmetic.

**Relevant when:** The requirement contains or expects calculations, numerical analysis, ratios, forecasts, or data manipulation.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `CALCULATION_METHOD_INCORRECT` | Weakness | Uses a method that is unsuitable or technically wrong. | Discounts the wrong cash-flow measure or uses the wrong hedge direction. | Major |
| `CALCULATION_ERROR` | Weakness | Makes an arithmetic or formula-execution error within an otherwise plausible method. | Adds cash flows incorrectly or mistypes an exponent. | Minor–moderate |
| `CALCULATION_INPUT_INCORRECT` | Weakness | Selects, derives, or transcribes a material input incorrectly. | Uses the current spot rate where a forecast rate was required. | Minor–major |
| `CALCULATION_WORKING_NOT_TRACEABLE` | Weakness | Omits enough working that the method or source of the result cannot be checked. | Gives a final NPV with no visible cash-flow or discounting steps. | Minor–moderate |
| `UNIT_OR_SIGN_ERROR` | Weakness | Mishandles units, scaling, currency, percentages, inflow/outflow signs, or time periods. | Treats figures in thousands as whole units. | Minor–major |
| `CALCULATION_ACCURATE` | Strength | Uses an appropriate method with accurate, traceable workings. | Correctly computes and labels each alternative. | — |

## 7. Interpretation of Quantitative Results (`QUANTITATIVE_INTERPRETATION`)

**Meaning:** Explaining what a numerical result means for the scenario, decision, risk, or stakeholder.

**Relevant when:** A calculation, table, ratio, trend, sensitivity, or other quantitative output is present, even if the arithmetic was supplied rather than produced by the student.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `CALCULATION_NOT_INTERPRETED` | Weakness | Reports a result without explaining its decision meaning. | States an NPV but gives no accept/reject or strategic implication. | Moderate |
| `RESULT_DIRECTION_MISINTERPRETED` | Weakness | Interprets the sign, movement, ranking, or relationship incorrectly. | Treats a fall in interest cover as reduced lender risk. | Moderate–major |
| `MATERIALITY_NOT_ASSESSED` | Weakness | Does not judge whether the size of a result is meaningful. | Calls a tiny variance “significant” with no benchmark. | Minor–moderate |
| `COMMERCIAL_IMPLICATION_MISSING` | Weakness | Omits the business, cash-flow, stakeholder, risk, or strategic consequence. | Calculates a hedge outcome but does not discuss cost certainty or downside. | Moderate |
| `QUANTITATIVE_INSIGHT_EFFECTIVE` | Strength | Converts a correct result into a scenario-specific decision insight. | Explains both value and risk implications of the calculated sensitivity. | — |

## 8. Professional Skills (`PROFESSIONAL_SKILLS`)

**Meaning:** Clear, credible, audience-appropriate professional communication and behaviours such as scepticism, commercial acumen, analysis, and judgement where the paper or task assesses them.

**Relevant when:** The requirement specifies a professional role, audience, format, or professional-skill objective. Paper-specific rules should identify which skill is actually available for credit.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `PROFESSIONAL_TONE_WEAK` | Weakness | Tone is unsuitable for the role or audience. | Uses casual, accusatory, or absolute language in a board report. | Minor–moderate |
| `COMMUNICATION_UNCLEAR` | Weakness | Organisation or expression makes the reasoning difficult to follow. | Dense paragraphs obscure separate issues and actions. | Minor–moderate |
| `PROFESSIONAL_SCEPTICISM_MISSING` | Weakness | Fails to question evidence, management claims, bias, or uncertainty when required. | Accepts an optimistic forecast without corroboration. | Moderate–major |
| `PROFESSIONAL_FORMAT_INEFFECTIVE` | Weakness | Uses headings, layout, or structure poorly for the requested deliverable. | A briefing note lacks purpose, clear sections, or prioritised actions. | Minor–moderate |
| `DATA_PRESENTATION_INEFFECTIVE` | Weakness | Presents data in a way that obscures comparison or decision relevance. | Gives an unlabeled number dump instead of a concise table. | Minor–moderate |
| `PROFESSIONAL_COMMUNICATION_EFFECTIVE` | Strength | Communicates clearly in a format and tone suited to the audience. | Produces a concise, well-labelled report for a finance director. | — |
| `PROFESSIONAL_SCEPTICISM_EFFECTIVE` | Strength | Challenges material claims and identifies the evidence needed. | Flags management bias and requests independent support. | — |

## 9. Exam Execution (`EXAM_EXECUTION`)

**Meaning:** Converting knowledge into marks under exam constraints through relevance, structure, coverage, prioritisation, and time/mark allocation.

**Relevant when:** Always, but time-management findings require enough evidence about completeness, timing, or answer sequence; they must not be inferred merely from weak content.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `IRRELEVANT_CONTENT` | Weakness | Includes material that does not help answer the requirement. | Writes a long model definition unrelated to the decision asked for. | Minor–moderate |
| `REPETITION` | Weakness | Repeats substantially the same point without adding development. | Restates the same risk in three paragraphs. | Minor–moderate |
| `POOR_MARK_ALLOCATION` | Weakness | Effort or answer length is materially misaligned with available marks. | Spends most of the response on a low-mark subpart. | Moderate–major |
| `ANSWER_STRUCTURE_WEAK` | Weakness | Structure hinders coverage, clarity, or marker navigation. | Mixes unrelated sub-requirements with no signposting. | Minor–moderate |
| `INCOMPLETE_RESPONSE` | Weakness | Leaves a material part unfinished without evidence that the cause was knowledge or interpretation. | Ends mid-analysis or omits the final requirement. | Moderate–major |
| `TIME_MANAGEMENT_CONCERN` | Weakness | Timing evidence indicates the student could not allocate or complete effort effectively. | Later requirements are blank and the attempt record confirms time expired. | Moderate–major |
| `EFFICIENT_EXAM_EXECUTION` | Strength | Uses concise, relevant, well-prioritised points in proportion to marks. | Covers all subparts with developed points and little repetition. | — |

## 10. Conclusion / Recommendation (`CONCLUSION_RECOMMENDATION`)

**Meaning:** Drawing together the analysis into a supported, practical, and appropriately qualified conclusion or action.

**Relevant when:** The requirement asks for a conclusion, recommendation, advice, decision, or overall assessment, or where one is naturally necessary to complete the response.

| Tag | Type | Definition | Example evidence | Typical severity |
|---|---|---|---|---|
| `CONCLUSION_MISSING` | Weakness | Does not provide a required overall conclusion or decision. | Analysis ends without answering whether to proceed. | Moderate–major |
| `CONCLUSION_UNSUPPORTED` | Weakness | Gives a conclusion that is not supported by the preceding evidence. | Rejects a project after analysis showing positive value with no counterreason. | Moderate–major |
| `RECOMMENDATION_NOT_LINKED_TO_ANALYSIS` | Weakness | Recommendation does not follow clearly from the developed points. | Selects a hedge without comparing the calculated alternatives. | Moderate |
| `RECOMMENDATION_NOT_ACTIONABLE` | Weakness | Advice is too vague to guide a next step. | Says “improve controls” without specifying what or by whom. | Minor–moderate |
| `RECOMMENDATION_IGNORES_CONSTRAINT` | Weakness | Recommendation conflicts with an explicit material constraint. | Recommends unaffordable funding despite a stated borrowing limit. | Moderate–major |
| `CONCLUSION_WELL_SUPPORTED` | Strength | Conclusion accurately synthesises the strongest evidence and limitations. | Recommends one option conditionally, citing value, risk, and missing data. | — |
| `RECOMMENDATION_ACTIONABLE` | Strength | Specifies a feasible action, owner/condition, or next step where appropriate. | Recommends the option subject to a defined sensitivity test and approval. | — |

## Cross-tag rules

1. **Use the most causal tag.** If wrong technical knowledge caused a wrong number, tag both only when each distinction is useful; otherwise avoid inflating one error into several weaknesses.
2. **Do not infer intent.** Diagnose the written answer, not what the student “must have meant.”
3. **Do not infer timing without timing evidence.** An incomplete answer can be tagged `INCOMPLETE_RESPONSE`; add `TIME_MANAGEMENT_CONCERN` only when timing or attempt metadata supports it.
4. **Separate calculation from interpretation.** A student may earn `CALCULATION_ACCURATE` and still receive `CALCULATION_NOT_INTERPRETED`.
5. **Separate occurrence from pattern.** The diagnostic layer reports this attempt only. It never labels a weakness “recurring.”
6. **Cite evidence.** Each weakness needs a short excerpt or location reference, an explanation, and the affected scope.
7. **Allow uncertainty.** Use `NOT_RELEVANT`, `INSUFFICIENT_EVIDENCE`, or an uncertainty flag when the required material is missing or ambiguous.

## Paper-specific extension interface

Each later paper pack should add configuration rather than fork this taxonomy:

| Extension field | Purpose |
|---|---|
| `paper` | `SBL`, `SBR`, `AFM`, `APM`, or `AAA`. |
| `syllabus_version` | Prevents rules from silently surviving syllabus changes. |
| `topic` / `subtopic` | Maps universal diagnoses to paper content. |
| `requirement_verb_rules` | Sets expected depth for verbs in that paper. |
| `applicable_dimensions` | Identifies which dimensions can reasonably be assessed for a question type. |
| `paper_specific_evidence_rules` | Defines what evidence supports a tag without changing the tag meaning. |
| `professional_skill_mapping` | Identifies relevant professional skills and any paper-specific constraints. |
| `calculation_method_checks` | Holds deterministic or rubric-grounded method checks where possible. |
| `tag_priority_overrides` | Adjusts remediation priority for a paper or question type, not diagnosis truth. |

Examples: AFM may add hedge/valuation method checks; AAA may add scepticism and audit-evidence rules; SBR may add reporting-treatment rules; APM may add performance-measure and behavioural-consequence rules; SBL may add role, audience, exhibit-integration, and professional-skill rules. These extensions remain subject to benchmark evidence.

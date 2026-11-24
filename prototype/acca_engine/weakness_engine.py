"""Part of ../../PROJECT.md — deterministic longitudinal weakness classification."""

from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime
from math import pow
from typing import Any, Iterable


ACTIVE_PATTERN_STATES = {"EMERGING", "RECURRING", "IMPROVING", "REGRESSING"}
PATTERN_HISTORY_STATES = ACTIVE_PATTERN_STATES | {"POTENTIALLY_RESOLVED"}
SUPPORTED_CONFIDENCE = {"MEDIUM", "HIGH"}


class WeaknessEngine:
    """Apply the rules in WEAKNESS_ENGINE.md to structured attempt histories."""

    def __init__(self, config: dict[str, Any]):
        self.config = deepcopy(config)
        self.confidence_weights = self.config["confidence_weights"]
        self.severity_weights = self.config["severity_weights"]
        self.tag_dimensions = self.config["tag_dimensions"]
        self.related_tags = self._build_related_tag_map(
            self.config.get("related_tag_groups", [])
        )

    @staticmethod
    def _build_related_tag_map(groups: Iterable[Iterable[str]]) -> dict[str, set[str]]:
        mapping: dict[str, set[str]] = defaultdict(set)
        for group in groups:
            values = set(group)
            for tag in values:
                mapping[tag].update(values - {tag})
        return dict(mapping)

    def analyze_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        """Return paper-level/display profiles plus the underlying context profiles."""

        self._validate_profile(profile)
        attempts = sorted(profile["attempts"], key=lambda row: row["attempted_at"])
        observed_tags = sorted(
            {
                weakness["tag"]
                for attempt in attempts
                for weakness in attempt.get("weaknesses", [])
            }
        )
        context_profiles: list[dict[str, Any]] = []
        display_profiles: list[dict[str, Any]] = []

        for tag in observed_tags:
            all_exposures = self._build_exposures(attempts, tag)
            hit_contexts = sorted(
                {
                    exposure["context_key"]
                    for exposure in all_exposures
                    if exposure["classification"] in {"HIT", "WEAK_SIGNAL"}
                }
            )
            per_context: list[dict[str, Any]] = []
            for context_key in hit_contexts:
                exposures = [
                    exposure
                    for exposure in all_exposures
                    if exposure["context_key"] == context_key
                ]
                result = self._classify_exposures(
                    profile=profile,
                    tag=tag,
                    exposures=exposures,
                    scope="CONTEXT",
                    context_key=context_key,
                )
                per_context.append(result)
                context_profiles.append(result)

            supported_hit_contexts = {
                exposure["context_key"]
                for exposure in all_exposures
                if exposure["classification"] == "HIT"
            }
            rollup_config = self.config["context"]
            is_general = tag in rollup_config["inherently_general_tags"]
            can_roll_up = is_general or len(supported_hit_contexts) >= int(
                rollup_config["paper_rollup_minimum_hit_contexts"]
            )

            if can_roll_up:
                display_profiles.append(
                    self._classify_exposures(
                        profile=profile,
                        tag=tag,
                        exposures=all_exposures,
                        scope="PAPER_ROLLUP",
                        context_key="ANY_TOPIC|ANY_QUESTION_TYPE",
                    )
                )
            elif per_context:
                display_profiles.append(
                    max(
                        per_context,
                        key=lambda item: (
                            item["priority_score"],
                            item["weighted_prevalence"],
                            item["context_key"],
                        ),
                    )
                )

        display_profiles.sort(
            key=lambda item: (-item["priority_score"], item["tag"], item["context_key"])
        )
        strengths = self._summarise_strengths(attempts)
        return {
            "student_id": profile["profile_id"],
            "paper": profile["paper"],
            "description": profile.get("description"),
            "current_study_context": deepcopy(profile.get("current_study_context", {})),
            "strengths": strengths,
            "weakness_profiles": display_profiles,
            "context_profiles": sorted(
                context_profiles,
                key=lambda item: (item["tag"], item["context_key"]),
            ),
            "engine_version": self.config["weakness_engine_version"],
            "config_version": self.config["config_version"],
        }

    def _validate_profile(self, profile: dict[str, Any]) -> None:
        required = {"profile_id", "paper", "attempts"}
        missing = sorted(required - profile.keys())
        if missing:
            raise ValueError(f"Profile is missing required keys: {missing}")
        if not isinstance(profile["attempts"], list):
            raise ValueError("Profile attempts must be a list")
        seen_analysis_ids: set[str] = set()
        for attempt in profile["attempts"]:
            analysis_id = attempt.get("analysis_id")
            if not analysis_id:
                raise ValueError("Every compact attempt requires analysis_id")
            if analysis_id in seen_analysis_ids:
                raise ValueError(f"Duplicate analysis_id: {analysis_id}")
            seen_analysis_ids.add(analysis_id)
            try:
                datetime.fromisoformat(attempt["attempted_at"].replace("Z", "+00:00"))
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"Invalid attempted_at for {analysis_id}") from exc
            for weakness in attempt.get("weaknesses", []):
                tag = weakness.get("tag")
                if tag not in self.tag_dimensions:
                    raise ValueError(f"Unknown weakness tag {tag!r} in {analysis_id}")
                if weakness.get("severity") not in self.severity_weights:
                    raise ValueError(f"Invalid severity for {tag} in {analysis_id}")
                if weakness.get("confidence") not in self.confidence_weights:
                    raise ValueError(f"Invalid confidence for {tag} in {analysis_id}")

    def _build_exposures(
        self, attempts: list[dict[str, Any]], tag: str
    ) -> list[dict[str, Any]]:
        dimension = self.tag_dimensions[tag]
        exposures: list[dict[str, Any]] = []
        unsafe_flags = {
            "SOURCE_UNREADABLE",
            "OUTSIDE_SUPPORTED_SCOPE",
            "PAPER_RULES_UNAVAILABLE",
        }

        for attempt in attempts:
            scores = attempt.get("dimension_scores", {})
            if dimension not in scores:
                continue
            uncertainty_flags = set(attempt.get("uncertainty_flags", []))
            if uncertainty_flags & unsafe_flags:
                continue
            dimension_confidence = attempt.get("dimension_confidence", {}).get(
                dimension,
                attempt.get("default_dimension_confidence", "HIGH"),
            )
            if dimension_confidence not in self.confidence_weights:
                raise ValueError(
                    f"Invalid dimension confidence in {attempt['analysis_id']}: "
                    f"{dimension_confidence}"
                )
            if dimension_confidence == "LOW":
                continue

            matches = [
                weakness
                for weakness in attempt.get("weaknesses", [])
                if weakness["tag"] == tag
            ]
            weakness = max(
                matches,
                key=lambda item: (
                    self.severity_weights[item["severity"]]
                    * self.confidence_weights[item["confidence"]],
                    item["severity"],
                ),
                default=None,
            )
            present_tags = {
                item["tag"] for item in attempt.get("weaknesses", [])
            }
            score = scores[dimension]
            if weakness and weakness["confidence"] in SUPPORTED_CONFIDENCE:
                classification = "HIT"
            elif weakness:
                classification = "WEAK_SIGNAL"
            elif (
                score in {3, 4}
                and not (present_tags & self.related_tags.get(tag, set()))
                and not uncertainty_flags
            ):
                classification = "CLEAN"
            else:
                classification = "NEUTRAL"

            topic = attempt.get("topic", "UNKNOWN_TOPIC")
            question_type = attempt.get("question_type", "UNKNOWN_QUESTION_TYPE")
            exposures.append(
                {
                    "sequence": len(exposures),
                    "analysis_id": attempt["analysis_id"],
                    "attempt_group_id": attempt.get(
                        "attempt_group_id", attempt["analysis_id"]
                    ),
                    "attempted_at": attempt["attempted_at"],
                    "attempt_date": attempt["attempted_at"][:10],
                    "question_key": attempt.get(
                        "question_key", attempt["analysis_id"]
                    ),
                    "topic": topic,
                    "question_type": question_type,
                    "context_key": f"{topic}|{question_type}",
                    "dimension_score": score,
                    "dimension_confidence": dimension_confidence,
                    "classification": classification,
                    "severity": weakness.get("severity") if weakness else None,
                    "diagnosis_confidence": (
                        weakness.get("confidence") if weakness else None
                    ),
                }
            )
        return exposures

    def _classify_exposures(
        self,
        profile: dict[str, Any],
        tag: str,
        exposures: list[dict[str, Any]],
        scope: str,
        context_key: str,
    ) -> dict[str, Any]:
        exposures = [
            {**deepcopy(exposure), "sequence": index}
            for index, exposure in enumerate(exposures)
        ]
        state: str | None = None
        pattern_established_at: int | None = None
        pattern_ever = False
        ever_potentially_resolved = False
        reactivated = False
        transitions: list[dict[str, Any]] = []
        last_reasons: list[str] = []

        for end in range(1, len(exposures) + 1):
            prefix = exposures[:end]
            prior_state = state
            next_state, reasons = self._state_for_prefix(
                prefix=prefix,
                prior_state=prior_state,
                pattern_ever=pattern_ever,
                pattern_established_at=pattern_established_at,
            )
            if next_state in PATTERN_HISTORY_STATES:
                if pattern_established_at is None and next_state in {
                    "EMERGING",
                    "RECURRING",
                }:
                    pattern_established_at = end
                pattern_ever = True
            if next_state == "POTENTIALLY_RESOLVED":
                ever_potentially_resolved = True
            if next_state == "REGRESSING" and ever_potentially_resolved:
                reactivated = True
            state = next_state
            last_reasons = reasons
            if state != prior_state:
                transitions.append(
                    {
                        "from_state": prior_state,
                        "to_state": state,
                        "effective_at": prefix[-1]["attempted_at"],
                        "rule_version": self.config["weakness_engine_version"],
                        "supporting_analysis_ids": [
                            exposure["analysis_id"] for exposure in prefix
                        ],
                        "reason_codes": reasons,
                    }
                )

        window = exposures[-int(self.config["windows"]["pattern"]) :]
        prevalence = self._weighted_prevalence(window, exposures)
        counts = Counter(exposure["classification"] for exposure in exposures)
        hits = [exposure for exposure in exposures if exposure["classification"] == "HIT"]
        weak_signals = [
            exposure
            for exposure in exposures
            if exposure["classification"] == "WEAK_SIGNAL"
        ]
        resolution_count = int(self.config["windows"]["resolution"])
        latest_resolution = exposures[-resolution_count:]
        inactive_observation = bool(
            state == "OBSERVED"
            and len(latest_resolution) >= resolution_count
            and all(
                exposure["classification"] == "CLEAN"
                for exposure in latest_resolution
            )
        )
        confidence = self._aggregate_confidence(hits, weak_signals)
        insufficient_signal = not hits and bool(weak_signals)
        priority_score, priority_components = self._priority(
            profile=profile,
            state=state,
            weighted_prevalence=prevalence["value"],
            exposures=exposures,
            confidence=confidence,
            inactive_observation=inactive_observation,
        )
        trend = self._trend_summary(exposures, state, inactive_observation)
        return {
            "tag": tag,
            "dimension": self.tag_dimensions[tag],
            "scope": scope,
            "context_key": context_key,
            "state": state,
            "prior_state": transitions[-1]["from_state"] if transitions else None,
            "confidence": confidence,
            "insufficient_signal": insufficient_signal,
            "weighted_prevalence": prevalence["value"],
            "prevalence_numerator": prevalence["numerator"],
            "prevalence_denominator": prevalence["denominator"],
            "counts": {
                "hits": counts["HIT"],
                "weak_signals": counts["WEAK_SIGNAL"],
                "clean": counts["CLEAN"],
                "neutral": counts["NEUTRAL"],
                "relevant_exposures": len(exposures),
            },
            "priority_score": priority_score,
            "priority_components": priority_components,
            "supporting_analysis_ids": [item["analysis_id"] for item in hits],
            "last_observed_at": hits[-1]["attempted_at"] if hits else None,
            "context_breadth": len({item["context_key"] for item in hits}),
            "reactivated": reactivated,
            "inactive_observation": inactive_observation,
            "trend": trend,
            "current_reason_codes": last_reasons,
            "transitions": transitions,
            "engine_version": self.config["weakness_engine_version"],
            "config_version": self.config["config_version"],
        }

    def _state_for_prefix(
        self,
        prefix: list[dict[str, Any]],
        prior_state: str | None,
        pattern_ever: bool,
        pattern_established_at: int | None,
    ) -> tuple[str | None, list[str]]:
        thresholds = self.config["state_thresholds"]
        windows = self.config["windows"]
        short_size = int(windows["short"])
        pattern_size = int(windows["pattern"])
        emerging_size = int(windows["emerging"])
        resolution_size = int(windows["resolution"])
        recent = prefix[-short_size:]
        preceding = prefix[-(short_size * 2) : -short_size]
        pattern = prefix[-pattern_size:]
        emerging_window = prefix[-emerging_size:]
        recent_hits = self._unique_supported_hits(recent)
        preceding_prevalence = self._weighted_prevalence(preceding, prefix)["value"]
        recent_prevalence = self._weighted_prevalence(recent, prefix)["value"]
        pattern_prevalence = self._weighted_prevalence(pattern, prefix)["value"]

        regression = thresholds["regressing"]
        stable_low_history = bool(
            pattern_ever
            and len(preceding) == short_size
            and preceding_prevalence
            <= float(regression["stable_low_maximum_prevalence"])
        )
        if (
            pattern_ever
            and (prior_state in {"IMPROVING", "POTENTIALLY_RESOLVED"} or stable_low_history)
            and len(recent_hits) >= int(regression["minimum_recent_hits"])
            and len({hit["attempt_group_id"] for hit in recent_hits})
            >= int(regression["minimum_distinct_attempts"])
            and recent_prevalence - preceding_prevalence
            >= float(regression["minimum_prevalence_increase"])
        ):
            return "REGRESSING", [
                "RECENT_HITS_GE_THRESHOLD",
                "RECENT_PREVALENCE_INCREASE_GE_THRESHOLD",
                "INDEPENDENT_ATTEMPTS_CONFIRMED",
            ]

        resolved = thresholds["potentially_resolved"]
        latest_resolution = prefix[-resolution_size:]
        if (
            prior_state in {"EMERGING", "RECURRING", "IMPROVING"}
            and len(latest_resolution)
            >= int(resolved["minimum_consecutive_clean"])
            and all(
                exposure["classification"] == "CLEAN"
                for exposure in latest_resolution
            )
            and len({item["question_key"] for item in latest_resolution})
            >= int(resolved["minimum_distinct_questions"])
            and len({item["attempt_date"] for item in latest_resolution})
            >= int(resolved["minimum_distinct_dates"])
            and self._weighted_prevalence(latest_resolution, prefix)["value"]
            < float(resolved["maximum_recent_prevalence"])
            and not any(
                item["classification"] == "HIT" and item["severity"] == "MAJOR"
                for item in latest_resolution
            )
        ):
            return "POTENTIALLY_RESOLVED", [
                "FOUR_CONSECUTIVE_CLEAN",
                "MULTIPLE_QUESTIONS_AND_DATES",
                "RECENT_PREVALENCE_BELOW_THRESHOLD",
            ]

        improving = thresholds["improving"]
        newer_exposures = (
            len(prefix) - pattern_established_at
            if pattern_established_at is not None
            else 0
        )
        if (
            prior_state in {"EMERGING", "RECURRING"}
            and newer_exposures >= int(improving["minimum_newer_exposures"])
            and len(preceding) == short_size
            and preceding_prevalence - recent_prevalence
            >= float(improving["minimum_prevalence_drop"])
            and len(recent_hits) <= int(improving["maximum_recent_hits"])
            and sum(
                exposure["classification"] == "CLEAN" for exposure in recent
            )
            >= int(improving["minimum_recent_clean"])
        ):
            return "IMPROVING", [
                "RECENT_DROP_GE_THRESHOLD",
                "RECENT_HITS_WITHIN_LIMIT",
                "TWO_OF_THREE_CLEAN",
            ]

        recurring = thresholds["recurring_standard"]
        pattern_hits = self._unique_supported_hits(pattern)
        standard_recurring = bool(
            len(pattern_hits) >= int(recurring["minimum_hits"])
            and len({hit["attempt_group_id"] for hit in pattern_hits})
            >= int(recurring["minimum_distinct_attempts"])
            and len({hit["attempt_date"] for hit in pattern_hits})
            >= int(recurring["minimum_distinct_dates"])
            and pattern_prevalence
            >= float(recurring["minimum_weighted_prevalence"])
        )
        accelerated = thresholds["recurring_accelerated"]
        major_high_hits = [
            hit
            for hit in pattern_hits
            if hit["severity"] == "MAJOR"
            and hit["diagnosis_confidence"] == "HIGH"
        ]
        accelerated_recurring = bool(
            len(major_high_hits) >= int(accelerated["minimum_major_high_hits"])
            and len({hit["attempt_group_id"] for hit in major_high_hits})
            >= int(accelerated["minimum_distinct_attempts"])
            and len({hit["attempt_date"] for hit in major_high_hits})
            >= int(accelerated["minimum_distinct_dates"])
            and pattern_prevalence
            >= float(accelerated["minimum_weighted_prevalence"])
        )
        if standard_recurring or accelerated_recurring:
            return "RECURRING", [
                "STANDARD_RECURRING_CRITERIA_MET"
                if standard_recurring
                else "ACCELERATED_MAJOR_HIGH_CRITERIA_MET",
                "WEIGHTED_PREVALENCE_GE_THRESHOLD",
                "INDEPENDENT_ATTEMPTS_CONFIRMED",
            ]

        # The specification defines evidence needed to leave a pattern via
        # IMPROVING/POTENTIALLY_RESOLVED but does not define an automatic
        # downgrade merely because old hits leave the six-exposure window.
        # Retain the established pattern until one of those explicit trend
        # transitions is met. This is surfaced as an implementation assumption.
        if prior_state == "RECURRING":
            return "RECURRING", ["RECURRING_RETAINED_PENDING_TREND_THRESHOLD"]

        emerging = thresholds["emerging"]
        emerging_hits = self._unique_supported_hits(emerging_window)
        if (
            len(emerging_hits) >= int(emerging["minimum_hits"])
            and len({hit["attempt_group_id"] for hit in emerging_hits})
            >= int(emerging["minimum_distinct_attempts"])
            and pattern_prevalence
            >= float(emerging["minimum_weighted_prevalence"])
        ):
            return "EMERGING", [
                "TWO_HITS_IN_LAST_FOUR",
                "WEIGHTED_PREVALENCE_GE_THRESHOLD",
                "INDEPENDENT_ATTEMPTS_CONFIRMED",
            ]

        if prior_state == "EMERGING":
            return "EMERGING", ["EMERGING_RETAINED_PENDING_TREND_THRESHOLD"]

        if self._unique_supported_hits(prefix):
            return "OBSERVED", ["AT_LEAST_ONE_SUPPORTED_HIT"]
        if any(item["classification"] == "WEAK_SIGNAL" for item in prefix):
            return None, ["LOW_CONFIDENCE_SIGNAL_ONLY"]
        return None, ["NO_SUPPORTED_SIGNAL"]

    def _unique_supported_hits(
        self, exposures: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        best_by_group: dict[str, dict[str, Any]] = {}
        for exposure in exposures:
            if exposure["classification"] != "HIT":
                continue
            group = exposure["attempt_group_id"]
            current = best_by_group.get(group)
            if current is None or self._raw_hit_strength(exposure) > self._raw_hit_strength(
                current
            ):
                best_by_group[group] = exposure
        return sorted(best_by_group.values(), key=lambda item: item["attempted_at"])

    def _raw_hit_strength(self, exposure: dict[str, Any]) -> float:
        return float(self.severity_weights[exposure["severity"]]) * float(
            self.confidence_weights[exposure["diagnosis_confidence"]]
        )

    def _weighted_prevalence(
        self,
        selected: list[dict[str, Any]],
        full_prefix: list[dict[str, Any]],
    ) -> dict[str, float]:
        if not selected:
            return {"value": 0.0, "numerator": 0.0, "denominator": 0.0}
        half_life = float(self.config["recency_half_life_exposures"])
        latest_sequence = full_prefix[-1]["sequence"]
        numerator = 0.0
        denominator = 0.0
        for exposure in selected:
            age = latest_sequence - exposure["sequence"]
            recency_weight = pow(0.5, age / half_life)
            denominator += (
                float(self.confidence_weights[exposure["dimension_confidence"]])
                * recency_weight
            )
            if exposure["classification"] == "HIT":
                numerator += self._raw_hit_strength(exposure) * recency_weight
        value = numerator / denominator if denominator else 0.0
        return {
            "value": round(min(1.0, max(0.0, value)), 6),
            "numerator": round(numerator, 6),
            "denominator": round(denominator, 6),
        }

    def _aggregate_confidence(
        self,
        hits: list[dict[str, Any]],
        weak_signals: list[dict[str, Any]],
    ) -> str | None:
        values = hits if hits else weak_signals
        if not values:
            return None
        weights = [
            float(self.confidence_weights[item["diagnosis_confidence"]])
            for item in values
        ]
        average = sum(weights) / len(weights)
        if average >= 0.85:
            return "HIGH"
        if average >= 0.55:
            return "MEDIUM"
        return "LOW"

    def _priority(
        self,
        profile: dict[str, Any],
        state: str | None,
        weighted_prevalence: float,
        exposures: list[dict[str, Any]],
        confidence: str | None,
        inactive_observation: bool,
    ) -> tuple[float, dict[str, float]]:
        config = self.config["priority"]
        recent = exposures[-int(self.config["windows"]["short"]) :]
        recent_hits = [item for item in recent if item["classification"] == "HIT"]
        recent_max_severity = max(
            (
                float(self.severity_weights[item["severity"]])
                for item in recent_hits
            ),
            default=0.0,
        )
        current_topic = profile.get("current_study_context", {}).get("topic")
        exam_relevance = (
            float(config["current_topic_exam_relevance"])
            if current_topic
            and any(item["topic"] == current_topic for item in exposures)
            else float(config["same_paper_exam_relevance"])
        )
        hit_contexts = {
            item["context_key"]
            for item in exposures
            if item["classification"] == "HIT"
        }
        breadth_weight = min(
            1.0,
            len(hit_contexts) / float(config["breadth_contexts_for_full_weight"]),
        )
        state_weight = float(config["state_weights"].get(state, 0.0))
        components = {
            "weighted_prevalence": round(
                float(config["weighted_prevalence_points"])
                * weighted_prevalence,
                3,
            ),
            "recent_max_severity": round(
                float(config["recent_max_severity_points"])
                * recent_max_severity,
                3,
            ),
            "state": round(float(config["state_points"]) * state_weight, 3),
            "exam_relevance": round(
                float(config["exam_relevance_points"]) * exam_relevance,
                3,
            ),
            "breadth": round(float(config["breadth_points"]) * breadth_weight, 3),
        }
        score = sum(components.values())
        if confidence == "LOW":
            score = min(score, float(config["low_confidence_only_cap"]))
        if inactive_observation:
            score = 0.0
        return round(min(100.0, max(0.0, score)), 3), components

    def _trend_summary(
        self,
        exposures: list[dict[str, Any]],
        state: str | None,
        inactive_observation: bool,
    ) -> str:
        counts = Counter(item["classification"] for item in exposures)
        if inactive_observation:
            return (
                "One supported observation is followed by four clean relevant "
                "exposures; it remains in history but is inactive."
            )
        if state == "IMPROVING":
            return "Recent relevant exposures are materially cleaner than the preceding window."
        if state == "POTENTIALLY_RESOLVED":
            return "Four consecutive clean relevant exposures support possible resolution."
        if state == "REGRESSING":
            return "At least two recent independent hits reverse a previously lower rate."
        if state == "RECURRING":
            return f"{counts['HIT']} supported hits show a repeated pattern."
        if state == "EMERGING":
            return f"{counts['HIT']} supported hits indicate a developing pattern."
        if state == "OBSERVED":
            return "A supported issue is visible, but independent pattern evidence is insufficient."
        if counts["WEAK_SIGNAL"]:
            return "Only low-confidence evidence is present; no active weakness state is assigned."
        return "No supported weakness signal."

    @staticmethod
    def _summarise_strengths(attempts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        counts: Counter[str] = Counter()
        latest: dict[str, str] = {}
        for attempt in attempts:
            for tag in attempt.get("strength_tags", []):
                counts[tag] += 1
                latest[tag] = attempt["attempted_at"]
        return [
            {"tag": tag, "occurrences": count, "last_observed_at": latest[tag]}
            for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        ]

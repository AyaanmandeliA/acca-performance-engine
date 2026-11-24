"""Part of ../../PROJECT.md — deterministic, explainable question ranking."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any


CONFIDENCE_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


class RecommendationEngine:
    """Rank accessible question metadata using the documented 100-point model."""

    def __init__(self, config: dict[str, Any]):
        self.config = deepcopy(config)
        self.rec_config = self.config["recommendation"]
        self.tag_dimensions = self.config["tag_dimensions"]
        self.related_tags = self._build_related_tag_map(
            self.config.get("related_tag_groups", [])
        )

    @staticmethod
    def _build_related_tag_map(groups: list[list[str]]) -> dict[str, set[str]]:
        mapping: dict[str, set[str]] = {}
        for group in groups:
            values = set(group)
            for tag in values:
                mapping.setdefault(tag, set()).update(values - {tag})
        return mapping

    def rank_questions(
        self,
        profile: dict[str, Any],
        weakness_result: dict[str, Any],
        catalogue: list[dict[str, Any]],
        question_statuses: dict[str, dict[str, Any]] | None = None,
        *,
        limit: int = 3,
        mode_override: str | None = None,
        as_of: str | None = None,
        allow_specific_questions: bool = True,
    ) -> dict[str, Any]:
        """Return separately typed skill and development-only question guidance."""

        statuses = question_statuses or {}
        current_time = self._parse_datetime(as_of) if as_of else datetime.now(timezone.utc)
        active_profiles = self._active_profiles(weakness_result)
        mode = mode_override or self._select_mode(active_profiles)
        targets = self._select_targets(active_profiles, mode)
        available_keys = set(profile.get("available_question_keys", []))
        candidates: list[dict[str, Any]] = []
        exclusions: list[dict[str, str]] = []

        question_catalogue = catalogue if allow_specific_questions else []
        for raw_question in question_catalogue:
            question = self._normalize_question(raw_question)
            status = self._normalise_status(
                question_key=question["question_key"],
                status=statuses.get(question["question_key"], {}),
                available_keys=available_keys,
            )
            reason = self._ineligibility_reason(
                profile=profile,
                question=question,
                status=status,
                mode=mode,
                current_time=current_time,
            )
            if reason:
                exclusions.append(
                    {"question_key": question["question_key"], "reason": reason}
                )
                continue
            candidates.append(
                self._score_candidate(
                    profile=profile,
                    question=question,
                    status=status,
                    targets=targets,
                    mode=mode,
                )
            )

        ranked = self._rank_with_diversity(candidates)
        recommendations = ranked[: max(0, int(limit))]
        for recommendation in recommendations:
            recommendation["recommendation_type"] = (
                "SPECIFIC_QUESTION_RECOMMENDATION"
            )
            recommendation["safety_status"] = "DEVELOPMENT_ONLY"
        skill_recommendations = self._build_skill_recommendations(profile, targets)
        if not recommendations:
            outcome = "NO_ELIGIBLE_QUESTION"
        else:
            outcome = "RECOMMENDATIONS_AVAILABLE"
        return {
            "student_id": profile["profile_id"],
            "paper": profile["paper"],
            "mode": mode,
            "outcome": outcome,
            "targets": targets,
            "recommendations": recommendations,
            "skill_recommendations": skill_recommendations,
            "skill_recommendation_outcome": (
                "SKILL_RECOMMENDATIONS_AVAILABLE"
                if skill_recommendations
                else "NO_SUPPORTED_SKILL_RECOMMENDATION"
            ),
            "specific_question_recommendations": deepcopy(recommendations),
            "specific_question_recommendation_status": (
                "DEVELOPMENT_ONLY"
                if allow_specific_questions
                else "BLOCKED_PAPER_RULES_UNAVAILABLE"
            ),
            "safety_flags": [
                "SYNTHETIC_CATALOGUE_DEVELOPMENT_ONLY"
                if allow_specific_questions
                else "PAPER_RULES_UNAVAILABLE_SPECIFIC_QUESTIONS_BLOCKED"
            ],
            "exclusions": sorted(
                exclusions, key=lambda item: (item["reason"], item["question_key"])
            ),
            "engine_version": self.config["recommendation_engine_version"],
            "config_version": self.config["config_version"],
        }

    @staticmethod
    def _build_skill_recommendations(
        profile: dict[str, Any], targets: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Build universal practice guidance without needing a question catalogue."""

        output = []
        for rank, target in enumerate(targets, start=1):
            sourced_actions: list[dict[str, Any]] = []
            source_analysis_ids: list[str] = []
            for attempt in profile.get("attempts", []):
                for weakness in attempt.get("weaknesses", []):
                    if weakness.get("tag") != target["tag"]:
                        continue
                    source_analysis_ids.append(attempt["analysis_id"])
                    sourced_actions.extend(
                        deepcopy(weakness.get("recommended_actions", []))
                    )
            sourced_actions.sort(
                key=lambda action: (
                    action.get("priority") is None,
                    action.get("priority") or 0,
                    action.get("action_id") or "",
                )
            )
            primary_action = sourced_actions[0] if sourced_actions else {}
            output.append(
                {
                    "recommendation_type": "SKILL_RECOMMENDATION",
                    "safety_status": "BETA_ELIGIBLE_AFTER_HUMAN_REVIEW",
                    "rank": rank,
                    "skill_id": target["tag"],
                    "skill_label": target["tag"].replace("_", " ").title(),
                    "dimension": target["dimension"],
                    "confidence": target["confidence"],
                    "priority_score": target["priority_score"],
                    "practice_action": primary_action.get("action"),
                    "success_check": primary_action.get("success_check"),
                    "source_analysis_ids": sorted(set(source_analysis_ids)),
                }
            )
        return output

    def _active_profiles(self, weakness_result: dict[str, Any]) -> list[dict[str, Any]]:
        profiles = []
        for item in weakness_result.get("weakness_profiles", []):
            if item.get("inactive_observation"):
                continue
            if not item.get("state"):
                continue
            if item.get("confidence") == "LOW":
                continue
            if float(item.get("priority_score", 0)) <= 0:
                continue
            profiles.append(deepcopy(item))
        return sorted(profiles, key=lambda item: (-item["priority_score"], item["tag"]))

    def _select_mode(self, active_profiles: list[dict[str, Any]]) -> str:
        if not active_profiles:
            return "BASELINE"
        top = active_profiles[0]
        if (
            top["dimension"] in set(self.config["technical_dimensions"])
            and top["state"] in {"EMERGING", "RECURRING", "REGRESSING"}
        ):
            return "FOUNDATION_REPAIR"
        if top["state"] in {"IMPROVING", "POTENTIALLY_RESOLVED"}:
            return "CONFIRM_IMPROVEMENT"

        high_profiles = [
            item
            for item in active_profiles
            if float(item["priority_score"])
            >= float(self.rec_config["broad_profile_priority_floor"])
        ]
        if (
            len(high_profiles) >= int(self.rec_config["broad_profile_minimum_count"])
            and max((item.get("context_breadth", 0) for item in high_profiles), default=0)
            >= int(self.rec_config["broad_profile_minimum_contexts"])
        ):
            return "MIXED_CHALLENGE"

        total_priority = sum(float(item["priority_score"]) for item in active_profiles)
        top_two_priority = sum(
            float(item["priority_score"]) for item in active_profiles[:2]
        )
        if total_priority and top_two_priority / total_priority >= float(
            self.rec_config["targeted_priority_share"]
        ):
            return "TARGETED"
        return "MIXED_CHALLENGE"

    def _select_targets(
        self, active_profiles: list[dict[str, Any]], mode: str
    ) -> list[dict[str, Any]]:
        eligible = [
            item
            for item in active_profiles
            if mode == "CONFIRM_IMPROVEMENT"
            or item["state"] != "POTENTIALLY_RESOLVED"
        ]
        selected = eligible[: int(self.rec_config["maximum_targets"])]
        total = sum(float(item["priority_score"]) for item in selected)
        targets = []
        for item in selected:
            targets.append(
                {
                    "tag": item["tag"],
                    "dimension": item["dimension"],
                    "state": item["state"],
                    "confidence": item["confidence"],
                    "priority_score": item["priority_score"],
                    "context_key": item["context_key"],
                    "weight": round(
                        float(item["priority_score"]) / total if total else 0.0,
                        6,
                    ),
                }
            )
        return targets

    def _normalize_question(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Accept the full proposed schema or the deliberately compact fixtures."""

        if "classification" in raw:
            classification = raw["classification"]
            resource = raw.get("resource", {})
            locator = raw.get("locator", {})
            availability = raw.get("availability", {})
            paper = locator.get("paper") or classification.get("paper")
            display_locator = self._display_locator(resource, locator, raw["question_key"])
            return {
                "question_key": raw["question_key"],
                "paper": paper,
                "topic": classification.get("topic"),
                "subtopics": classification.get("subtopics", []),
                "question_types": classification.get("question_types", []),
                "requirement_verbs": classification.get("requirement_verbs", []),
                "marks": classification.get("marks"),
                "estimated_completion_minutes": classification.get(
                    "estimated_completion_minutes"
                ),
                "difficulty": classification.get("difficulty"),
                "diagnostic_tags_tested": classification.get(
                    "diagnostic_tags_tested", []
                ),
                "technical_skills": classification.get("technical_skills", []),
                "professional_skills": classification.get("professional_skills", []),
                "prerequisites": classification.get("prerequisites", []),
                "coverage_confidence": classification.get(
                    "coverage_confidence", "LOW"
                ),
                "provider": resource.get("provider", "UNKNOWN"),
                "active": availability.get("active", False),
                "metadata_verified": bool(availability.get("verified_at")),
                "content_stored": locator.get("question_content_stored", False),
                "display_locator": display_locator,
            }

        required = {
            "question_key",
            "paper",
            "topic",
            "question_types",
            "marks",
            "estimated_completion_minutes",
            "difficulty",
            "diagnostic_tags_tested",
            "coverage_confidence",
        }
        missing = sorted(required - raw.keys())
        if missing:
            raise ValueError(
                f"Question {raw.get('question_key', '<unknown>')} missing fields: {missing}"
            )
        return {
            "question_key": raw["question_key"],
            "paper": raw["paper"],
            "topic": raw["topic"],
            "subtopics": raw.get("subtopics", []),
            "question_types": raw.get("question_types", []),
            "requirement_verbs": raw.get("requirement_verbs", []),
            "marks": raw["marks"],
            "estimated_completion_minutes": raw["estimated_completion_minutes"],
            "difficulty": raw["difficulty"],
            "diagnostic_tags_tested": raw["diagnostic_tags_tested"],
            "technical_skills": raw.get("technical_skills", []),
            "professional_skills": raw.get("professional_skills", []),
            "prerequisites": raw.get("prerequisites", []),
            "coverage_confidence": raw["coverage_confidence"],
            "provider": raw.get("provider", "SYNTHETIC"),
            "active": raw.get("active", True),
            "metadata_verified": raw.get("metadata_verified", True),
            "content_stored": raw.get("content_stored", False),
            "display_locator": raw.get("display_locator", raw["question_key"]),
        }

    @staticmethod
    def _display_locator(
        resource: dict[str, Any], locator: dict[str, Any], fallback: str
    ) -> str:
        provider = resource.get("provider")
        title = resource.get("resource_title")
        edition = resource.get("edition")
        question_id = locator.get("question_id")
        parts = [part for part in (provider, title, edition) if part]
        if question_id:
            parts.append(f"Question {question_id}")
        return ", ".join(parts) if parts else fallback

    @staticmethod
    def _normalise_status(
        question_key: str,
        status: dict[str, Any],
        available_keys: set[str],
    ) -> dict[str, Any]:
        default_access = question_key in available_keys if available_keys else False
        return {
            "has_lawful_access": status.get("has_lawful_access", default_access),
            "attempted": status.get("attempted", False),
            "attempt_count": status.get("attempt_count", 0),
            "last_attempted_at": status.get("last_attempted_at"),
            "recent_performance_band": status.get(
                "recent_performance_band", "UNKNOWN"
            ),
            "cooldown_until": status.get("cooldown_until"),
            "student_excluded": status.get("student_excluded", False),
            "retry_requested": status.get("retry_requested", False),
            "recommended_retry": status.get("recommended_retry", False),
            "last_recommended_at": status.get("last_recommended_at"),
            "met_prerequisites": set(status.get("met_prerequisites", [])),
            "unmet_prerequisites": set(status.get("unmet_prerequisites", [])),
        }

    def _ineligibility_reason(
        self,
        profile: dict[str, Any],
        question: dict[str, Any],
        status: dict[str, Any],
        mode: str,
        current_time: datetime,
    ) -> str | None:
        if question["paper"] != profile["paper"]:
            return "PAPER_MISMATCH"
        if not status["has_lawful_access"]:
            return "NO_CONFIRMED_LAWFUL_ACCESS"
        if not question["active"] or not question["metadata_verified"]:
            return "INACTIVE_OR_UNVERIFIED_METADATA"
        if question["content_stored"]:
            return "QUESTION_CONTENT_STORAGE_NOT_ALLOWED"
        if status["student_excluded"]:
            return "STUDENT_EXCLUDED"
        minimum = self.rec_config["coverage_confidence_minimum"]
        if CONFIDENCE_RANK.get(question["coverage_confidence"], -1) < CONFIDENCE_RANK[
            minimum
        ]:
            return "COVERAGE_CONFIDENCE_TOO_LOW"
        available_minutes = profile.get("current_study_context", {}).get(
            "available_minutes"
        )
        if (
            available_minutes is not None
            and question["estimated_completion_minutes"] > available_minutes
        ):
            return "EXCEEDS_AVAILABLE_TIME"
        if status["cooldown_until"] and not status["retry_requested"]:
            if self._parse_datetime(status["cooldown_until"]) > current_time:
                return "IN_COOLDOWN"

        prerequisites = set(question["prerequisites"])
        explicitly_unmet = prerequisites & status["unmet_prerequisites"]
        if explicitly_unmet and not (
            mode == "FOUNDATION_REPAIR" and question["difficulty"] == "FOUNDATION"
        ):
            return "UNMET_PREREQUISITE"
        return None

    def _score_candidate(
        self,
        profile: dict[str, Any],
        question: dict[str, Any],
        status: dict[str, Any],
        targets: list[dict[str, Any]],
        mode: str,
    ) -> dict[str, Any]:
        direct_tags = set(question["diagnostic_tags_tested"])
        target_matches: list[dict[str, Any]] = []
        raw_coverage = 0.0
        for target in targets:
            match_type = "NONE"
            match_value = 0.0
            if target["tag"] in direct_tags:
                match_type = "DIRECT"
                match_value = float(self.rec_config["tag_match"]["direct"])
            elif self._has_related_or_dimension_match(target, direct_tags):
                match_type = "RELATED_OR_DIMENSION"
                match_value = float(self.rec_config["tag_match"]["related"])
            raw_coverage += float(target["weight"]) * match_value
            if match_value:
                target_matches.append(
                    {
                        "tag": target["tag"],
                        "state": target["state"],
                        "match": match_type,
                        "weighted_match": round(
                            float(target["weight"]) * match_value, 6
                        ),
                    }
                )

        score_weights = self.rec_config["scores"]
        coverage_score = min(1.0, raw_coverage) * float(
            score_weights["weakness_coverage"]
        )
        study_fit = self._study_fit(profile, question)
        preferred_difficulty = self._preferred_difficulty(mode, status)
        difficulty_fit = self._difficulty_fit(
            question["difficulty"], preferred_difficulty
        )
        length_fit = self._length_fit(profile, question)
        attempt_fit = self._attempt_fit(status)
        performance_fit = self._difficulty_fit(
            question["difficulty"], preferred_difficulty
        )
        transfer_value = self._transfer_or_mix_value(
            profile=profile,
            question=question,
            targets=targets,
            target_matches=target_matches,
            mode=mode,
        )
        components = {
            "weakness_coverage": round(coverage_score, 3),
            "current_study_fit": round(study_fit, 3),
            "difficulty_fit": round(difficulty_fit, 3),
            "length_fit": round(length_fit, 3),
            "attempt_strategy_fit": round(attempt_fit, 3),
            "recent_performance_fit": round(performance_fit, 3),
            "transfer_or_mix_value": round(transfer_value, 3),
        }
        base_score = round(sum(components.values()), 3)
        verb_matches = self._requirement_verb_matches(targets, question)
        reasons = self._candidate_reasons(
            mode=mode,
            question=question,
            target_matches=target_matches,
            verb_matches=verb_matches,
            status=status,
            preferred_difficulty=preferred_difficulty,
        )
        return {
            "question_key": question["question_key"],
            "display_locator": question["display_locator"],
            "mode": mode,
            "score": base_score,
            "base_score": base_score,
            "diversity_penalty": 0.0,
            "score_components": components,
            "targets": target_matches,
            "requirement_verb_matches": verb_matches,
            "why": reasons,
            "metadata": {
                "paper": question["paper"],
                "topic": question["topic"],
                "subtopics": question["subtopics"],
                "question_types": question["question_types"],
                "requirement_verbs": question["requirement_verbs"],
                "marks": question["marks"],
                "estimated_completion_minutes": question[
                    "estimated_completion_minutes"
                ],
                "difficulty": question["difficulty"],
                "diagnostic_tags_tested": question["diagnostic_tags_tested"],
                "technical_skills": question["technical_skills"],
                "professional_skills": question["professional_skills"],
                "prerequisites": question["prerequisites"],
                "coverage_confidence": question["coverage_confidence"],
                "provider": question["provider"],
                "question_content_stored": question["content_stored"],
                "previously_attempted": status["attempted"],
            },
            "_sort": {
                "coverage_confidence": CONFIDENCE_RANK[
                    question["coverage_confidence"]
                ],
                "attempted": status["attempted"],
                "length_fit": length_fit,
                "last_recommended_at": status["last_recommended_at"] or "",
                "topic": question["topic"],
                "question_types": question["question_types"],
                "provider": question["provider"],
            },
        }

    def _has_related_or_dimension_match(
        self, target: dict[str, Any], question_tags: set[str]
    ) -> bool:
        related = self.related_tags.get(target["tag"], set())
        if related & question_tags:
            return True
        return any(
            self.tag_dimensions.get(tag) == target["dimension"]
            for tag in question_tags
        )

    def _study_fit(
        self, profile: dict[str, Any], question: dict[str, Any]
    ) -> float:
        context = profile.get("current_study_context", {})
        if question["paper"] != profile["paper"]:
            return 0.0
        if question["topic"] != context.get("topic"):
            return 5.0
        current_subtopic = context.get("subtopic")
        if current_subtopic and current_subtopic in question["subtopics"]:
            return 15.0
        return 10.0

    def _preferred_difficulty(
        self, mode: str, status: dict[str, Any]
    ) -> str:
        band = status["recent_performance_band"]
        if band == "WEAK":
            return "FOUNDATION"
        if band in {"BORDERLINE", "COMPETENT"}:
            return "STANDARD"
        if band == "STRONG":
            return "STRETCH"
        return self.rec_config["mode_preferred_difficulty"][mode]

    def _difficulty_fit(self, actual: str, preferred: str) -> float:
        order = self.rec_config["difficulty_order"]
        try:
            distance = abs(order.index(actual) - order.index(preferred))
        except ValueError:
            return 0.0
        maximum = float(self.rec_config["scores"]["difficulty_fit"])
        if distance == 0:
            return maximum
        if distance == 1:
            return maximum * 0.6
        return 0.0

    def _length_fit(
        self, profile: dict[str, Any], question: dict[str, Any]
    ) -> float:
        maximum = float(self.rec_config["scores"]["length_fit"])
        available = profile.get("current_study_context", {}).get("available_minutes")
        if not available:
            return maximum
        ratio = float(question["estimated_completion_minutes"]) / float(available)
        if ratio <= 0.6:
            return maximum
        if ratio >= 1.0:
            return maximum * 0.6
        return maximum - ((ratio - 0.6) / 0.4) * (maximum * 0.4)

    def _attempt_fit(self, status: dict[str, Any]) -> float:
        scores = self.rec_config["attempt_scores"]
        if not status["attempted"]:
            return float(scores["new"])
        if status["retry_requested"] or status["recommended_retry"]:
            return float(scores["deliberate_retry"])
        return float(scores["previously_attempted"])

    def _transfer_or_mix_value(
        self,
        profile: dict[str, Any],
        question: dict[str, Any],
        targets: list[dict[str, Any]],
        target_matches: list[dict[str, Any]],
        mode: str,
    ) -> float:
        maximum = float(self.rec_config["scores"]["transfer_or_mix_value"])
        direct_count = sum(item["match"] == "DIRECT" for item in target_matches)
        if mode == "CONFIRM_IMPROVEMENT":
            target_tags = {target["tag"] for target in targets}
            historical_topics = {
                attempt.get("topic")
                for attempt in profile.get("attempts", [])
                if any(
                    weakness["tag"] in target_tags
                    for weakness in attempt.get("weaknesses", [])
                )
            }
            return maximum if direct_count and question["topic"] not in historical_topics else maximum * 0.6 if direct_count else 0.0
        if mode == "MIXED_CHALLENGE":
            if not targets:
                return 0.0
            return maximum * min(1.0, direct_count / min(3, len(targets)))
        if mode == "TARGETED":
            if not direct_count:
                return 0.0
            all_tested = max(1, len(question["diagnostic_tags_tested"]))
            focus_ratio = direct_count / all_tested
            return maximum if focus_ratio >= 0.5 else maximum * 0.6
        if mode == "FOUNDATION_REPAIR":
            return maximum if direct_count and question["difficulty"] == "FOUNDATION" else 0.0
        return 0.0

    def _requirement_verb_matches(
        self, targets: list[dict[str, Any]], question: dict[str, Any]
    ) -> list[str]:
        configured = self.config.get("tag_requirement_verbs", {})
        desired = {
            verb.lower()
            for target in targets
            for verb in configured.get(target["tag"], [])
        }
        offered = {verb.lower() for verb in question["requirement_verbs"]}
        return sorted(desired & offered)

    @staticmethod
    def _candidate_reasons(
        mode: str,
        question: dict[str, Any],
        target_matches: list[dict[str, Any]],
        verb_matches: list[str],
        status: dict[str, Any],
        preferred_difficulty: str,
    ) -> list[str]:
        reasons = []
        if target_matches:
            direct = [item["tag"] for item in target_matches if item["match"] == "DIRECT"]
            related = [
                item["tag"]
                for item in target_matches
                if item["match"] == "RELATED_OR_DIMENSION"
            ]
            if direct:
                reasons.append("Directly tests: " + ", ".join(direct))
            if related:
                reasons.append("Related coverage: " + ", ".join(related))
        elif mode == "BASELINE":
            reasons.append("Provides a baseline because no active weakness has enough evidence.")
        else:
            reasons.append(
                "No direct or related target coverage; ranking comes only from context and fit."
            )
        if verb_matches:
            reasons.append("Relevant requirement verbs: " + ", ".join(verb_matches))
        if question["difficulty"] == preferred_difficulty:
            reasons.append(f"Difficulty matches the current {preferred_difficulty} target.")
        if status["attempted"]:
            reasons.append("Previously attempted; attempt-history penalty applied.")
        else:
            reasons.append("Unattempted question; novelty preference applied.")
        if question["prerequisites"] and not status["met_prerequisites"]:
            reasons.append("Prerequisite status is not supplied in the synthetic fixture.")
        return reasons

    def _rank_with_diversity(
        self, candidates: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        remaining = [deepcopy(item) for item in candidates]
        selected: list[dict[str, Any]] = []
        penalty_points = float(self.rec_config["diversity_penalty_points"])
        while remaining:
            for candidate in remaining:
                penalty = 0.0
                for earlier in selected:
                    if candidate["_sort"]["provider"] == earlier["_sort"]["provider"]:
                        penalty += penalty_points
                    if candidate["_sort"]["topic"] == earlier["_sort"]["topic"]:
                        penalty += penalty_points
                    if set(candidate["_sort"]["question_types"]) & set(
                        earlier["_sort"]["question_types"]
                    ):
                        penalty += penalty_points
                candidate["diversity_penalty"] = round(penalty, 3)
                candidate["score"] = round(max(0.0, candidate["base_score"] - penalty), 3)
            remaining.sort(key=self._candidate_sort_key)
            chosen = remaining.pop(0)
            selected.append(chosen)
        for rank, candidate in enumerate(selected, start=1):
            candidate["rank"] = rank
            candidate.pop("_sort", None)
        return selected

    @staticmethod
    def _candidate_sort_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
        sort_data = candidate["_sort"]
        return (
            -float(candidate["score"]),
            -int(sort_data["coverage_confidence"]),
            bool(sort_data["attempted"]),
            -float(sort_data["length_fit"]),
            sort_data["last_recommended_at"],
            candidate["question_key"],
        )

    @staticmethod
    def _parse_datetime(value: str) -> datetime:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

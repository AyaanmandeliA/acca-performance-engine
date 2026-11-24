"""Part of ../../PROJECT.md — plain local CLI for all synthetic profiles."""

from __future__ import annotations

import argparse
import json
from typing import Any

from .configuration import load_config, load_fixture_bundle
from .recommendation_engine import RecommendationEngine
from .weakness_engine import WeaknessEngine


def build_demo_results(student_id: str | None = None, limit: int = 2) -> list[dict[str, Any]]:
    config = load_config()
    bundle = load_fixture_bundle()
    weakness_engine = WeaknessEngine(config)
    recommendation_engine = RecommendationEngine(config)
    profiles = bundle["profiles"]
    if student_id:
        profiles = [profile for profile in profiles if profile["profile_id"] == student_id]
        if not profiles:
            raise ValueError(f"Unknown synthetic student: {student_id}")
    output = []
    for profile in profiles:
        weakness_result = weakness_engine.analyze_profile(profile)
        recommendation_result = recommendation_engine.rank_questions(
            profile,
            weakness_result,
            bundle["synthetic_question_catalogue"],
            limit=limit,
            as_of="2026-10-02T00:00:00Z",
        )
        output.append(
            {
                "profile": profile,
                "weakness_result": weakness_result,
                "recommendation_result": recommendation_result,
            }
        )
    return output


def _format_text(results: list[dict[str, Any]], show_components: bool) -> str:
    lines: list[str] = []
    for result in results:
        profile = result["profile"]
        weakness_result = result["weakness_result"]
        recommendation_result = result["recommendation_result"]
        lines.extend(
            [
                "=" * 78,
                f"STUDENT: {profile['profile_id']}",
                f"Current profile: {profile['paper']} — {profile.get('description', '')}",
            ]
        )
        strengths = weakness_result.get("strengths", [])
        if strengths:
            lines.append(
                "Preserved strengths: "
                + ", ".join(
                    f"{item['tag']} ({item['occurrences']}x)" for item in strengths[:4]
                )
            )

        lines.append("")
        lines.append("TOP WEAKNESSES")
        weakness_profiles = weakness_result.get("weakness_profiles", [])
        if not weakness_profiles:
            lines.append("- No weakness signal has enough evidence for a state.")
        for item in weakness_profiles[:5]:
            state = item["state"] or "INSUFFICIENT_SIGNAL"
            qualifiers = []
            if item["inactive_observation"]:
                qualifiers.append("inactive one-off")
            if item["reactivated"]:
                qualifiers.append("reactivated")
            suffix = f" [{' / '.join(qualifiers)}]" if qualifiers else ""
            lines.append(
                f"- {item['tag']} — {state}{suffix}; confidence "
                f"{item['confidence'] or 'NONE'}; priority {item['priority_score']:.1f}"
            )
            counts = item["counts"]
            lines.append(
                "  Evidence: "
                f"{counts['hits']} hit(s), {counts['weak_signals']} weak signal(s), "
                f"{counts['clean']} clean, {counts['neutral']} neutral; "
                f"weighted prevalence {item['weighted_prevalence']:.3f}."
            )
            lines.append(f"  Trend: {item['trend']}")
            if item["current_reason_codes"]:
                lines.append(
                    "  Rule trace: " + ", ".join(item["current_reason_codes"])
                )

        lines.append("")
        lines.append(
            f"RECOMMENDED NEXT PRACTICE — mode {recommendation_result['mode']}"
        )
        recommendations = recommendation_result.get("recommendations", [])
        if not recommendations:
            lines.append("No eligible question. Review the exclusion audit in JSON output.")
        for recommendation in recommendations:
            lines.append(
                f"{recommendation['rank']}. {recommendation['display_locator']} "
                f"(score {recommendation['score']:.1f})"
            )
            target_tags = [item["tag"] for item in recommendation["targets"]]
            if target_tags:
                target_text = ", ".join(target_tags)
            elif recommendation_result["mode"] == "BASELINE":
                target_text = "Baseline evidence"
            else:
                target_text = "No direct target match"
            lines.append(
                "   Targets: " + target_text
            )
            lines.append("   Why: " + " ".join(recommendation["why"]))
            metadata = recommendation["metadata"]
            lines.append(
                f"   Metadata: {metadata['topic']}; {metadata['difficulty']}; "
                f"{metadata['marks']} marks; "
                f"~{metadata['estimated_completion_minutes']} minutes."
            )
            if show_components:
                components = recommendation["score_components"]
                formatted = ", ".join(
                    f"{name}={value:.1f}" for name, value in components.items()
                )
                lines.append(
                    f"   Score trace: {formatted}; "
                    f"diversity_penalty={recommendation['diversity_penalty']:.1f}"
                )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the deterministic ACCA engines against synthetic profiles."
    )
    parser.add_argument("--student", help="Run one synthetic profile ID")
    parser.add_argument(
        "--limit", type=int, default=2, help="Recommendations per student (default: 2)"
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit full machine-readable output"
    )
    parser.add_argument(
        "--show-components",
        action="store_true",
        help="Show recommendation score components",
    )
    args = parser.parse_args(argv)
    try:
        results = build_demo_results(student_id=args.student, limit=args.limit)
    except ValueError as exc:
        parser.error(str(exc))
    if args.json:
        serialisable = [
            {
                "student_id": item["profile"]["profile_id"],
                "weakness_result": item["weakness_result"],
                "recommendation_result": item["recommendation_result"],
            }
            for item in results
        ]
        print(json.dumps(serialisable, indent=2, sort_keys=True))
    else:
        print(_format_text(results, show_components=args.show_components), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

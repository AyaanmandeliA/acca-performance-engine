"""Part of ../../PROJECT.md — deterministic ACCA Performance Engine prototype."""

from .configuration import load_config, load_fixture_bundle
from .credit_ledger import CreditLedgerEngine, load_credit_ledger_config
from .diagnostic_adapter import (
    DeterministicDownstreamPipeline,
    DiagnosticToAttemptAdapter,
)
from .paper_rules import PaperRuleRegistry
from .recommendation_engine import RecommendationEngine
from .weakness_engine import WeaknessEngine

__all__ = [
    "CreditLedgerEngine",
    "DeterministicDownstreamPipeline",
    "DiagnosticToAttemptAdapter",
    "PaperRuleRegistry",
    "RecommendationEngine",
    "WeaknessEngine",
    "load_config",
    "load_credit_ledger_config",
    "load_fixture_bundle",
]

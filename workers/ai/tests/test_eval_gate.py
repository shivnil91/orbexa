"""CI fails when the synthetic retrieval scores fall."""

from __future__ import annotations

import json
from pathlib import Path

from orbexa_ai.retrieval import measure_golden_suite

_BASELINE = (
    Path(__file__).resolve().parents[3] / "fixtures" / "hospital-beds" / "eval" / "baseline.json"
)


def test_measure_golden_suite_does_not_drop() -> None:
    baseline = json.loads(_BASELINE.read_text(encoding="utf-8"))
    measured = measure_golden_suite()
    for key, floor in baseline["retrieval"].items():
        assert measured[key] + 1e-9 >= float(floor), key
    assert "certification" not in measure_golden_suite.__doc__.lower() or "not a certification" in (
        measure_golden_suite.__doc__ or ""
    ).lower()

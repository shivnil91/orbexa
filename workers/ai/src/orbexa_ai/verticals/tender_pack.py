"""Tender writing is the first vertical pack. The workflow list matches the seeded SQL revision."""

from __future__ import annotations

from typing import TypedDict


class VerticalDefinition(TypedDict):
    code: str
    workflow: tuple[str, ...]
    rubric: tuple[str, ...]


TENDER_WRITING: VerticalDefinition = {
    "code": "tender_writing",
    "workflow": ("extract", "matrix", "draft", "ground"),
    "rubric": ("grounded_claim", "missing_evidence"),
}

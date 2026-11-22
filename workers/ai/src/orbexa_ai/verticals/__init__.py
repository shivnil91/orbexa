"""Vertical packs. The core runner does not know about a specialist."""

from orbexa_ai.verticals.runner import run_vertical
from orbexa_ai.verticals.tender_pack import TENDER_WRITING

__all__ = ["TENDER_WRITING", "run_vertical"]

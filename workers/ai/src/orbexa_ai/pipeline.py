"""Tender stage order comes from the tender-writing pack. Document text does not choose it."""

from langgraph.graph.state import CompiledStateGraph

from orbexa_ai.verticals.runner import WorkflowState, compile_workflow, run_vertical
from orbexa_ai.verticals.tender_pack import TENDER_WRITING


def build_tender_graph() -> CompiledStateGraph[WorkflowState]:
    return compile_workflow(TENDER_WRITING["workflow"])


def run_tender_skeleton(document_text: str) -> list[str]:
    return run_vertical(TENDER_WRITING, document_text)

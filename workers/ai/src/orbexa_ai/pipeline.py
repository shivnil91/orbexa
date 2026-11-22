"""Fixed tender graph. Document text never chooses the next node."""

from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph


class TenderState(TypedDict):
    document_text: str
    stages: list[str]


def _advance(state: TenderState, stage: str) -> TenderState:
    return {
        "document_text": state["document_text"],
        "stages": [*state["stages"], stage],
    }


def extract_requirements(state: TenderState) -> TenderState:
    return _advance(state, "extract")


def build_matrix(state: TenderState) -> TenderState:
    return _advance(state, "matrix")


def draft_response(state: TenderState) -> TenderState:
    return _advance(state, "draft")


def flag_unsupported(state: TenderState) -> TenderState:
    return _advance(state, "ground")


def build_tender_graph() -> CompiledStateGraph[TenderState]:
    graph: StateGraph[TenderState] = StateGraph(TenderState)
    graph.add_node("extract", extract_requirements)
    graph.add_node("matrix", build_matrix)
    graph.add_node("draft", draft_response)
    graph.add_node("ground", flag_unsupported)
    graph.add_edge(START, "extract")
    graph.add_edge("extract", "matrix")
    graph.add_edge("matrix", "draft")
    graph.add_edge("draft", "ground")
    graph.add_edge("ground", END)
    return graph.compile()


def run_tender_skeleton(document_text: str) -> list[str]:
    result = build_tender_graph().invoke({"document_text": document_text, "stages": []})
    stages = result["stages"]
    if not isinstance(stages, list):
        raise TypeError("graph stages must be a list")
    return [str(stage) for stage in stages]

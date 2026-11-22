"""Run the stages declared by a vertical. Document text cannot add or skip a stage."""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from orbexa_ai.verticals.tender_pack import VerticalDefinition


class WorkflowState(TypedDict):
    document_text: str
    stages: list[str]


def _step(state: WorkflowState, stage: str) -> WorkflowState:
    return {
        "document_text": state["document_text"],
        "stages": [*state["stages"], stage],
    }


def compile_workflow(stages: tuple[str, ...]) -> CompiledStateGraph[WorkflowState]:
    if len(stages) == 0:
        raise ValueError("workflow is empty")
    graph: StateGraph[WorkflowState] = StateGraph(WorkflowState)
    for stage in stages:
        graph.add_node(stage, lambda state, stage=stage: _step(state, stage))
    graph.add_edge(START, stages[0])
    for left, right in zip(stages, stages[1:]):
        graph.add_edge(left, right)
    graph.add_edge(stages[-1], END)
    return graph.compile()


def run_vertical(definition: VerticalDefinition, document_text: str) -> list[str]:
    result = compile_workflow(definition["workflow"]).invoke(
        {"document_text": document_text, "stages": []}
    )
    stages = result["stages"]
    if not isinstance(stages, list):
        raise TypeError("graph stages must be a list")
    return [str(stage) for stage in stages]

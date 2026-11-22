"""Model gateway. The fixture provider is deterministic. The others do not call out."""

from __future__ import annotations

import os
from typing import Protocol

from orbexa_ai.ingest import Chunk

LIVE_PROVIDERS = ("anthropic", "openai", "xai")
KEY_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "xai": "XAI_API_KEY",
}


class ProviderNotConfiguredError(RuntimeError):
    """A live provider was selected and this process must not call it."""


class LlmGateway(Protocol):
    def complete(self, task: str, chunks: list[Chunk]) -> dict[str, object]:
        """Return structured JSON for one graph task."""


class FixtureGateway:
    """Reads the fictional pack. It does not invent certificates or quantities."""

    def complete(self, task: str, chunks: list[Chunk]) -> dict[str, object]:
        if task == "extract":
            return {"requirements": _requirements(chunks)}
        if task == "matrix":
            return {"rows": _matrix(chunks)}
        if task == "draft":
            return {"paragraphs": _paragraphs(chunks), "claims": _claims(chunks)}
        raise ValueError(f"unknown task: {task}")


class BlockedLiveGateway:
    def __init__(self, name: str) -> None:
        self.name = name

    def complete(self, task: str, chunks: list[Chunk]) -> dict[str, object]:
        raise ProviderNotConfiguredError(
            f"{self.name} is a stub. No model request is sent. task={task} chunks={len(chunks)}"
        )


def gateway_from_env() -> LlmGateway:
    name = os.environ.get("LLM_PROVIDER", "fixture")
    if name == "fixture":
        return FixtureGateway()
    if name in LIVE_PROVIDERS:
        if not os.environ.get(KEY_ENV[name]):
            raise ProviderNotConfiguredError(f"{name} has no API key in this environment")
        return BlockedLiveGateway(name)
    raise ProviderNotConfiguredError(f"unknown LLM provider: {name}")


def _requirements(chunks: list[Chunk]) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    for index, chunk in enumerate(chunks):
        for line in chunk.body.splitlines():
            kind = None
            text = ""
            if line.startswith("REQUIREMENT:"):
                kind = "mandatory"
                text = line.removeprefix("REQUIREMENT:").strip()
            elif line.startswith("CRITERION:"):
                kind = "evaluation_criterion"
                text = line.removeprefix("CRITERION:").strip()
            if kind and text:
                found.append({"kind": kind, "body": text, "chunk_index": index})
    return found


def _supplier_text(chunks: list[Chunk]) -> str:
    return "\n".join(chunk.body for chunk in chunks if chunk.document_name == "supplier-note.docx")


def _matrix(chunks: list[Chunk]) -> list[dict[str, object]]:
    supplier = _supplier_text(chunks)
    rows: list[dict[str, object]] = []
    for requirement in _requirements(chunks):
        body = str(requirement["body"]).lower()
        if "certificate" in body or "how many" in body or "deliver" in body or not supplier:
            rows.append(
                {**requirement, "missing_evidence": True, "response_status": "not_addressed"}
            )
        else:
            rows.append(
                {**requirement, "missing_evidence": False, "response_status": "partial"}
            )
    return rows


def _supplier_width_index(chunks: list[Chunk]) -> int | None:
    for index, chunk in enumerate(chunks):
        if chunk.document_name == "supplier-note.docx" and "950 mm" in chunk.body:
            return index
    return None


def _paragraphs(chunks: list[Chunk]) -> list[str]:
    paragraphs = [
        "This draft uses only the fictional supplier note and the fictional invitation.",
    ]
    width = _supplier_width_index(chunks)
    if width is not None:
        paragraphs.append("The supplier note records a bed width of 950 mm.")
    paragraphs.append(
        "The invitation asks for a delivery quantity and a regulatory certificate. "
        "Neither is in the supplier note, so this draft does not state them."
    )
    return paragraphs


def _claims(chunks: list[Chunk]) -> list[dict[str, object]]:
    claims: list[dict[str, object]] = []
    width = _supplier_width_index(chunks)
    if width is not None:
        claims.append(
            {
                "body": "The supplier note records a bed width of 950 mm.",
                "support_status": "supported",
                "chunk_indexes": [width],
                "quote": "950 mm",
            }
        )
    claims.append(
        {
            "body": (
                "A regulatory certificate was requested and is not in the supplier note, "
                "so no certificate is asserted."
            ),
            "support_status": "missing_evidence",
            "chunk_indexes": [],
            "quote": "",
        }
    )
    claims.append(
        {
            "body": "A delivery quantity was requested and is not in the supplier note.",
            "support_status": "missing_evidence",
            "chunk_indexes": [],
            "quote": "",
        }
    )
    return claims

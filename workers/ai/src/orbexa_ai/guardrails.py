"""Prompt-injection signals and the per-version tool allow-list.

The document fence still wraps untrusted text. These checks do not claim the
model cannot be confused, and they do not store document text.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from orbexa_ai.ingest import Chunk
from orbexa_ai.injection import assert_draft_has_no_foreign_tenant
from orbexa_ai.ops_store import GuardrailEvent, OpsStore, ToolCallRecord
from orbexa_ai.output_schema import OutputRejected
from orbexa_ai.safety import claim_is_admissible

# Patterns that show up in the hostile fixture set. A match is a count, not a copy.
_INJECTION = (
    re.compile(r"ignore (all|any|prior|previous) instructions", re.IGNORECASE),
    re.compile(r"you are now", re.IGNORECASE),
    re.compile(r"</untrusted_document>", re.IGNORECASE),
    re.compile(r"(?m)^\s*system\s*:", re.IGNORECASE),
    re.compile(r"skip grounding", re.IGNORECASE),
)

# side_effect mirrors tool_catalog. A true value cannot be dispatched.
CATALOG: dict[str, bool] = {
    "read_chunk": False,
    "write_artifact": False,
    "flag_claim": False,
}


class ToolRejected(RuntimeError):
    """The tool is outside the version allow-list or has a side effect."""


def injection_finding_count(chunks: list[Chunk]) -> int:
    count = 0
    for chunk in chunks:
        if any(pattern.search(chunk.body) for pattern in _INJECTION):
            count += 1
    return count


def screen_chunks(store: OpsStore, tenant_id: str, chunks: list[Chunk]) -> int:
    count = injection_finding_count(chunks)
    if count:
        store.record_guardrail(
            GuardrailEvent(tenant_id=tenant_id, kind="prompt_injection", count=count)
        )
    return count


def assert_output_safe(result: dict[str, object], own_tenant_id: str | None) -> None:
    """Reject a completion that carries another tenant id or a fence escape."""
    assert_draft_has_no_foreign_tenant(result, own_tenant_id)
    serialized = json.dumps(result)
    if "</untrusted_document>" in serialized:
        raise OutputRejected("model output tried to close the document fence")


def _stored_tool_code(tool_code: str) -> str:
    if re.fullmatch(r"[a-z_]{1,64}", tool_code):
        return tool_code
    return "unknown"


def dispatch_tool(
    store: OpsStore,
    *,
    agent_version_id: str,
    tenant_id: str,
    job_id: str,
    run_id: str,
    tool_code: str,
    args: dict[str, Any],
    chunks: list[Chunk] | None = None,
    catalog: dict[str, bool] | None = None,
) -> dict[str, object]:
    """Run one catalog tool, or reject it before any side effect."""
    del agent_version_id
    known = catalog or CATALOG
    args_hash = hashlib.sha256(json.dumps(args, sort_keys=True).encode("utf-8")).hexdigest()
    raw_allowed: object = getattr(store, "allowed_tools", frozenset())
    allowed = raw_allowed if isinstance(raw_allowed, (set, frozenset)) else set()

    def reject(status: str = "rejected") -> ToolRejected:
        store.insert_tool_call(
            ToolCallRecord(
                tenant_id=tenant_id,
                job_id=job_id,
                run_id=run_id,
                tool_code=_stored_tool_code(tool_code),
                status=status,
                args_hash=args_hash,
                result_hash="",
            )
        )
        return ToolRejected(f"tool {tool_code} is not allowed")

    if tool_code not in known:
        raise reject()
    if known[tool_code]:
        raise reject()
    if tool_code not in allowed:
        raise reject()

    if tool_code == "read_chunk":
        index = args.get("chunk_index")
        if not isinstance(index, int) or isinstance(index, bool):
            raise reject()
        rows = chunks or []
        if index < 0 or index >= len(rows):
            raise reject()
        chunk = rows[index]
        result: dict[str, object] = {
            "document_name": chunk.document_name,
            "locator_kind": chunk.locator_kind,
            "page": chunk.page,
        }
    elif tool_code == "write_artifact":
        result = {"accepted": True}
    elif tool_code == "flag_claim":
        status = str(args.get("support_status", ""))
        citation_count = args.get("citation_count", 0)
        if not isinstance(citation_count, int) or isinstance(citation_count, bool):
            citation_count = 0
        if not claim_is_admissible(status, citation_count):
            raise reject()
        result = {"support_status": status}
    else:
        raise reject()

    result_hash = hashlib.sha256(json.dumps(result, sort_keys=True).encode("utf-8")).hexdigest()
    store.insert_tool_call(
        ToolCallRecord(
            tenant_id=tenant_id,
            job_id=job_id,
            run_id=run_id,
            tool_code=_stored_tool_code(tool_code),
            status="succeeded",
            args_hash=args_hash,
            result_hash=result_hash,
        )
    )
    return result

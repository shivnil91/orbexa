"""Run the fictional tender job through the fixture gateway."""

from __future__ import annotations

import base64
from dataclasses import asdict

from orbexa_ai.deliverables import render_docx, render_xlsx
from orbexa_ai.gateway import LlmGateway, gateway_from_env
from orbexa_ai.ingest import Chunk, chunk_document, scan_upload
from orbexa_ai.injection import finalize_draft
from orbexa_ai.workflow import WorkflowState

MEDIA = {
    "invitation.pdf": "application/pdf",
    "specification.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "schedule.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "supplier-note.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def run_tender_job(
    files: dict[str, bytes],
    *,
    service_level: str,
    gateway: LlmGateway | None = None,
    state: WorkflowState | None = None,
) -> tuple[WorkflowState, dict[str, object]]:
    chosen = gateway or gateway_from_env()
    workflow = state or WorkflowState()

    def ingest() -> list[dict[str, object]]:
        chunks: list[Chunk] = []
        scans: list[dict[str, str]] = []
        for name, data in files.items():
            media = MEDIA[name]
            status = scan_upload(name, media, data)
            scans.append({"filename": name, "status": status})
            if status != "clean":
                continue
            chunks.extend(chunk_document(name, media, data))
        return [{"scan": scans, "chunks": [asdict(chunk) for chunk in chunks]}]

    ingested = workflow.activity("ingest", ingest)[0]
    raw_chunks = ingested["chunks"]
    if not isinstance(raw_chunks, list):
        raise TypeError("chunks")
    chunks = [Chunk(**row) for row in raw_chunks]

    requirements = workflow.activity("extract", lambda: chosen.complete("extract", chunks))
    matrix = workflow.activity("matrix", lambda: chosen.complete("matrix", chunks))
    draft = finalize_draft(workflow.activity("draft", lambda: chosen.complete("draft", chunks)))

    def export() -> dict[str, str]:
        paragraphs = draft["paragraphs"]
        rows = matrix["rows"]
        if not isinstance(paragraphs, list) or not isinstance(rows, list):
            raise TypeError("draft")
        docx_bytes = render_docx([str(item) for item in paragraphs])
        xlsx_bytes = render_xlsx([dict(item) for item in rows])
        return {
            "docx_base64": base64.b64encode(docx_bytes).decode(),
            "xlsx_base64": base64.b64encode(xlsx_bytes).decode(),
        }

    # Export is produced before the human gate so the reviewer can read it.
    # Release to the buyer waits on acceptance in the API.
    exported = workflow.activity("export", export)
    if service_level == "autonomous":
        workflow.status = "waiting_for_buyer"
    else:
        workflow.status = "waiting_for_expert"
    return workflow, {
        "requirements": requirements["requirements"],
        "matrix": matrix["rows"],
        "paragraphs": draft["paragraphs"],
        "claims": draft["claims"],
        "chunks": [asdict(chunk) for chunk in chunks],
        "deliverables": exported,
        "status": workflow.status,
    }

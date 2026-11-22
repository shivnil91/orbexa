import os
from pathlib import Path

import pytest

from orbexa_ai.documents import UnsupportedUploadError, classify_upload
from orbexa_ai.gateway import ProviderNotConfiguredError, gateway_from_env
from orbexa_ai.ingest import chunk_document, scan_upload
from orbexa_ai.job import run_tender_job
from orbexa_ai.office import read_docx_paragraphs, read_xlsx_rows
from orbexa_ai.pack import write_pack
from orbexa_ai.workflow import WorkflowState

ROOT = Path(__file__).resolve().parents[3]
PACK = ROOT / "fixtures" / "hospital-beds"


def files() -> dict[str, bytes]:
    write_pack(PACK)
    loaded: dict[str, bytes] = {}
    for path in sorted(PACK.iterdir()):
        if path.is_file() and path.suffix != ".md":
            loaded[path.name] = path.read_bytes()
    return loaded


def test_given_an_exe_when_uploaded_then_it_is_rejected() -> None:
    with pytest.raises(UnsupportedUploadError):
        classify_upload("tender.exe", "application/pdf")
    assert scan_upload("tender.pdf", "application/pdf", b"MZ fake") == "rejected"


def test_given_the_fictional_pack_when_ingested_then_chunks_have_locators() -> None:
    loaded = files()
    pdf = chunk_document("invitation.pdf", "application/pdf", loaded["invitation.pdf"])
    docx = chunk_document(
        "specification.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        loaded["specification.docx"],
    )
    sheet = chunk_document(
        "schedule.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        loaded["schedule.xlsx"],
    )
    assert pdf[0].locator_kind == "page" and pdf[0].page == 1
    assert any(chunk.paragraph_path for chunk in docx)
    assert any(chunk.cell_range == "A2:C2" for chunk in sheet)
    assert scan_upload("invitation.pdf", "application/pdf", loaded["invitation.pdf"]) == "clean"


def test_given_the_invitation_when_extracted_then_certificate_is_missing_evidence() -> None:
    _state, result = run_tender_job(files(), service_level="expert_verified")
    requirements = result["requirements"]
    assert isinstance(requirements, list)
    bodies = " ".join(str(item["body"]) for item in requirements)
    assert "how many hospital beds" in bodies
    assert "regulatory certificate" in bodies
    matrix = result["matrix"]
    assert isinstance(matrix, list)
    certificate = next(row for row in matrix if "certificate" in str(row["body"]))
    assert certificate["missing_evidence"] is True
    paragraphs = " ".join(str(item) for item in result["paragraphs"])  # type: ignore[arg-type]
    assert "ISO" not in paragraphs
    assert "TGA" not in paragraphs
    assert "950 mm" in paragraphs
    claims = result["claims"]
    assert isinstance(claims, list)
    supported = [claim for claim in claims if claim["support_status"] == "supported"]
    assert supported
    assert all(claim["chunk_indexes"] for claim in supported)


def test_given_expert_verified_when_the_worker_finishes_then_it_waits_for_moishin() -> None:
    state, result = run_tender_job(files(), service_level="expert_verified")
    assert result["status"] == "waiting_for_expert"
    assert state.status == "waiting_for_expert"


def test_given_autonomous_when_the_worker_finishes_then_no_expert_gate() -> None:
    _state, result = run_tender_job(files(), service_level="autonomous")
    assert result["status"] == "waiting_for_buyer"


def test_resume_does_not_repeat_a_completed_activity() -> None:
    loaded = files()
    state = WorkflowState()
    run_tender_job(loaded, service_level="expert_verified", state=state)
    first = dict(state.calls)
    run_tender_job(loaded, service_level="expert_verified", state=state)
    assert state.calls == first


def test_deliverables_are_editable() -> None:
    _state, result = run_tender_job(files(), service_level="expert_verified")
    import base64

    deliverables = result["deliverables"]
    assert isinstance(deliverables, dict)
    docx = base64.b64decode(str(deliverables["docx_base64"]))
    xlsx = base64.b64decode(str(deliverables["xlsx_base64"]))
    paragraphs = read_docx_paragraphs(docx)
    paragraphs[0] = "Rahul edited this paragraph."
    from orbexa_ai.office import build_docx, build_xlsx

    edited = build_docx(paragraphs)
    assert "Rahul edited this paragraph." in " ".join(read_docx_paragraphs(edited))
    rows = read_xlsx_rows(xlsx)
    assert any("regulatory certificate" in row["text"] for row in rows)
    rebuilt = build_xlsx("Compliance", [["Requirement", "Status"], ["edited row", "missing"]])
    assert "edited row" in read_xlsx_rows(rebuilt)[1]["text"]


def test_live_providers_are_not_called(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ProviderNotConfiguredError):
        gateway_from_env()
    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    gateway = gateway_from_env()
    with pytest.raises(ProviderNotConfiguredError):
        gateway.complete("extract", [])
    assert os.environ["LLM_PROVIDER"] == "openai"

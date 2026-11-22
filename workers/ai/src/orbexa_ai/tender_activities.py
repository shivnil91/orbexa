"""Idempotent Temporal activities for one tender job.

Each activity writes its result under store_dir before it returns. A retry,
including one after the worker is killed, reads that file and does not repeat
the work.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from temporalio import activity

from orbexa_ai.deliverables import render_docx, render_xlsx
from orbexa_ai.gateway import gateway_from_env
from orbexa_ai.ingest import Chunk, chunk_document, scan_upload
from orbexa_ai.injection import finalize_draft
from orbexa_ai.job import MEDIA


def _store(payload: dict[str, str]) -> Path:
    directory = Path(payload["store_dir"])
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _read(store: Path, name: str) -> dict[str, Any] | None:
    path = store / f"{name}.json"
    if not path.exists():
        return None
    loaded = json.loads(path.read_text())
    if not isinstance(loaded, dict):
        raise TypeError(name)
    return loaded


def _write(store: Path, name: str, value: Mapping[str, Any]) -> dict[str, Any]:
    written = dict(value)
    (store / f"{name}.json").write_text(json.dumps(written))
    return written


def _bump(store: Path, name: str) -> None:
    path = store / name
    current = int(path.read_text()) if path.exists() else 0
    path.write_text(str(current + 1))


def _files(payload: dict[str, str]) -> dict[str, bytes]:
    pack = Path(payload["pack_dir"])
    loaded: dict[str, bytes] = {}
    for name in MEDIA:
        loaded[name] = (pack / name).read_bytes()
    return loaded


def _chunks_from_cache(raw: list[object]) -> list[Chunk]:
    chunks: list[Chunk] = []
    for row in raw:
        if not isinstance(row, dict):
            raise TypeError("chunk")
        chunks.append(Chunk(**row))
    return chunks


def ensure_ingest(payload: dict[str, str]) -> list[Chunk]:
    store = _store(payload)
    cached = _read(store, "ingest")
    if cached is not None:
        raw = cached["chunks"]
        if not isinstance(raw, list):
            raise TypeError("chunks")
        return _chunks_from_cache(raw)
    chunks: list[Chunk] = []
    for name, data in _files(payload).items():
        media = MEDIA[name]
        if scan_upload(name, media, data) != "clean":
            continue
        chunks.extend(chunk_document(name, media, data))
    _write(store, "ingest", {"chunks": [chunk.__dict__ for chunk in chunks]})
    return chunks


@activity.defn
async def extract_activity(payload: dict[str, str]) -> dict[str, Any]:
    store = _store(payload)
    with (store / "extract-attempts").open("a", encoding="utf-8") as handle:
        handle.write(f"{os.getpid()}\n")
    cached = _read(store, "extract")
    if cached is not None:
        return cached
    chunks = ensure_ingest(payload)
    result = gateway_from_env().complete("extract", chunks)
    result["chunks"] = [chunk.__dict__ for chunk in chunks]
    _bump(store, "extract-computes")
    saved = _write(store, "extract", result)
    kill = store / "kill-extract"
    if kill.exists():
        # The extract result is already on disk. Stay inside this attempt so
        # the test can kill the process before Temporal records success.
        # The next attempt reads extract.json and does not recompute.
        activity.heartbeat("persisted")
        (store / "extract-holding").write_text("1", encoding="utf-8")
        kill.unlink()
        await asyncio.Event().wait()
    return saved


@activity.defn
async def matrix_activity(payload: dict[str, str]) -> dict[str, Any]:
    store = _store(payload)
    cached = _read(store, "matrix")
    if cached is not None:
        return cached
    chunks = ensure_ingest(payload)
    return _write(store, "matrix", gateway_from_env().complete("matrix", chunks))


@activity.defn
async def draft_activity(payload: dict[str, str]) -> dict[str, Any]:
    store = _store(payload)
    cached = _read(store, "draft")
    if cached is not None:
        return cached
    chunks = ensure_ingest(payload)
    draft = finalize_draft(gateway_from_env().complete("draft", chunks), payload.get("tenant_id"))
    return _write(store, "draft", draft)


@activity.defn
async def deliver_activity(payload: dict[str, str]) -> dict[str, str]:
    import base64

    store = _store(payload)
    cached = _read(store, "deliver")
    if cached is not None:
        return {key: str(value) for key, value in cached.items()}
    chunks = ensure_ingest(payload)
    draft = _read(store, "draft")
    matrix = _read(store, "matrix")
    if draft is None or matrix is None:
        raise RuntimeError("draft and matrix must exist before deliver")
    paragraphs = draft["paragraphs"]
    rows = matrix["rows"]
    if not isinstance(paragraphs, list) or not isinstance(rows, list):
        raise TypeError("draft")
    enriched: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise TypeError("row")
        index = int(str(row["chunk_index"]))
        chunk = chunks[index]
        source = _locator(chunk)
        enriched.append({**row, "source": source})
    docx_bytes = render_docx([str(item) for item in paragraphs])
    xlsx_bytes = render_xlsx(enriched)
    docx_path = store / "response.docx"
    xlsx_path = store / "matrix.xlsx"
    docx_path.write_bytes(docx_bytes)
    xlsx_path.write_bytes(xlsx_bytes)
    saved = {
        "docx_base64": base64.b64encode(docx_bytes).decode(),
        "xlsx_base64": base64.b64encode(xlsx_bytes).decode(),
        "docx_path": str(docx_path),
        "xlsx_path": str(xlsx_path),
    }
    _write(store, "deliver", saved)
    return saved


def _locator(chunk: Chunk) -> str:
    if chunk.locator_kind == "page":
        return f"{chunk.document_name} page {chunk.page}"
    if chunk.locator_kind == "cell_range":
        return f"{chunk.document_name} {chunk.sheet}!{chunk.cell_range}"
    return f"{chunk.document_name} {chunk.paragraph_path}"

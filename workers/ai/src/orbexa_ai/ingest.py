"""Turn PDF, DOCX, and XLSX bytes into citable chunks. No network."""

from __future__ import annotations

from dataclasses import dataclass

from orbexa_ai.documents import UnsupportedUploadError, classify_upload
from orbexa_ai.office import read_docx_paragraphs, read_pdf_pages, read_xlsx_rows


@dataclass(frozen=True)
class Chunk:
    document_name: str
    media_type: str
    kind: str
    body: str
    locator_kind: str
    page: int | None = None
    sheet: str | None = None
    cell_range: str | None = None
    paragraph_path: str | None = None


def scan_upload(filename: str, media_type: str, data: bytes) -> str:
    try:
        classify_upload(filename, media_type)
    except UnsupportedUploadError:
        return "rejected"
    if data.startswith(b"MZ") or data.startswith(b"\x7fELF"):
        return "rejected"
    return "clean"


def chunk_document(filename: str, media_type: str, data: bytes) -> list[Chunk]:
    if scan_upload(filename, media_type, data) != "clean":
        raise UnsupportedUploadError(filename)
    if media_type == "application/pdf":
        return [
            Chunk(
                document_name=filename,
                media_type=media_type,
                kind="prose",
                body=text.strip(),
                locator_kind="page",
                page=number,
            )
            for number, text in enumerate(read_pdf_pages(data), start=1)
            if text.strip()
        ]
    if media_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        chunks: list[Chunk] = []
        for index, text in enumerate(read_docx_paragraphs(data)):
            if not text.strip():
                continue
            chunks.append(
                Chunk(
                    document_name=filename,
                    media_type=media_type,
                    kind="prose",
                    body=text.strip(),
                    locator_kind="paragraph",
                    paragraph_path=f"paragraph/{index}",
                )
            )
        return chunks
    rows = read_xlsx_rows(data)
    return [
        Chunk(
            document_name=filename,
            media_type=media_type,
            kind="table",
            body=str(row["text"]),
            locator_kind="cell_range",
            sheet=str(row["sheet"]),
            cell_range=str(row["cell_range"]),
        )
        for row in rows
    ]

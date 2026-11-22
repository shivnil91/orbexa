"""Editable Word and Excel outputs. The bytes are the bid package."""

from __future__ import annotations

from orbexa_ai.office import build_docx, build_xlsx


def render_docx(paragraphs: list[str]) -> bytes:
    return build_docx(paragraphs)


def render_xlsx(rows: list[dict[str, object]]) -> bytes:
    table = [["Requirement", "Status", "Missing evidence", "Source"]]
    for row in rows:
        source = row.get("source", row.get("chunk_index", ""))
        table.append(
            [
                str(row["body"]),
                str(row["response_status"]),
                "yes" if row["missing_evidence"] else "no",
                str(source),
            ]
        )
    return build_xlsx("Compliance", table)

"""Read and write the three tender file types. Callers pass already-scanned bytes."""

from __future__ import annotations

from io import BytesIO
from typing import Any

from docx import Document
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader


def build_pdf(lines: list[str]) -> bytes:
    commands = ["BT", "/F1 11 Tf"]
    y = 740
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"1 0 0 1 50 {y} Tm ({safe}) Tj")
        y -= 16
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1", errors="replace")
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        b"4 0 obj << /Length "
        + str(len(stream)).encode()
        + b" >> stream\n"
        + stream
        + b"\nendstream endobj\n",
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    body = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(body))
        body.extend(obj)
    xref_at = len(body)
    body.extend(f"xref\n0 {len(offsets)}\n".encode())
    body.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        body.extend(f"{offset:010d} 00000 n \n".encode())
    body.extend(
        f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    )
    return bytes(body)


def read_pdf_pages(data: bytes) -> list[str]:
    reader = PdfReader(BytesIO(data))
    return [(page.extract_text() or "") for page in reader.pages]


def build_docx(lines: list[str]) -> bytes:
    document = Document()
    for line in lines:
        document.add_paragraph(line)
    buffer = BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def read_docx_paragraphs(data: bytes) -> list[str]:
    document = Document(BytesIO(data))
    return [paragraph.text for paragraph in document.paragraphs]


def build_xlsx(sheet: str, rows: list[list[str]]) -> bytes:
    book = Workbook()
    grid = book.active
    grid.title = sheet
    for row in rows:
        grid.append(row)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def read_xlsx_rows(data: bytes) -> list[dict[str, Any]]:
    book = load_workbook(BytesIO(data), data_only=True)
    found: list[dict[str, Any]] = []
    for sheet in book.worksheets:
        for index, row in enumerate(sheet.iter_rows(values_only=True), start=1):
            values = ["" if cell is None else str(cell) for cell in row]
            if not any(values):
                continue
            last_col = len(values)
            found.append(
                {
                    "sheet": sheet.title,
                    "cell_range": f"A{index}:{_column_name(last_col)}{index}",
                    "text": " | ".join(values),
                    "row_number": index,
                }
            )
    return found


def _column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name

"""Clearly fictional hospital-bed tender files. Nothing here is a real bid."""

from __future__ import annotations

from pathlib import Path

from orbexa_ai.office import build_docx, build_pdf, build_xlsx

FICTIONAL_BANNER = "FICTIONAL TENDER PACK. NOT A REAL PROCUREMENT AND NOT A REAL SUPPLIER."

INVITATION_LINES = [
    FICTIONAL_BANNER,
    "Buyer: Pacific Teaching Hospital, a fictional organisation.",
    "Subject: supply of hospital beds.",
    "REQUIREMENT: The bidder must state how many hospital beds it can deliver within 90 days.",
    "REQUIREMENT: The bidder must attach a regulatory certificate for the bed model.",
    "CRITERION: Evaluation will prefer a clear delivery statement over an unsupported one.",
]

SPECIFICATION_LINES = [
    FICTIONAL_BANNER,
    "Specification note, fictional.",
    "The buyer asks for a bed width between 900 mm and 1000 mm.",
    "Side rails are requested on both sides.",
    "This specification does not contain a regulatory certificate.",
]

SCHEDULE_ROWS = [
    ["Item", "Specification", "Certificate on file"],
    ["Bed frame", "Width target 950 mm", ""],
    ["Side rails", "Both sides", ""],
]

SUPPLIER_LINES = [
    FICTIONAL_BANNER,
    "Authorised supplier note written by Rahul Distributors for this fictional exercise.",
    "Bed width in our fictional catalogue note: 950 mm.",
    "Side rails: both sides, from the same fictional catalogue note.",
    "This note does not state how many beds can be delivered.",
    "This note does not include a regulatory certificate.",
]


def write_pack(directory: Path) -> dict[str, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    paths = {
        "invitation.pdf": directory / "invitation.pdf",
        "specification.docx": directory / "specification.docx",
        "schedule.xlsx": directory / "schedule.xlsx",
        "supplier-note.docx": directory / "supplier-note.docx",
    }
    paths["invitation.pdf"].write_bytes(build_pdf(INVITATION_LINES))
    paths["specification.docx"].write_bytes(build_docx(SPECIFICATION_LINES))
    paths["schedule.xlsx"].write_bytes(build_xlsx("Schedule", SCHEDULE_ROWS))
    paths["supplier-note.docx"].write_bytes(build_docx(SUPPLIER_LINES))
    return paths

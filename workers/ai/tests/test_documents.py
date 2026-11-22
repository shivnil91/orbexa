import pytest

from orbexa_ai.documents import UnsupportedUploadError, classify_upload


def test_accepts_tender_file_types() -> None:
    assert classify_upload("beds.pdf", "application/pdf") == ".pdf"
    assert (
        classify_upload(
            "response.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        == ".docx"
    )
    assert (
        classify_upload(
            "matrix.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        == ".xlsx"
    )


def test_rejects_a_mismatched_extension() -> None:
    with pytest.raises(UnsupportedUploadError):
        classify_upload("beds.exe", "application/pdf")

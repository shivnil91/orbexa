"""Upload contract for the tender vertical. Parsing is not implemented here."""

ALLOWED_MEDIA_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}


class UnsupportedUploadError(ValueError):
    """The file is outside the tender vertical's accepted types."""


def classify_upload(filename: str, media_type: str) -> str:
    expected = ALLOWED_MEDIA_TYPES.get(media_type)
    if expected is None:
        raise UnsupportedUploadError(f"unsupported media type: {media_type}")
    if not filename.lower().endswith(expected):
        raise UnsupportedUploadError(f"filename does not match {expected}")
    return expected

"""Instruction boundary and claim checks. These do not call a model."""

SUPPORT_STATES = frozenset({"supported", "unsupported", "missing_evidence"})


def wrap_untrusted_document(text: str) -> str:
    """Put buyer document text in a data fence. The fence is not an instruction."""
    stripped = text.replace("</untrusted_document>", "")
    return f"<untrusted_document>\n{stripped}\n</untrusted_document>"


def claim_is_admissible(support_status: str, citation_count: int) -> bool:
    if support_status not in SUPPORT_STATES:
        return False
    if support_status == "supported":
        return citation_count > 0
    return citation_count >= 0

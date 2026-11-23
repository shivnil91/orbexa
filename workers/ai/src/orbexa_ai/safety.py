"""Instruction boundary and claim checks. These do not call a model."""

from __future__ import annotations

import re

SUPPORT_STATES = frozenset({"supported", "unsupported", "missing_evidence"})

_FENCE_TAG = re.compile(r"<\s*/?\s*untrusted_(?:expert_asset|document)\b[^>]*>", re.IGNORECASE)


def fence_untrusted(tag: str, text: str, *, kind: str | None = None) -> str:
    """Wrap untrusted text. Nested and mixed-case fence tags are removed first."""
    body = text.replace("\x00", "")
    previous = ""
    while previous != body:
        previous = body
        body = _FENCE_TAG.sub("", body)
    body = body.replace("<", "‹")
    attrs = ""
    if kind is not None:
        allowed = "".join(ch for ch in kind.lower() if ch.isascii() and (ch.isalnum() or ch == "_"))
        attrs = f' kind="{allowed[:24] or "note"}"'
    return f"<{tag}{attrs}>\n{body}\n</{tag}>"


def wrap_untrusted_document(text: str) -> str:
    """Put buyer document text in a data fence. The fence is not an instruction."""
    return fence_untrusted("untrusted_document", text)


def claim_is_admissible(support_status: str, citation_count: int) -> bool:
    if support_status not in SUPPORT_STATES:
        return False
    if support_status == "supported":
        return citation_count > 0
    return citation_count >= 0

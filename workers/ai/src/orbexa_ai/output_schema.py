"""Per-stage JSON Schema checks for model output.

The scalar rules match the intake subset. Arrays and nested objects are
accepted here because a stage result is a list of claims, not an intake form.
A supported claim must pass claim_is_admissible.
"""

from __future__ import annotations

from typing import Any

from orbexa_ai.providers import ProviderError
from orbexa_ai.safety import claim_is_admissible


class OutputRejected(ProviderError):
    """The model JSON did not match the stage schema."""


EXTRACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["requirements"],
    "properties": {
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "required": ["kind", "body", "chunk_index"],
                "properties": {
                    "kind": {"type": "string", "enum": ["mandatory", "evaluation_criterion"]},
                    "body": {"type": "string", "minLength": 1},
                    "chunk_index": {"type": "integer"},
                },
            },
        }
    },
}

MATRIX_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["rows"],
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "required": ["body", "missing_evidence", "response_status"],
                "properties": {
                    "body": {"type": "string", "minLength": 1},
                    "missing_evidence": {"type": "boolean"},
                    "response_status": {
                        "type": "string",
                        "enum": ["partial", "not_addressed", "addressed"],
                    },
                    "chunk_index": {"type": "integer"},
                },
            },
        }
    },
}

DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["paragraphs", "claims"],
    "properties": {
        "paragraphs": {"type": "array", "items": {"type": "string"}},
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "required": ["body", "support_status"],
                "properties": {
                    "body": {"type": "string", "minLength": 1},
                    "support_status": {
                        "type": "string",
                        "enum": ["supported", "unsupported", "missing_evidence"],
                    },
                    "chunk_indexes": {"type": "array", "items": {"type": "integer"}},
                    "quote": {"type": "string"},
                },
            },
        },
    },
}

STAGE_SCHEMAS = {
    "extract": EXTRACT_SCHEMA,
    "matrix": MATRIX_SCHEMA,
    "draft": DRAFT_SCHEMA,
}


def validate_stage_output(task: str, payload: object) -> None:
    schema = STAGE_SCHEMAS.get(task)
    if schema is None:
        raise OutputRejected(f"no schema for task {task}")
    _check(schema, payload, task)
    if task == "draft":
        _check_claims(payload)


def _check(schema: dict[str, Any], payload: object, where: str) -> None:
    expected = schema.get("type")
    if expected == "object":
        if not isinstance(payload, dict):
            raise OutputRejected(f"{where} must be an object")
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            raise OutputRejected(f"{where} properties must be an object")
        required = schema.get("required", [])
        if isinstance(required, list):
            for key in required:
                if key not in payload:
                    raise OutputRejected(f"{where} missing {key}")
        if schema.get("additionalProperties", True) is False:
            for key in payload:
                if key not in properties:
                    raise OutputRejected(f"{where} property {key} is not allowed")
        for key, prop in properties.items():
            if key not in payload or not isinstance(prop, dict):
                continue
            _check(prop, payload[key], f"{where}.{key}")
        return
    if expected == "array":
        if not isinstance(payload, list):
            raise OutputRejected(f"{where} must be an array")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(payload):
                _check(item_schema, item, f"{where}[{index}]")
        return
    _check_scalar(schema, payload, where)


def _check_scalar(schema: dict[str, Any], value: object, where: str) -> None:
    expected = schema.get("type")
    if isinstance(value, bool) and expected != "boolean":
        raise OutputRejected(f"{where} must be a {expected}")
    if expected == "string" and not isinstance(value, str):
        raise OutputRejected(f"{where} must be a string")
    if expected == "boolean" and not isinstance(value, bool):
        raise OutputRejected(f"{where} must be a boolean")
    if expected in ("number", "integer") and not isinstance(value, (int, float)):
        raise OutputRejected(f"{where} must be a number")
    if expected == "integer" and not isinstance(value, int):
        raise OutputRejected(f"{where} must be an integer")
    if "enum" in schema and value not in schema["enum"]:
        raise OutputRejected(f"{where} is not an allowed value")
    min_length = schema.get("minLength")
    if isinstance(min_length, int) and isinstance(value, str) and len(value) < min_length:
        raise OutputRejected(f"{where} is too short")


def _check_claims(payload: object) -> None:
    if not isinstance(payload, dict):
        raise OutputRejected("draft must be an object")
    claims = payload.get("claims")
    if not isinstance(claims, list):
        raise OutputRejected("draft claims must be a list")
    for index, claim in enumerate(claims):
        if not isinstance(claim, dict):
            raise OutputRejected(f"claim {index} must be an object")
        status = str(claim.get("support_status", ""))
        indexes = claim.get("chunk_indexes")
        citations = claim.get("citations")
        count = len(indexes) if isinstance(indexes, list) else 0
        if isinstance(citations, list):
            count += len(citations)
        if not claim_is_admissible(status, count):
            raise OutputRejected(f"claim {index} is not admissible")

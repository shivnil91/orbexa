"""JSON Schema subset for vertical intake forms.

Supported: type object, properties, required, additionalProperties, and
property type string, number, integer, or boolean, plus enum and minLength.
"""

from __future__ import annotations

from typing import Any


class IntakeError(ValueError):
    """The payload does not match the vertical intake schema."""


def validate_intake(schema: dict[str, Any], payload: object) -> None:
    if schema.get("type") != "object":
        raise IntakeError("intake schema must be a JSON object schema")
    if not isinstance(payload, dict):
        raise IntakeError("intake must be an object")
    properties = schema.get("properties", {})
    if not isinstance(properties, dict):
        raise IntakeError("intake properties must be an object")
    required = schema.get("required", [])
    if not isinstance(required, list):
        raise IntakeError("intake required must be a list")
    for key in required:
        if key not in payload:
            raise IntakeError(f"intake missing {key}")
    if schema.get("additionalProperties", True) is False:
        for key in payload:
            if key not in properties:
                raise IntakeError(f"intake property {key} is not allowed")
    for key, prop in properties.items():
        if key not in payload or not isinstance(prop, dict):
            continue
        _check_property(key, prop, payload[key])


def _check_property(key: str, prop: dict[str, Any], value: object) -> None:
    expected = prop.get("type")
    if isinstance(value, bool) and expected != "boolean":
        raise IntakeError(f"intake property {key} must be a {expected}")
    if expected == "string" and not isinstance(value, str):
        raise IntakeError(f"intake property {key} must be a string")
    if expected == "boolean" and not isinstance(value, bool):
        raise IntakeError(f"intake property {key} must be a boolean")
    if expected in ("number", "integer") and not isinstance(value, (int, float)):
        raise IntakeError(f"intake property {key} must be a number")
    if expected == "integer" and not isinstance(value, int):
        raise IntakeError(f"intake property {key} must be an integer")
    if "enum" in prop and value not in prop["enum"]:
        raise IntakeError(f"intake property {key} is not an allowed value")
    min_length = prop.get("minLength")
    if isinstance(min_length, int) and isinstance(value, str) and len(value) < min_length:
        raise IntakeError(f"intake property {key} is too short")

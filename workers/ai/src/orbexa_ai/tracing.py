"""OpenTelemetry spans for one activity or one model call.

ADR 0005 allows model name, token counts, latency, tenant id, and agent
version. Prompt text and document text are dropped before they reach a span.
"""

from __future__ import annotations

import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from time import perf_counter
from typing import Any

ALLOWED_ATTRIBUTES = frozenset(
    {
        "gen_ai.request.model",
        "gen_ai.usage.input_tokens",
        "gen_ai.usage.output_tokens",
        "orbexa.latency_ms",
        "orbexa.tenant_id",
        "orbexa.agent_version_id",
    }
)

_records: list[dict[str, Any]] = []
_installed = False
_TOKEN = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
_SPAN = re.compile(r"^[a-z_]{1,32}$")


def recorded_spans() -> list[dict[str, Any]]:
    return [dict(item) for item in _records]


def reset_spans() -> None:
    _records.clear()


def filter_attributes(attributes: Mapping[str, object]) -> dict[str, str | int | float | bool]:
    """Keep the ADR 0005 set. Long strings are treated as document text and dropped."""
    safe: dict[str, str | int | float | bool] = {}
    for key, value in attributes.items():
        if key not in ALLOWED_ATTRIBUTES:
            continue
        if isinstance(value, bool):
            safe[key] = value
        elif isinstance(value, int) and not isinstance(value, bool):
            safe[key] = value
        elif isinstance(value, float):
            safe[key] = value
        elif isinstance(value, str) and _TOKEN.fullmatch(value):
            safe[key] = value
    return safe


def public_span_name(name: str) -> str:
    """Stage names are fixed tokens. Document text is not a span name."""
    if _SPAN.fullmatch(name):
        return name
    return "activity"


def _install() -> Any:
    global _installed
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

    class _MemoryExporter(SpanExporter):
        def export(self, spans: Any) -> SpanExportResult:
            for span in spans:
                attributes = dict(span.attributes or {})
                _records.append({"name": span.name, "attributes": attributes})
            return SpanExportResult.SUCCESS

        def shutdown(self) -> None:
            return None

    provider = trace.get_tracer_provider()
    if not _installed:
        sdk_provider = TracerProvider()
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor

        sdk_provider.add_span_processor(SimpleSpanProcessor(_MemoryExporter()))
        # The default provider is a proxy until this process installs one.
        if provider.__class__.__name__ == "ProxyTracerProvider":
            trace.set_tracer_provider(sdk_provider)
        _installed = True
    return trace.get_tracer("orbexa")


@contextmanager
def start_span(name: str, attributes: Mapping[str, object] | None = None) -> Iterator[None]:
    """Record one span. The name is a fixed stage or 'complete', never document text."""
    started = perf_counter()
    safe = filter_attributes(attributes or {})
    tracer = _install()
    with tracer.start_as_current_span(public_span_name(name)) as current:
        for key, value in safe.items():
            current.set_attribute(key, value)
        try:
            yield
        finally:
            elapsed = int((perf_counter() - started) * 1000)
            current.set_attribute("orbexa.latency_ms", elapsed)

"""One gateway call: route, tenant cache, one fallback, invocation row.

The default model stays the fixture. Vendor prompt-cache fields are sent only
when ORBEXA_PROVIDER_CONTRACT=1. Until then the cache is llm_cache.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter

from orbexa_ai.bandit import maybe_reroute
from orbexa_ai.gateway import LlmGateway, gateway_from_env
from orbexa_ai.guardrails import assert_output_safe, screen_chunks
from orbexa_ai.ingest import Chunk
from orbexa_ai.limits import RunBudget
from orbexa_ai.ops_store import (
    CacheEntry,
    FileOpsStore,
    InvocationRecord,
    MemoryOpsStore,
    ModelRoute,
    OpsStore,
    new_cache_key,
)
from orbexa_ai.output_schema import validate_stage_output
from orbexa_ai.providers import LiveHttpGateway, ProviderError
from orbexa_ai.tracing import start_span


@dataclass(frozen=True)
class RunContext:
    tenant_id: str = ""
    home_region: str = "local"
    job_id: str = ""
    run_id: str = ""
    agent_version_id: str = ""
    currency: str = "USD"


def context_from_payload(payload: Mapping[str, str]) -> RunContext:
    job_id = payload.get("job_id", "")
    return RunContext(
        tenant_id=payload.get("tenant_id", ""),
        home_region=payload.get("home_region") or "local",
        job_id=job_id,
        run_id=payload.get("run_id") or job_id,
        agent_version_id=payload.get("agent_version_id", ""),
        currency=payload.get("currency") or "USD",
    )


def store_for_payload(payload: Mapping[str, str]) -> OpsStore:
    directory = payload.get("store_dir")
    if directory:
        return FileOpsStore(Path(directory) / "gateway")
    return MemoryOpsStore()


def prompt_hash(task: str, model: str, chunks: list[Chunk]) -> str:
    """Hash of task, model, and chunk hashes. The chunk bodies are not stored."""
    payload = {
        "task": task,
        "model": model,
        "chunks": [hashlib.sha256(chunk.body.encode("utf-8")).hexdigest() for chunk in chunks],
    }
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _model_token(value: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9._:-]{1,80}", value):
        return value
    return "rejected"


def _safe_route(route: ModelRoute) -> ModelRoute:
    """Model ids are tokens. Prose in a route is not sent to a provider or a span."""
    primary = _model_token(route.primary_model)
    if primary == "rejected":
        primary = "fixture"
    fallback = route.fallback_model
    if fallback is not None and _model_token(fallback) == "rejected":
        fallback = None
    return ModelRoute(route.id, route.code, primary, fallback)


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def cost_minor_for(model: str, input_tokens: int, output_tokens: int, *, cache_hit: bool) -> int:
    """A non-zero fixture estimate so a run has a cost. This is not a vendor invoice."""
    if cache_hit:
        return 0
    if model == "fixture":
        return 1
    return max(1, (input_tokens + output_tokens) // 1000)


def _tokens(gateway: LlmGateway, prompt: str, result: dict[str, object]) -> tuple[int, int]:
    usage = getattr(gateway, "last_usage", None)
    if isinstance(usage, tuple) and len(usage) == 2:
        incoming = int(usage[0])
        outgoing = int(usage[1])
        if incoming or outgoing:
            return incoming, outgoing
    return estimate_tokens(prompt), estimate_tokens(json.dumps(result))


def _prepare(gateway: LlmGateway, model: str, cache_key: str | None, prompt_cache: bool) -> None:
    if isinstance(gateway, LiveHttpGateway):
        gateway.model = model
        gateway.prompt_cache = prompt_cache
        gateway.prompt_cache_key = cache_key if prompt_cache else None


def _invoke(
    gateway: LlmGateway,
    task: str,
    chunks: list[Chunk],
    model: str,
    cache_key: str | None,
    prompt_cache: bool,
) -> dict[str, object]:
    _prepare(gateway, model, cache_key, prompt_cache)
    result = gateway.complete(task, chunks)
    if not isinstance(result, dict):
        raise ProviderError("model JSON was not an object")
    return result


def complete_routed(
    task: str,
    chunks: list[Chunk],
    *,
    context: RunContext | None = None,
    store: OpsStore | None = None,
    gateway: LlmGateway | None = None,
    budget: RunBudget | None = None,
    env: Mapping[str, str] | None = None,
    payload: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Load the route, read the tenant cache, fall back once, and record the call."""
    selected = os.environ if env is None else env
    ctx = context or (context_from_payload(payload) if payload is not None else RunContext())
    ops = store or (store_for_payload(payload) if payload is not None else MemoryOpsStore())
    chosen = gateway if gateway is not None else gateway_from_env(selected)
    route = _safe_route(maybe_reroute(ops.load_route(ctx.agent_version_id), selected))
    prompt_cache = selected.get("ORBEXA_PROVIDER_CONTRACT") == "1"
    findings = screen_chunks(ops, ctx.tenant_id, chunks)
    del findings
    primary_hash = prompt_hash(task, route.primary_model, chunks)
    started = perf_counter()
    cached = ops.cache_get(ctx.tenant_id, route.primary_model, primary_hash)
    served = route.primary_model
    fallback_used = False
    if cached is None and route.fallback_model:
        fallback_hash = prompt_hash(task, route.fallback_model, chunks)
        cached = ops.cache_get(ctx.tenant_id, route.fallback_model, fallback_hash)
        if cached is not None:
            served = route.fallback_model
            fallback_used = True
    attributes: dict[str, object] = {}
    if ctx.tenant_id:
        attributes["orbexa.tenant_id"] = ctx.tenant_id
    if ctx.agent_version_id:
        attributes["orbexa.agent_version_id"] = ctx.agent_version_id
    if cached is not None:
        with start_span("complete", {**attributes, "gen_ai.request.model": served}):
            assert_output_safe(cached.response, ctx.tenant_id or None)
            latency_ms = int((perf_counter() - started) * 1000)
            _record(
                ops,
                ctx,
                route_id=route.id,
                requested=route.primary_model,
                served=served,
                fallback_used=fallback_used,
                cache_hit=True,
                input_tokens=cached.input_tokens,
                output_tokens=cached.output_tokens,
                latency_ms=latency_ms,
                prompt_hash_value=prompt_hash(task, served, chunks),
            )
            return cached.response

    # Charge the in-process budget and the SQL rate limit before any HTTP.
    ops.consume_rate_limit(ctx.tenant_id)
    if budget is not None:
        budget.charge()
    prompt = task
    with start_span("complete", {**attributes, "gen_ai.request.model": route.primary_model}):
        try:
            result = _invoke(chosen, task, chunks, route.primary_model, primary_hash, prompt_cache)
            validate_stage_output(task, result)
            assert_output_safe(result, ctx.tenant_id or None)
        except ProviderError:
            if not route.fallback_model:
                raise
            fallback_used = True
            served = route.fallback_model
            fallback_key = prompt_hash(task, served, chunks)
            result = _invoke(chosen, task, chunks, served, fallback_key, prompt_cache)
            validate_stage_output(task, result)
            assert_output_safe(result, ctx.tenant_id or None)
        incoming, outgoing = _tokens(chosen, prompt, result)
        latency_ms = int((perf_counter() - started) * 1000)
        served_hash = prompt_hash(task, served, chunks)
        ops.cache_put(
            ctx.tenant_id,
            served,
            served_hash,
            CacheEntry(
                response=result,
                input_tokens=incoming,
                output_tokens=outgoing,
                storage_key=new_cache_key(ctx.tenant_id, ctx.home_region, served_hash),
                expires_at=(datetime.now(UTC) + timedelta(hours=24)).isoformat(),
            ),
        )
        _record(
            ops,
            ctx,
            route_id=route.id,
            requested=route.primary_model,
            served=served,
            fallback_used=fallback_used,
            cache_hit=False,
            input_tokens=incoming,
            output_tokens=outgoing,
            latency_ms=latency_ms,
            prompt_hash_value=served_hash,
        )
        return result


def _record(
    store: OpsStore,
    ctx: RunContext,
    *,
    route_id: str,
    requested: str,
    served: str,
    fallback_used: bool,
    cache_hit: bool,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    prompt_hash_value: str,
) -> None:
    store.insert_invocation(
        InvocationRecord(
            tenant_id=ctx.tenant_id,
            home_region=ctx.home_region,
            job_id=ctx.job_id,
            run_id=ctx.run_id,
            route_id=route_id,
            agent_version_id=ctx.agent_version_id,
            requested_model=_model_token(requested),
            served_model=_model_token(served),
            fallback_used=fallback_used,
            cache_hit=cache_hit,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_currency=ctx.currency,
            cost_minor=cost_minor_for(
                served,
                input_tokens,
                output_tokens,
                cache_hit=cache_hit,
            ),
            latency_ms=latency_ms,
            prompt_hash=prompt_hash_value,
        )
    )

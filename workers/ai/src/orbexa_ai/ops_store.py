"""Route, cache, invocation, and tool records.

The default store is in memory. A directory store is what activities use so a
retry in the same job can hit the prompt cache. Postgres is used only when
ORBEXA_DATABASE_URL is set and psycopg is installed. Rows still go through
row-level security: the session GUCs are set to the job tenant before writes.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol
from uuid import uuid4


@dataclass(frozen=True)
class ModelRoute:
    id: str
    code: str
    primary_model: str
    fallback_model: str | None


FIXTURE_ROUTE = ModelRoute(
    id="00000000-0000-4000-8000-0000000000a1",
    code="fixture",
    primary_model="fixture",
    fallback_model=None,
)

DEFAULT_TOOLS = frozenset({"read_chunk", "write_artifact", "flag_claim"})


@dataclass
class InvocationRecord:
    tenant_id: str
    home_region: str
    job_id: str
    run_id: str
    route_id: str
    agent_version_id: str
    requested_model: str
    served_model: str
    fallback_used: bool
    cache_hit: bool
    input_tokens: int
    output_tokens: int
    cost_currency: str
    cost_minor: int
    latency_ms: int
    prompt_hash: str


@dataclass
class CacheEntry:
    response: dict[str, object]
    input_tokens: int
    output_tokens: int
    storage_key: str
    expires_at: str


@dataclass
class RetrievalEvent:
    tenant_id: str
    home_region: str
    job_id: str
    run_id: str
    scope: str
    query_hash: str
    result_ids: list[str]


@dataclass
class ToolCallRecord:
    tenant_id: str
    job_id: str
    run_id: str
    tool_code: str
    status: str
    args_hash: str
    result_hash: str


@dataclass
class GuardrailEvent:
    tenant_id: str
    kind: str
    count: int


@dataclass
class MemoryOpsStore:
    route: ModelRoute = field(default_factory=lambda: FIXTURE_ROUTE)
    requests_per_minute: int | None = None
    allowed_tools: frozenset[str] = DEFAULT_TOOLS
    invocations: list[InvocationRecord] = field(default_factory=list)
    events: list[RetrievalEvent] = field(default_factory=list)
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    guardrails: list[GuardrailEvent] = field(default_factory=list)
    cache: dict[tuple[str, str, str], CacheEntry] = field(default_factory=dict)
    rate_counts: dict[str, int] = field(default_factory=dict)
    statements: list[str] = field(default_factory=list)

    def load_route(self, agent_version_id: str) -> ModelRoute:
        del agent_version_id
        return self.route

    def consume_rate_limit(self, org_id: str) -> int:
        """Match app.consume_rate_limit: no policy means the call is allowed."""
        if not org_id or self.requests_per_minute is None:
            return 0
        used = self.rate_counts.get(org_id, 0)
        if used >= self.requests_per_minute:
            from orbexa_ai.limits import RateLimitExceeded

            raise RateLimitExceeded("org exceeded its rate limit")
        self.rate_counts[org_id] = used + 1
        return used + 1

    def cache_get(self, tenant_id: str, model: str, prompt_hash: str) -> CacheEntry | None:
        return self.cache.get((tenant_id, model, prompt_hash))

    def cache_put(self, tenant_id: str, model: str, prompt_hash: str, entry: CacheEntry) -> None:
        self.cache[(tenant_id, model, prompt_hash)] = entry

    def insert_invocation(self, record: InvocationRecord) -> None:
        self.invocations.append(record)

    def insert_retrieval_event(self, event: RetrievalEvent) -> None:
        self.events.append(event)

    def insert_tool_call(self, record: ToolCallRecord) -> None:
        self.tool_calls.append(record)

    def record_guardrail(self, event: GuardrailEvent) -> None:
        self.guardrails.append(event)


class OpsStore(Protocol):
    def load_route(self, agent_version_id: str) -> ModelRoute: ...

    def consume_rate_limit(self, org_id: str) -> int: ...

    def cache_get(self, tenant_id: str, model: str, prompt_hash: str) -> CacheEntry | None: ...

    def cache_put(
        self, tenant_id: str, model: str, prompt_hash: str, entry: CacheEntry
    ) -> None: ...

    def insert_invocation(self, record: InvocationRecord) -> None: ...

    def insert_retrieval_event(self, event: RetrievalEvent) -> None: ...

    def insert_tool_call(self, record: ToolCallRecord) -> None: ...

    def record_guardrail(self, event: GuardrailEvent) -> None: ...


class FileOpsStore:
    """JSON files under the job directory. Bodies are the model JSON, not prompts."""

    def __init__(self, directory: Path, inner: MemoryOpsStore | None = None) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.inner = inner or MemoryOpsStore()
        self._load()

    @property
    def allowed_tools(self) -> frozenset[str]:
        return self.inner.allowed_tools

    def _load(self) -> None:
        cache_path = self.directory / "cache.json"
        if cache_path.exists():
            raw = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for key, value in raw.items():
                    tenant, model, prompt_hash = key.split("|", 2)
                    if isinstance(value, dict):
                        response = value.get("response")
                        if isinstance(response, dict):
                            self.inner.cache[(tenant, model, prompt_hash)] = CacheEntry(
                                response=response,
                                input_tokens=int(value.get("input_tokens", 0)),
                                output_tokens=int(value.get("output_tokens", 0)),
                                storage_key=str(value.get("storage_key", "")),
                                expires_at=str(value.get("expires_at", "")),
                            )

    def _flush_cache(self) -> None:
        payload = {
            f"{tenant}|{model}|{prompt_hash}": asdict(entry)
            for (tenant, model, prompt_hash), entry in self.inner.cache.items()
        }
        (self.directory / "cache.json").write_text(json.dumps(payload), encoding="utf-8")

    def load_route(self, agent_version_id: str) -> ModelRoute:
        return self.inner.load_route(agent_version_id)

    def consume_rate_limit(self, org_id: str) -> int:
        return self.inner.consume_rate_limit(org_id)

    def cache_get(self, tenant_id: str, model: str, prompt_hash: str) -> CacheEntry | None:
        return self.inner.cache_get(tenant_id, model, prompt_hash)

    def cache_put(self, tenant_id: str, model: str, prompt_hash: str, entry: CacheEntry) -> None:
        self.inner.cache_put(tenant_id, model, prompt_hash, entry)
        self._flush_cache()

    def insert_invocation(self, record: InvocationRecord) -> None:
        self.inner.insert_invocation(record)
        with (self.directory / "invocations.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(asdict(record)) + "\n")

    def insert_retrieval_event(self, event: RetrievalEvent) -> None:
        self.inner.insert_retrieval_event(event)
        with (self.directory / "retrieval_events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(asdict(event)) + "\n")

    def insert_tool_call(self, record: ToolCallRecord) -> None:
        self.inner.insert_tool_call(record)
        with (self.directory / "tool_calls.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(asdict(record)) + "\n")

    def record_guardrail(self, event: GuardrailEvent) -> None:
        self.inner.record_guardrail(event)
        with (self.directory / "guardrails.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(asdict(event)) + "\n")


def new_cache_key(tenant_id: str, home_region: str, prompt_hash: str) -> str:
    """Object key under the tenant prefix. The object is the JSON response, not the prompt."""
    tenant = tenant_id or "local-demo"
    region = home_region or "local"
    return f"{tenant}/{region}/cache/{prompt_hash}.json"


def postgres_statements_for_invocation(
    record: InvocationRecord,
) -> list[tuple[str, tuple[object, ...]]]:
    """SQL the worker sends when a database URL is configured. RLS still applies."""
    return [
        ("SELECT set_config('app.tenant_id', %s, true)", (record.tenant_id,)),
        ("SELECT set_config('app.job_id', %s, true)", (record.job_id,)),
        (
            """INSERT INTO llm_invocations (
                 tenant_id, home_region, job_id, run_id, route_id, requested_model, served_model,
                 fallback_used, cache_hit, input_tokens, output_tokens, cost_currency, cost_minor,
                 latency_ms, prompt_hash
               ) VALUES (
                 %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
               )""",
            (
                record.tenant_id,
                record.home_region,
                record.job_id,
                record.run_id,
                record.route_id,
                record.requested_model,
                record.served_model,
                record.fallback_used,
                record.cache_hit,
                record.input_tokens,
                record.output_tokens,
                record.cost_currency,
                record.cost_minor,
                record.latency_ms,
                record.prompt_hash,
            ),
        ),
    ]


class RecordingConnection:
    """Test double. It records SQL and returns scripted rows."""

    def __init__(self, rows: list[tuple[object, ...]] | None = None) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self._rows = rows or []

    def cursor(self) -> RecordingConnection:
        return self

    def execute(self, sql: str, params: tuple[object, ...] = ()) -> None:
        self.statements.append((sql, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        return list(self._rows)

    def commit(self) -> None:
        return None


def write_invocation_sql(connection: RecordingConnection, record: InvocationRecord) -> None:
    for sql, params in postgres_statements_for_invocation(record):
        connection.execute(sql, params)
    connection.commit()


def connect_postgres(url: str) -> object:
    """Open a psycopg connection. Imported only when a URL is configured."""
    if not url:
        raise RuntimeError("database url is empty")
    try:
        module = __import__("psycopg")
    except ImportError as exc:
        raise RuntimeError("ORBEXA_DATABASE_URL is set and psycopg is not installed") from exc
    connect = getattr(module, "connect")
    return connect(url)


def new_id() -> str:
    return str(uuid4())

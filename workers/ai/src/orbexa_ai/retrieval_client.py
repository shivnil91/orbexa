"""Call app.retrieve_chunks and app.retrieve_memory under the job tenant.

The in-memory ranker remains the unit of the ranking math. This module is the
worker path that hits Postgres when a connection is configured, and that still
writes a retrieval event when it is not.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Mapping, Sequence
from typing import Protocol, cast

from orbexa_ai.ingest import Chunk
from orbexa_ai.ops_store import OpsStore, RetrievalEvent, connect_postgres
from orbexa_ai.retrieval import ChunkCandidate, retrieve

_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_RESULT_ID = re.compile(
    r"^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{1,4})$",
    re.IGNORECASE,
)
_ZERO_VECTOR = "[" + ",".join(["0"] * 1536) + "]"


class DbCursor(Protocol):
    def execute(self, sql: str, params: tuple[object, ...] = ()) -> None: ...

    def fetchall(self) -> Sequence[tuple[object, ...]]: ...


class DbConnection(Protocol):
    def cursor(self) -> DbCursor: ...

    def commit(self) -> None: ...


def query_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _ids(rows: Sequence[tuple[object, ...]]) -> list[str]:
    found: list[str] = []
    for row in rows:
        if row:
            found.append(str(row[0]))
    return found


def retrieve_sql(
    connection: DbConnection,
    *,
    tenant_id: str,
    job_id: str,
    agent_id: str,
    embedding_model_id: str,
    query_text: str,
    limit: int = 8,
) -> tuple[list[str], list[str]]:
    """Set the tenant GUC, then call the two SECURITY INVOKER functions.

    query_text is bound as a parameter and is not written to retrieval_events.
    The event stores query_hash only.
    """
    if not _UUID.match(tenant_id) or not _UUID.match(job_id):
        raise ValueError("tenant and job must be uuids")
    cursor = connection.cursor()
    cursor.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant_id,))
    cursor.execute("SELECT set_config('app.job_id', %s, true)", (job_id,))
    if _UUID.match(agent_id):
        cursor.execute("SELECT set_config('app.agent_id', %s, true)", (agent_id,))
    cursor.execute(
        """SELECT chunk_id::text
           FROM app.retrieve_chunks(%s::uuid, %s::uuid, %s::uuid, %s::vector, %s, %s)""",
        (tenant_id, job_id, embedding_model_id, _ZERO_VECTOR, query_text, limit),
    )
    chunks = _ids(cursor.fetchall())
    memory: list[str] = []
    if _UUID.match(agent_id):
        cursor.execute(
            """SELECT memory_item_id::text
               FROM app.retrieve_memory(%s, %s::uuid, %s::uuid, %s::vector, %s)""",
            ("creator_expertise", agent_id, embedding_model_id, _ZERO_VECTOR, limit),
        )
        memory = _ids(cursor.fetchall())
    connection.commit()
    return chunks, memory


def record_retrieval(
    store: OpsStore,
    *,
    tenant_id: str,
    home_region: str,
    job_id: str,
    run_id: str,
    scope: str,
    query_text: str,
    result_ids: list[str],
) -> None:
    store.insert_retrieval_event(
        RetrievalEvent(
            tenant_id=tenant_id,
            home_region=home_region,
            job_id=job_id,
            run_id=run_id,
            scope=scope,
            query_hash=query_hash(query_text),
            result_ids=[item for item in result_ids if _RESULT_ID.fullmatch(item)],
        )
    )


def retrieve_local(chunks: list[Chunk], query_text: str) -> list[str]:
    """Rank the job's own chunks in memory. Ids are positions, not tenant data."""
    candidates = [
        ChunkCandidate(id=str(index), body=chunk.body) for index, chunk in enumerate(chunks)
    ]
    ranked = retrieve(candidates, query_text, lexical="bm25", limit=5)
    return [item.id for item in ranked]


def retrieve_for_activity(
    chunks: list[Chunk],
    payload: Mapping[str, str],
    store: OpsStore,
    connection: DbConnection | None = None,
) -> list[str]:
    """Prefer Postgres under the job tenant. Otherwise record the local ranker."""
    query_text = payload.get("retrieval_query") or "certificate width"
    tenant_id = payload.get("tenant_id", "")
    job_id = payload.get("job_id", "")
    run_id = payload.get("run_id") or job_id
    home_region = payload.get("home_region") or "local"
    agent_id = payload.get("agent_id", "")
    model_id = payload.get("embedding_model_id", "")
    database_url = os.environ.get("ORBEXA_DATABASE_URL", "")
    active = connection
    if active is None and database_url and _UUID.match(tenant_id) and _UUID.match(job_id):
        active = cast(DbConnection, connect_postgres(database_url))
    ready = _UUID.match(tenant_id) and _UUID.match(job_id) and _UUID.match(model_id)
    if active is not None and ready:
        chunk_ids, memory_ids = retrieve_sql(
            active,
            tenant_id=tenant_id,
            job_id=job_id,
            agent_id=agent_id,
            embedding_model_id=model_id,
            query_text=query_text,
        )
        record_retrieval(
            store,
            tenant_id=tenant_id,
            home_region=home_region,
            job_id=job_id,
            run_id=run_id,
            scope="document_chunks",
            query_text=query_text,
            result_ids=chunk_ids,
        )
        record_retrieval(
            store,
            tenant_id=tenant_id,
            home_region=home_region,
            job_id=job_id,
            run_id=run_id,
            scope="creator_expertise",
            query_text=query_text,
            result_ids=memory_ids,
        )
        return chunk_ids
    local_ids = retrieve_local(chunks, query_text)
    record_retrieval(
        store,
        tenant_id=tenant_id,
        home_region=home_region,
        job_id=job_id,
        run_id=run_id,
        scope="document_chunks",
        query_text=query_text,
        result_ids=local_ids,
    )
    record_retrieval(
        store,
        tenant_id=tenant_id,
        home_region=home_region,
        job_id=job_id,
        run_id=run_id,
        scope="creator_expertise",
        query_text=query_text,
        result_ids=[],
    )
    return local_ids

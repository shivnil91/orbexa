"""Lexical retrieval with a stable signature. BM25 is a parameter, not a new function.

The ts_rank_cd scorer here is the length-free term-frequency rank the worker used
before BM25. Postgres ts_rank_cd remains the database default. The phrase reranker
runs after scoring. It is not a neural model.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Literal

_TOKEN = re.compile(r"[0-9A-Za-z]+")
LexicalScorer = Literal["ts_rank_cd", "bm25"]


@dataclass(frozen=True)
class ChunkCandidate:
    id: str
    body: str


@dataclass(frozen=True)
class RankedChunk:
    id: str
    score: float


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def _tf_scores(chunks: list[ChunkCandidate], query_terms: list[str]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for chunk in chunks:
        counts = Counter(_tokens(chunk.body))
        scores[chunk.id] = float(sum(counts[term] for term in query_terms))
    return scores


def _bm25_scores(chunks: list[ChunkCandidate], query_terms: list[str]) -> dict[str, float]:
    k1 = 1.2
    b = 0.75
    tokenized = [(chunk.id, _tokens(chunk.body)) for chunk in chunks]
    n_docs = len(tokenized)
    avg_len = sum(len(tokens) for _, tokens in tokenized) / n_docs if n_docs else 1.0
    document_frequency = {
        term: sum(1 for _, tokens in tokenized if term in tokens) for term in query_terms
    }
    scores: dict[str, float] = {}
    for chunk_id, tokens in tokenized:
        counts = Counter(tokens)
        doc_len = len(tokens) or 1
        score = 0.0
        for term in query_terms:
            tf = counts[term]
            df = document_frequency[term]
            if tf == 0 or df == 0:
                continue
            idf = math.log(1 + (n_docs - df + 0.5) / (df + 0.5))
            score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / avg_len))
        scores[chunk_id] = score
    return scores


def retrieve(
    chunks: list[ChunkCandidate],
    query: str,
    *,
    lexical: LexicalScorer = "ts_rank_cd",
    rerank: bool = False,
    limit: int = 10,
) -> list[RankedChunk]:
    """Return the same shape for ts_rank_cd and bm25. Rerank reorders those rows."""
    if limit < 1:
        raise ValueError("limit out of range")
    query_terms = list(dict.fromkeys(_tokens(query)))
    if lexical == "bm25":
        raw = _bm25_scores(chunks, query_terms)
    elif lexical == "ts_rank_cd":
        raw = _tf_scores(chunks, query_terms)
    else:
        raise ValueError(f"unknown lexical scorer {lexical}")
    phrase = query.casefold()

    def sort_key(chunk: ChunkCandidate) -> tuple[float, float, str]:
        bonus = 1.0 if rerank and phrase in chunk.body.casefold() else 0.0
        return (-bonus, -raw[chunk.id], chunk.id)

    ordered = sorted(chunks, key=sort_key)
    return [RankedChunk(id=chunk.id, score=raw[chunk.id]) for chunk in ordered[:limit]]


GOLDEN_CASES: tuple[dict[str, object], ...] = (
    {
        "code": "width",
        "query": "950 mm",
        "relevant": "width",
        "chunks": (
            ChunkCandidate("width", "The supplier note records a bed width of 950 mm."),
            ChunkCandidate("repeat", " ".join(["950"] * 40)),
        ),
    },
    {
        "code": "certificate",
        "query": "certificate",
        "relevant": "short",
        "chunks": (
            ChunkCandidate("short", "A regulatory certificate was requested."),
            ChunkCandidate("repeat", ("certificate " * 40) + ("padding " * 80)),
        ),
    },
    {
        "code": "phrase",
        "query": "950 mm",
        "relevant": "phrase",
        "chunks": (
            ChunkCandidate("phrase", "Clearance between the rails is 950 mm."),
            ChunkCandidate("split", ("950 " * 25) + "and the unit is mm"),
        ),
    },
)


def _hit_at_1(lexical: LexicalScorer, *, rerank: bool) -> float:
    hits = 0
    for case in GOLDEN_CASES:
        chunks = case["chunks"]
        assert isinstance(chunks, tuple)
        ranked = retrieve(
            list(chunks),
            str(case["query"]),
            lexical=lexical,
            rerank=rerank,
            limit=5,
        )
        if ranked and ranked[0].id == case["relevant"]:
            hits += 1
    return hits / len(GOLDEN_CASES)


def measure_golden_suite() -> dict[str, float]:
    """Scores on the synthetic hospital-bed retrieval cases. Not a certification."""
    ts_rank = _hit_at_1("ts_rank_cd", rerank=False)
    bm25 = _hit_at_1("bm25", rerank=False)
    reranked = _hit_at_1("bm25", rerank=True)
    return {
        "ts_rank_cd_hit_at_1": ts_rank,
        "bm25_hit_at_1": bm25,
        "bm25_rerank_hit_at_1": reranked,
        "bm25_minus_ts_rank_cd": bm25 - ts_rank,
    }

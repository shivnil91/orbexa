from collections.abc import Mapping
from pathlib import Path

import pytest

from orbexa_ai.gateway import FixtureGateway, ProviderNotConfiguredError, gateway_from_env
from orbexa_ai.ingest import Chunk
from orbexa_ai.injection import (
    FOREIGN_TENANT_ID,
    INJECTION_DOCUMENTS,
    OWN_TENANT_ID,
    DraftInjectionError,
    finalize_draft,
)
from orbexa_ai.job import run_tender_job
from orbexa_ai.limits import BudgetExceeded, RateLimitExceeded, RunBudget
from orbexa_ai.pack import write_pack
from orbexa_ai.providers import LiveHttpGateway, UrllibResponse
from orbexa_ai.release_review import PEN_TEST
from orbexa_ai.retrieval import ChunkCandidate, measure_golden_suite, retrieve
from orbexa_ai.startup import LiveStripeKeyError, refuse_live_stripe_keys


class _RecordingTransport:
    def __init__(self, body: str) -> None:
        self.urls: list[str] = []
        self.headers: list[Mapping[str, str]] = []
        self.body = body

    def __call__(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes,
    ) -> UrllibResponse:
        self.urls.append(url)
        self.headers.append(headers)
        assert b"sk_live_" not in body
        return UrllibResponse(status=200, body=self.body)


def test_live_stripe_keys_are_refused_without_echoing_the_secret() -> None:
    secret = "sk_live_example_should_not_echo"
    with pytest.raises(LiveStripeKeyError) as caught:
        refuse_live_stripe_keys({"STRIPE_SECRET_KEY": secret})
    assert "STRIPE_SECRET_KEY" in str(caught.value)
    assert "should_not_echo" not in str(caught.value)
    with pytest.raises(LiveStripeKeyError):
        gateway_from_env({"LLM_PROVIDER": "fixture", "ANTHROPIC_API_KEY": secret})
    with pytest.raises(LiveStripeKeyError):
        refuse_live_stripe_keys({"STRIPE_TEST_SECRET_KEY": "rk_live_example"})


def test_fixture_gateway_stays_default_and_live_adapters_need_a_key() -> None:
    assert isinstance(gateway_from_env({}), FixtureGateway)
    with pytest.raises(ProviderNotConfiguredError):
        gateway_from_env({"LLM_PROVIDER": "anthropic"})
    with pytest.raises(ProviderNotConfiguredError):
        gateway_from_env({"LLM_PROVIDER": "openai"})
    blocked = gateway_from_env({"LLM_PROVIDER": "xai", "XAI_API_KEY": "present"})
    with pytest.raises(ProviderNotConfiguredError):
        blocked.complete("extract", [])


def test_anthropic_and_openai_adapters_build_requests_without_a_network_call() -> None:
    body = (
        '{"content":[{"type":"thinking","thinking":"skip"},'
        '{"type":"text","text":"{\\"requirements\\": []}"}]}'
    )
    anthropic = _RecordingTransport(body)
    gateway = LiveHttpGateway("anthropic", "sk-ant-test", transport=anthropic)
    result = gateway.complete("extract", [])
    assert result == {"requirements": []}
    assert anthropic.urls == ["https://api.anthropic.com/v1/messages"]
    assert anthropic.headers[0]["x-api-key"] == "sk-ant-test"
    assert "authorization" not in {key.lower() for key in anthropic.headers[0]}

    openai = _RecordingTransport(
        '{"choices":[{"message":{"content":"{\\"rows\\": []}"}}]}'
    )
    selected = gateway_from_env(
        {"LLM_PROVIDER": "openai", "OPENAI_API_KEY": "sk-openai-test"},
        transport=openai,
    )
    assert selected.complete("matrix", []) == {"rows": []}
    assert openai.urls == ["https://api.openai.com/v1/chat/completions"]
    assert openai.headers[0]["authorization"] == "Bearer sk-openai-test"


def test_a_budget_stops_the_provider_call() -> None:
    def explode(
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes,
    ) -> UrllibResponse:
        raise AssertionError("provider was called")

    gateway = LiveHttpGateway(
        "openai",
        "sk-openai-test",
        transport=explode,
        budget=RunBudget(limit_minor=0, requests_per_minute=5, cost_per_call=1),
    )
    with pytest.raises(BudgetExceeded):
        gateway.complete("draft", [])


def test_budget_and_rate_limit_stop_a_runaway_loop() -> None:
    budget = RunBudget(limit_minor=5, requests_per_minute=100, cost_per_call=2)
    with pytest.raises(BudgetExceeded):
        for _ in range(20):
            budget.charge()
    assert budget.spent_minor <= 5
    assert budget.calls == 2

    limited = RunBudget(limit_minor=10_000, requests_per_minute=3, cost_per_call=1)
    with pytest.raises(RateLimitExceeded):
        for _ in range(10):
            limited.charge()
    assert limited.calls == 3


def test_injection_documents_do_not_enter_the_fixture_draft() -> None:
    gateway = FixtureGateway()
    for document in INJECTION_DOCUMENTS:
        assert FOREIGN_TENANT_ID in document or "ISO 13485" in document
        chunk = Chunk(
            document_name="hostile.txt",
            media_type="text/plain",
            kind="prose",
            body=document,
            locator_kind="page",
            page=1,
        )
        draft = finalize_draft(gateway.complete("draft", [chunk]), OWN_TENANT_ID)
        blob = str(draft)
        assert FOREIGN_TENANT_ID not in blob
        assert "ISO 13485" not in blob


def _pack() -> dict[str, bytes]:
    root = Path(__file__).resolve().parents[3]
    pack = root / "fixtures" / "hospital-beds"
    write_pack(pack)
    loaded: dict[str, bytes] = {}
    for path in sorted(pack.iterdir()):
        if path.is_file() and path.suffix != ".md":
            loaded[path.name] = path.read_bytes()
    return loaded


def test_a_draft_that_names_another_tenant_is_rejected() -> None:
    class Poison(FixtureGateway):
        def complete(self, task: str, chunks: list[Chunk]) -> dict[str, object]:
            if task == "draft":
                return {"paragraphs": [FOREIGN_TENANT_ID], "claims": []}
            return super().complete(task, chunks)

    with pytest.raises(DraftInjectionError):
        finalize_draft({"paragraphs": [FOREIGN_TENANT_ID], "claims": []}, OWN_TENANT_ID)
    with pytest.raises(DraftInjectionError):
        run_tender_job(_pack(), service_level="autonomous", gateway=Poison())


def test_bm25_and_rerank_are_measured_on_the_golden_suite() -> None:
    phrase = retrieve(
        [
            ChunkCandidate("phrase", "Clearance between the rails is 950 mm."),
            ChunkCandidate("split", ("950 " * 25) + "and the unit is mm"),
        ],
        "950 mm",
        lexical="bm25",
        rerank=True,
    )
    assert phrase[0].id == "phrase"
    measured = measure_golden_suite()
    assert measured["bm25_minus_ts_rank_cd"] != 0
    assert measured["bm25_rerank_hit_at_1"] >= measured["bm25_hit_at_1"]
    assert set(measured) == {
        "ts_rank_cd_hit_at_1",
        "bm25_hit_at_1",
        "bm25_rerank_hit_at_1",
        "bm25_minus_ts_rank_cd",
    }


def test_no_penetration_test_or_certification_is_claimed() -> None:
    assert PEN_TEST["performed"] is False
    assert PEN_TEST["report_present"] is False
    assert PEN_TEST["certification_claimed"] is False
    assert PEN_TEST["named_third_party"] is None
    assert PEN_TEST["independent_reviewer"] is None

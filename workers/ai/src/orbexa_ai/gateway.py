"""Model gateway. The fixture provider is the default. Live HTTP runs only when selected."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Protocol

from orbexa_ai.ingest import Chunk
from orbexa_ai.providers import HttpTransport, LiveHttpGateway
from orbexa_ai.startup import refuse_live_stripe_keys
from orbexa_ai.verticals.tender_fixture import complete_tender_fixture

LIVE_PROVIDERS = ("anthropic", "openai", "xai")
KEY_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "xai": "XAI_API_KEY",
}


class ProviderNotConfiguredError(RuntimeError):
    """A live provider was selected and this process must not call it."""


class LlmGateway(Protocol):
    def complete(self, task: str, chunks: list[Chunk]) -> dict[str, object]:
        """Return structured JSON for one graph task."""


class FixtureGateway:
    """Default local model. The rules live in the tender-writing pack."""

    def complete(self, task: str, chunks: list[Chunk]) -> dict[str, object]:
        return complete_tender_fixture(task, chunks)


class BlockedLiveGateway:
    def __init__(self, name: str) -> None:
        self.name = name

    def complete(self, task: str, chunks: list[Chunk]) -> dict[str, object]:
        raise ProviderNotConfiguredError(
            f"{self.name} is a stub. No model request is sent. task={task} chunks={len(chunks)}"
        )


def gateway_from_env(
    env: Mapping[str, str] | None = None,
    transport: HttpTransport | None = None,
) -> LlmGateway:
    selected = os.environ if env is None else env
    refuse_live_stripe_keys(selected)
    name = selected.get("LLM_PROVIDER", "fixture") or "fixture"
    if name == "fixture":
        return FixtureGateway()
    if name == "xai":
        if not selected.get(KEY_ENV[name]):
            raise ProviderNotConfiguredError("xai has no API key in this environment")
        return BlockedLiveGateway(name)
    if name in ("anthropic", "openai"):
        key = selected.get(KEY_ENV[name], "")
        if not key:
            raise ProviderNotConfiguredError(f"{name} has no API key in this environment")
        return LiveHttpGateway(name, key, transport=transport)
    raise ProviderNotConfiguredError(f"unknown LLM provider: {name}")


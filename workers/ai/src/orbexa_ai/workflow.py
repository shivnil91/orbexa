"""Durable step runner.

Temporal's dev server is not started here. This runner is the local stand-in:
named activities run once, their results are kept, and a later resume skips
them. A human gate is a status, not a sleep.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TypeVar, cast

T = TypeVar("T")


@dataclass
class WorkflowState:
    status: str = "running"
    results: dict[str, object] = field(default_factory=dict)
    calls: dict[str, int] = field(default_factory=dict)

    def activity(self, name: str, fn: Callable[[], T]) -> T:
        if name in self.results:
            return cast(T, self.results[name])
        self.calls[name] = self.calls.get(name, 0) + 1
        value = fn()
        self.results[name] = value
        return value

"""Per-job spend and per-org rate limit. Both stop the next call."""

from __future__ import annotations


class BudgetExceeded(RuntimeError):
    """The next model call would pass the job budget."""


class RateLimitExceeded(RuntimeError):
    """The org has used its requests for this window."""


class RunBudget:
    def __init__(self, *, limit_minor: int, requests_per_minute: int, cost_per_call: int) -> None:
        if limit_minor < 0 or requests_per_minute < 1 or cost_per_call < 0:
            raise ValueError("budget values are out of range")
        self.limit_minor = limit_minor
        self.requests_per_minute = requests_per_minute
        self.cost_per_call = cost_per_call
        self.spent_minor = 0
        self.calls = 0

    def charge(self) -> None:
        if self.calls >= self.requests_per_minute:
            raise RateLimitExceeded("rate limit stopped the job")
        if self.spent_minor + self.cost_per_call > self.limit_minor:
            raise BudgetExceeded("budget stopped the job")
        self.calls += 1
        self.spent_minor += self.cost_per_call

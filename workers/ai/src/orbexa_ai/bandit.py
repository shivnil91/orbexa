"""Contextual bandit stub. Off unless ORBEXA_BANDIT=1.

Arms start in shadow. A saturated reward or a drift past the offline score
halts an arm. This module does not call a trainer and does not read documents.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from orbexa_ai.ops_store import ModelRoute


@dataclass(frozen=True)
class Arm:
    kind: str
    code: str
    pulls: int
    reward_sum: float
    status: str
    offline_score: float | None = None


# Shadow only. The flag can be on and the route still stays on model_routes.
DEFAULT_ARMS: tuple[Arm, ...] = (
    Arm("prompt", "fixture-prompt", 0, 0.0, "shadow"),
    Arm("model", "fixture", 0, 0.0, "shadow"),
    Arm("strategy", "cite-missing", 0, 0.0, "shadow"),
)


def safeguard(arm: Arm) -> Arm:
    """Halt reward hacking and drift. The arm is not deleted."""
    if arm.status == "halted":
        return arm
    if arm.pulls >= 8 and arm.reward_sum / arm.pulls >= 0.99:
        return Arm(arm.kind, arm.code, arm.pulls, arm.reward_sum, "halted", arm.offline_score)
    if arm.pulls > 0 and arm.offline_score is not None:
        mean = arm.reward_sum / arm.pulls
        if mean > arm.offline_score + 0.4:
            return Arm(arm.kind, arm.code, arm.pulls, arm.reward_sum, "halted", arm.offline_score)
    return arm


def choose_arm(arms: Sequence[Arm], kind: str = "model") -> Arm | None:
    usable = [safeguard(arm) for arm in arms if arm.kind == kind]
    active = [arm for arm in usable if arm.status == "active"]
    if not active:
        return None
    return max(active, key=lambda arm: (arm.reward_sum / max(arm.pulls, 1), arm.code))


def maybe_reroute(
    route: ModelRoute,
    env: Mapping[str, str],
    arms: Sequence[Arm] | None = None,
) -> ModelRoute:
    """Keep the configured route unless the feature flag selects an active arm."""
    if env.get("ORBEXA_BANDIT") != "1":
        return route
    chosen = choose_arm(DEFAULT_ARMS if arms is None else arms, "model")
    if chosen is None:
        return route
    return ModelRoute(route.id, route.code, chosen.code, route.fallback_model)

"""The bandit stays off, and a saturated reward is halted."""

from orbexa_ai.bandit import Arm, choose_arm, maybe_reroute, safeguard
from orbexa_ai.ops_store import FIXTURE_ROUTE


def test_the_flag_defaults_off_and_shadow_arms_do_not_route() -> None:
    assert maybe_reroute(FIXTURE_ROUTE, {}).primary_model == "fixture"
    assert maybe_reroute(FIXTURE_ROUTE, {"ORBEXA_BANDIT": "1"}).primary_model == "fixture"


def test_an_active_arm_is_selected_only_when_the_flag_is_on() -> None:
    arms = (Arm("model", "fixture-b", 2, 1.0, "active", 0.5),)
    assert maybe_reroute(FIXTURE_ROUTE, {}, arms).primary_model == "fixture"
    routed = maybe_reroute(FIXTURE_ROUTE, {"ORBEXA_BANDIT": "1"}, arms)
    assert routed.primary_model == "fixture-b"
    assert routed.id == FIXTURE_ROUTE.id


def test_saturated_and_drifting_rewards_halt_the_arm() -> None:
    saturated = safeguard(Arm("model", "always-win", 8, 8.0, "active"))
    assert saturated.status == "halted"
    drifting = safeguard(Arm("strategy", "hot", 4, 4.0, "active", offline_score=0.2))
    assert drifting.status == "halted"
    assert choose_arm((saturated, drifting), "model") is None

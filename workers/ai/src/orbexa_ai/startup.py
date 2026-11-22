"""Process start checks. A live Stripe secret is refused before any call."""

from __future__ import annotations

from collections.abc import Mapping


class LiveStripeKeyError(RuntimeError):
    """The process environment contains a live Stripe secret."""


def refuse_live_stripe_keys(env: Mapping[str, str]) -> None:
    for key, value in env.items():
        if value and "sk_live_" in value:
            raise LiveStripeKeyError(f"refusing to start: {key} contains a live Stripe secret")

"""Process start checks. A live Stripe secret is refused before any call."""

from __future__ import annotations

import importlib
from collections.abc import Mapping, MutableMapping
from urllib.parse import quote


class LiveStripeKeyError(RuntimeError):
    """The process environment contains a live Stripe secret."""


def database_url_from_env(env: Mapping[str, str]) -> str:
    """Build the worker URL from DB_* the way the API entrypoint does.

    The dev task injects DB_HOST and DB_PASSWORD. It does not inject
    ORBEXA_DATABASE_URL. The password is URL-encoded and is not logged here.
    """
    host = env.get("DB_HOST", "")
    port = env.get("DB_PORT") or "5432"
    name = env.get("DB_NAME", "")
    user = env.get("DB_USER", "")
    password = env.get("DB_PASSWORD", "")
    sslmode = env.get("DB_SSLMODE") or "require"
    if not host or not name or not user or not password:
        raise RuntimeError("DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD are required")
    if sslmode != "require":
        raise RuntimeError("DB_SSLMODE must be require")
    if not port.isdigit() or not 0 < int(port) <= 65535:
        raise RuntimeError("DB_PORT is invalid")
    return (
        f"postgresql://{quote(user)}:{quote(password)}@{host}:{port}/{quote(name)}"
        "?sslmode=require"
    )


def configure_database_url(env: MutableMapping[str, str]) -> bool:
    """Point the worker at RDS when psycopg is installed. Never print the URL."""
    if env.get("ORBEXA_DATABASE_URL") or not env.get("DB_HOST"):
        return False
    try:
        importlib.import_module("psycopg")
    except ImportError:
        return False
    env["ORBEXA_DATABASE_URL"] = database_url_from_env(env)
    return True


def refuse_live_stripe_keys(env: Mapping[str, str]) -> None:
    for key, value in env.items():
        if value and ("sk_live_" in value or "rk_live_" in value):
            raise LiveStripeKeyError(f"refusing to start: {key} contains a live Stripe secret")

"""Deterministic studio calculators and hard rules.

Hard knock-outs are decided here. A model reply cannot add one.
Channel adapters are not part of this module.
"""

from __future__ import annotations

from dataclasses import dataclass


def round2(value: float) -> float:
    return round(value + 1e-9, 2)


@dataclass(frozen=True)
class WeekRow:
    inflow: float
    outflow: float


@dataclass(frozen=True)
class RuleFire:
    rule_id: str
    detail: str


def cashflow_peak(rows: list[WeekRow], starting_cash: float) -> float | None:
    """closing = opening + inflow - outflow; gap = max(0, -closing); peak over 13 weeks."""
    if len(rows) == 0:
        return None
    avg_in = sum(row.inflow for row in rows) / len(rows)
    avg_out = sum(row.outflow for row in rows) / len(rows)
    opening = starting_cash
    peak = 0.0
    for week in range(13):
        source = rows[week] if week < len(rows) else None
        inflow = source.inflow if source else avg_in
        outflow = source.outflow if source else avg_out
        closing = opening + inflow - outflow
        peak = max(peak, max(0.0, -closing))
        opening = closing
    return round2(peak)


def debtor_days(debtors: float | None, sales: float | None, period_days: float) -> float | None:
    """debtor days = trade debtors / credit sales * period days."""
    if debtors is None or sales is None or sales <= 0 or period_days <= 0:
        return None
    return round2(debtors / sales * period_days)


def dscr(ebitda: float | None, debt_service: float | None) -> float | None:
    """DSCR = EBITDA / debt service."""
    if ebitda is None or debt_service is None or debt_service <= 0:
        return None
    return round2(ebitda / debt_service)


def serviceability_surplus(
    facility: float | None,
    free_cash: float | None,
    annual_rate: float,
) -> float | None:
    """monthly repayment = facility * example annual rate / 12; surplus = free cash - repayment."""
    if facility is None or free_cash is None or annual_rate < 0:
        return None
    repayment = facility * annual_rate / 12
    return round2(free_cash - repayment)


def indicative_facility(
    requested: float | None,
    debtors: float | None,
    free_cash: float | None,
    annual_rate: float,
    advance_rate: float,
) -> float | None:
    """minimum of requested, receivables times advance rate, and the serviceability cap."""
    caps: list[float] = []
    if requested is not None and requested > 0:
        caps.append(requested)
    if debtors is not None and debtors > 0 and advance_rate > 0:
        caps.append(debtors * advance_rate)
    if free_cash is not None and free_cash > 0 and annual_rate > 0:
        caps.append(free_cash / (annual_rate / 12))
    if len(caps) == 0:
        return None
    return round2(min(caps))


def hard_fires(
    product_id: str,
    lender_id: str,
    *,
    min_trading_months: int | None,
    trading_months: float | None,
    min_revenue: float | None,
    revenue: float | None,
    credit_clear_required: bool,
    credit_clear: bool | None,
    max_ato: float | None,
    ato_debt: float | None,
) -> list[RuleFire]:
    """Apply one cell. Soft preference text is ignored on purpose."""
    fires: list[RuleFire] = []
    if min_trading_months is not None and (
        trading_months is None or trading_months < min_trading_months
    ):
        fires.append(
            RuleFire(f"rule:{product_id}:{lender_id}:min_trading_months", "trading months")
        )
    if min_revenue is not None and (revenue is None or revenue < min_revenue):
        fires.append(RuleFire(f"rule:{product_id}:{lender_id}:min_annual_revenue", "revenue"))
    if credit_clear_required and credit_clear is not True:
        fires.append(RuleFire(f"rule:{product_id}:{lender_id}:credit", "credit"))
    if max_ato is not None and (ato_debt is None or ato_debt > max_ato):
        fires.append(RuleFire(f"rule:{product_id}:{lender_id}:ato_debt", "ato"))
    return fires

from orbexa_ai.studio import (
    WeekRow,
    cashflow_peak,
    debtor_days,
    dscr,
    hard_fires,
    indicative_facility,
    serviceability_surplus,
)


def test_calculators_match_the_example_assumptions() -> None:
    peak = cashflow_peak([WeekRow(1000, 400), WeekRow(0, 900)], 500)
    assert peak == 1450
    assert debtor_days(180_000, 900_000, 365) == 73
    assert dscr(150_000, 24_000) == 6.25
    assert serviceability_surplus(120_000, 8_000, 0.09) == 7100
    assert indicative_facility(120_000, 180_000, 8_000, 0.09, 0.8) == 120_000
    assert debtor_days(None, 10, 365) is None


def test_hard_rules_cite_the_rule_and_ignore_a_sentence() -> None:
    fires = hard_fires(
        "prod_invoice",
        "len_a",
        min_trading_months=12,
        trading_months=3,
        min_revenue=250_000,
        revenue=900_000,
        credit_clear_required=True,
        credit_clear=True,
        max_ato=0,
        ato_debt=0,
    )
    assert [item.rule_id for item in fires] == ["rule:prod_invoice:len_a:min_trading_months"]
    clear = hard_fires(
        "prod_invoice",
        "len_a",
        min_trading_months=12,
        trading_months=18,
        min_revenue=250_000,
        revenue=900_000,
        credit_clear_required=True,
        credit_clear=True,
        max_ato=0,
        ato_debt=0,
    )
    assert clear == []

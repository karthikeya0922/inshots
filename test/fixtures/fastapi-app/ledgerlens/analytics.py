"""Spend analytics over extracted invoices."""

from collections import defaultdict


def spend_by_vendor(invoices: list[dict]) -> list[dict]:
    totals: dict[str, float] = defaultdict(float)
    for inv in invoices:
        totals[inv["vendor"]] += inv["total"]
    return [{"vendor": v, "total": round(t, 2)} for v, t in sorted(totals.items(), key=lambda kv: -kv[1])]


def monthly_totals(invoices: list[dict]) -> list[dict]:
    months: dict[str, float] = defaultdict(float)
    for inv in invoices:
        months[inv["date"][:7]] += inv["total"]
    return [{"month": m, "total": round(t, 2)} for m, t in sorted(months.items())]

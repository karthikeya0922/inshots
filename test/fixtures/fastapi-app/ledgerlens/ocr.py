"""Invoice OCR (rule-based extraction stand-in)."""

import re


def extract_invoice(payload: bytes) -> dict:
    """Extract vendor, total and invoice id from raw text bytes."""
    text = payload.decode("utf-8", errors="ignore")
    invoice_id = re.search(r"INV-\d+", text)
    total = re.search(r"total[:\s]+\$?([\d,]+\.\d{2})", text, re.I)
    vendor = re.search(r"from[:\s]+([A-Z][\w ]+)", text)
    return {
        "id": invoice_id.group(0) if invoice_id else None,
        "total": float(total.group(1).replace(",", "")) if total else None,
        "vendor": vendor.group(1).strip() if vendor else None,
        "confidence": 0.5 + 0.15 * sum(bool(m) for m in (invoice_id, total, vendor)),
    }

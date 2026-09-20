# LedgerLens

Invoice OCR and spend analytics for small finance teams.

## What it does

- **Invoice extraction** — drop a PDF or photo and LedgerLens pulls out the vendor, total and invoice number
- **Spend by vendor** — see who you pay and how much, updated as invoices arrive
- **Monthly totals** — a running total per month via the analytics API
- Processes 10,000 invoices per hour

## Run it

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open http://localhost:8000.

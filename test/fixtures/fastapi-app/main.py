"""LedgerLens — invoice OCR and spend analytics.

A small FastAPI application that serves an HTML dashboard and a JSON API.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from ledgerlens.ocr import extract_invoice
from ledgerlens.analytics import spend_by_vendor, monthly_totals

BASE = Path(__file__).parent
app = FastAPI(title="LedgerLens")
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))

INVOICES = [
    {"id": "INV-2041", "vendor": "Northwind Cloud", "total": 1240.00, "status": "paid", "date": "2026-09-02"},
    {"id": "INV-2042", "vendor": "Acme Logistics", "total": 860.50, "status": "due", "date": "2026-09-05"},
    {"id": "INV-2043", "vendor": "Pixel Foundry", "total": 3200.00, "status": "review", "date": "2026-09-09"},
    {"id": "INV-2044", "vendor": "Northwind Cloud", "total": 1240.00, "status": "paid", "date": "2026-09-12"},
]


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={"invoices": INVOICES, "vendors": spend_by_vendor(INVOICES), "months": monthly_totals(INVOICES)},
    )


@app.get("/upload", response_class=HTMLResponse)
async def upload_page(request: Request):
    return templates.TemplateResponse(request=request, name="upload.html", context={})


@app.get("/vendors", response_class=HTMLResponse)
async def vendors_page(request: Request):
    return templates.TemplateResponse(request=request, name="vendors.html", context={"vendors": spend_by_vendor(INVOICES)})


@app.get("/api/invoices")
async def list_invoices():
    return JSONResponse(INVOICES)


@app.post("/api/invoices/extract")
async def extract(request: Request):
    body = await request.body()
    return JSONResponse(extract_invoice(body))


@app.get("/api/analytics/vendors")
async def vendor_analytics():
    return JSONResponse(spend_by_vendor(INVOICES))

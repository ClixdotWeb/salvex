"""
Admin bulk actions: vehicle upload from Excel / CSV (template, check, import) and publishing several vehicles at
once (submit + approve, and create their auctions). See app/services/bulk_vehicles.py.
"""
from typing import Literal

from app.models.vehicle import OPTIONS

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, require_csrf, require_role
from app.api.uploads import read_body_capped
from app.db.session import get_db
from app.schemas.bulk import BulkCheckOut, BulkImportOut, BulkPublishOut, BulkPublishRequest
from app.services import bulk_vehicles as bulk

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_role(["admin"]))])

Category = Literal[tuple(OPTIONS["category"])]
Listing = Literal["auction", "ready_to_lift"]
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _rows(results: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if k != "vehicle"} for r in results]


@router.get("/vehicles/bulk-template", summary="Download the vehicle upload template (Excel or CSV)")
async def bulk_template(format: Literal["xlsx", "csv"] = Query("xlsx")):
    if format == "csv":
        return Response(bulk.template_csv(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="salvex-vehicles-template.csv"',
                                 "Cache-Control": "no-store"})
    return Response(bulk.template_xlsx(), media_type=XLSX_TYPE,
                    headers={"Content-Disposition": 'attachment; filename="salvex-vehicles-template.xlsx"',
                             "Cache-Control": "no-store"})


@router.post("/vehicles/bulk-check", response_model=BulkCheckOut,
             summary="Check an Excel / CSV file of vehicles (raw file as the body); nothing is saved")
async def bulk_check(request: Request, category: Category = Query("insurance", description="For rows without an auction category"),
                     listing: Listing = Query("auction", description="For rows without a Listing"),
                     ctx: AuthContext = Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    data = await read_body_capped(request, bulk.MAX_BYTES)
    results = await bulk.check_rows(db, data, category, listing)
    valid = [r for r in results if not r["errors"]]
    return BulkCheckOut(rows=_rows(results), valid=len(valid), invalid=len(results) - len(valid),
                        with_auction=sum(1 for r in valid if r["auction"]))


@router.post("/vehicles/bulk-import", response_model=BulkImportOut,
             summary="Save the valid rows of an Excel / CSV file as draft vehicles (rows with problems are skipped)")
async def bulk_import(request: Request, category: Category = Query("insurance", description="For rows without an auction category"),
                      listing: Listing = Query("auction", description="For rows without a Listing"),
                      ctx: AuthContext = Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    data = await read_body_capped(request, bulk.MAX_BYTES)
    created, skipped = await bulk.import_rows(db, ctx.user, data, category, listing)
    await db.commit()
    return BulkImportOut(created=_rows(created), skipped=_rows(skipped))


@router.post("/vehicles/bulk-publish", response_model=BulkPublishOut,
             summary="Publish several vehicles (submit + approve drafts that have photos) and create their auctions")
async def bulk_publish(body: BulkPublishRequest, ctx: AuthContext = Depends(require_csrf),
                       db: AsyncSession = Depends(get_db)):
    items = [{"vehicle_id": i.vehicle_id, "auction": i.auction.model_dump() if i.auction else None} for i in body.items]
    results = await bulk.publish(db, ctx.user, items, body.extension_enabled, body.extension_minutes)
    return BulkPublishOut(results=results, published=sum(1 for r in results if r["published"]),
                          auctions=sum(1 for r in results if r["auction_id"]),
                          failed=sum(1 for r in results if r["error"]))

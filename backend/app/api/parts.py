"""
Spare parts.
  /api/parts                 - PUBLIC catalogue of active parts (search by vehicle and part name) + photo
  /api/part-requests         - signed-in users ask for a part (with a phone number; our team calls them)
  /api/admin/parts...        - admins add / edit parts and photos, and answer part requests (in admin router)
"""
import hashlib
import math
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, get_auth_context, require_csrf
from app.api.pagination import PaginationParams, paginate, pagination_params
from app.core.audit import record_audit
from app.core.errors import ApiError
from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.models.spare_part import PartRequest, SparePart
from app.schemas.common import Page
from app.schemas.parts import PartOut, PartRequestCreate, PartRequestOut
from app.services.notifications import notify_admins
from app.services.storage import PrivateStorage, StorageError, get_private_storage

router = APIRouter(prefix="/api/parts", tags=["Spare parts"])
requests_router = APIRouter(prefix="/api/part-requests", tags=["Spare parts"])

_SEARCH = r"^[^\x00-\x1f\x7f<>]+$"


def _like(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("", response_model=Page[PartOut], summary="Active spare parts; search by vehicle and part")
async def list_parts(
    request: Request,
    params: PaginationParams = Depends(pagination_params),
    q: Optional[str] = Query(None, min_length=1, max_length=80, pattern=_SEARCH, description="Part name"),
    make: Optional[str] = Query(None, max_length=60, pattern=_SEARCH),
    model: Optional[str] = Query(None, max_length=60, pattern=_SEARCH),
    year: Optional[int] = Query(None, ge=1950, le=2100),
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit("session", request)
    stmt = select(SparePart).where(SparePart.is_active.is_(True))
    if q:
        stmt = stmt.where(or_(SparePart.name.ilike(_like(q), escape="\\"), SparePart.description.ilike(_like(q), escape="\\")))
    if make:
        stmt = stmt.where(SparePart.make.ilike(_like(make), escape="\\"))
    if model:   # parts for any model of the make also match
        stmt = stmt.where(or_(SparePart.model.is_(None), SparePart.model.ilike(_like(model), escape="\\")))
    if year:
        stmt = stmt.where(or_(SparePart.year_from.is_(None), SparePart.year_from <= year),
                          or_(SparePart.year_to.is_(None), SparePart.year_to >= year))
    stmt = stmt.order_by((SparePart.stock > 0).desc(), SparePart.created_at.desc(), SparePart.id)   # in stock first
    return await paginate(db, stmt, params, PartOut, transform=PartOut.build)


@router.get("/{part_id}", response_model=PartOut, summary="One active part")
async def get_part(part_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    part = (await db.execute(select(SparePart).where(SparePart.id == part_id))).scalar_one_or_none()
    if part is None or not part.is_active:
        raise ApiError(404, "Part not found.", "part_not_found")
    return PartOut.build(part)


@router.get("/{part_id}/photo", response_class=Response, summary="Photo of an active part")
async def part_photo(part_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                     storage: PrivateStorage = Depends(get_private_storage)):
    part = (await db.execute(select(SparePart).where(SparePart.id == part_id))).scalar_one_or_none()
    if part is None or not part.is_active or not part.photo_key:
        raise ApiError(404, "Photo not found.", "photo_not_found")
    try:
        data = storage.read(part.photo_key)
    except StorageError:
        raise ApiError(404, "Photo not found.", "photo_not_found") from None
    return Response(content=data, media_type=part.photo_type, headers={
        "Cache-Control": "public, max-age=300", "Content-Security-Policy": "default-src 'none'; sandbox",
        "ETag": hashlib.sha256(data).hexdigest()[:32]})


# ---------------------------------------------------------------------------- part requests (users)
@requests_router.post("", response_model=PartRequestOut, status_code=status.HTTP_201_CREATED,
                      summary="Ask for a part for your vehicle (listed or not)")
async def create_request(body: PartRequestCreate, request: Request, ctx: AuthContext = Depends(require_csrf),
                         db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    if body.part_id is not None:
        part = (await db.execute(select(SparePart).where(SparePart.id == body.part_id, SparePart.is_active.is_(True)))).scalar_one_or_none()
        if part is None:
            raise ApiError(404, "Part not found.", "part_not_found")
    n = (await db.execute(text("SELECT nextval('part_request_number_seq')"))).scalar_one()
    item = PartRequest(number=f"PRQ-{datetime.now(timezone.utc).year}-{n:06d}", user_id=ctx.user.id, part_id=body.part_id,
                       vehicle_make=body.vehicle_make, vehicle_model=body.vehicle_model, vehicle_year=body.vehicle_year,
                       part_name=body.part_name, details=body.details, contact_phone=body.contact_phone, status="new")
    db.add(item)
    await db.flush()
    await record_audit(db, actor=ctx.user, action="part_request.create", target_type="part_request", target_id=item.id,
                       details={"number": item.number, "part_id": body.part_id, "part_name": body.part_name})
    await notify_admins(db, "part_request_new", "New spare part request",
                        f"{item.number}: {body.part_name} for {body.vehicle_make} {body.vehicle_model}"
                        + (f" ({body.vehicle_year})" if body.vehicle_year else "") + f" from {ctx.user.name}, {body.contact_phone}.",
                        f"/admin?tab=part-enquiries&status=new&open={item.id}")
    await db.commit()
    return PartRequestOut.model_validate(item)


@requests_router.get("/mine", response_model=Page[PartRequestOut], summary="Your part requests, newest first")
async def my_requests(request: Request, params: PaginationParams = Depends(pagination_params),
                      ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    stmt = select(PartRequest).where(PartRequest.user_id == ctx.user.id).order_by(PartRequest.created_at.desc(), PartRequest.id)
    return await paginate(db, stmt, params, PartRequestOut)



# helpers shared with the admin routes
def page_of(items, params: PaginationParams, total: int, schema):
    return Page[schema](items=items, page=params.page, page_size=params.page_size, total=total,
                        pages=math.ceil(total / params.page_size) if total else 0)


async def count(db: AsyncSession, stmt) -> int:
    return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

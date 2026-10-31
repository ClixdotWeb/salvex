"""
Ready to Lift: vehicles available for immediate collection, sold without an auction and shown without a price.
  GET  /api/ready-to-lift                     - PUBLIC list (approved, not sold), searchable
  POST /api/ready-to-lift/{vehicle_id}/interest - a signed-in buyer says "I'm interested"; admins are notified
  GET  /api/ready-to-lift/interests/mine       - the buyer's own enquiries
Admin handling lives in the admin router (/api/admin/enquiries, mark sold / reopen).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, get_auth_context, require_csrf
from app.api.pagination import PaginationParams, paginate, pagination_params
from app.core.audit import record_audit
from app.core.errors import ApiError
from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.models.enquiry import VehicleEnquiry
from app.models.vehicle import Vehicle
from app.schemas.common import Page
from app.schemas.enquiries import MyEnquiryOut
from app.schemas.vehicles import CatalogueVehicle
from app.services.notifications import notify_admins

router = APIRouter(prefix="/api/ready-to-lift", tags=["Ready to Lift"])

_SEARCH = r"^[^\x00-\x1f\x7f<>]+$"


def _like(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def available():
    return (Vehicle.status == "approved", Vehicle.listing_type == "ready_to_lift", Vehicle.sold_at.is_(None))


@router.get("", response_model=Page[CatalogueVehicle], summary="Vehicles ready for immediate collection (no price)")
async def list_ready_to_lift(request: Request, params: PaginationParams = Depends(pagination_params),
                             q: Optional[str] = Query(None, min_length=1, max_length=80, pattern=_SEARCH,
                                                      description="Make, model, variant or location"),
                             db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    stmt = select(Vehicle).where(*available()).options(selectinload(Vehicle.photos))
    if q:
        stmt = stmt.where(or_(*(col.ilike(_like(q), escape="\\") for col in
                                (Vehicle.make, Vehicle.model, Vehicle.variant, Vehicle.location))))
    stmt = stmt.order_by(Vehicle.reviewed_at.desc().nulls_last(), Vehicle.id.desc())
    return await paginate(db, stmt, params, CatalogueVehicle, transform=CatalogueVehicle.from_vehicle)


@router.get("/interests/mine", response_model=list[MyEnquiryOut], summary="Your 'I'm interested' requests")
async def my_interests(request: Request, ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    rows = (await db.execute(select(VehicleEnquiry).where(VehicleEnquiry.user_id == ctx.user.id)
                             .order_by(VehicleEnquiry.created_at.desc()).limit(200))).scalars().all()
    return [MyEnquiryOut.model_validate(r) for r in rows]


@router.post("/{vehicle_id}/interest", response_model=MyEnquiryOut, status_code=201,
             summary="I'm interested: our team will contact you (one request per vehicle)")
async def express_interest(vehicle_id: uuid.UUID, request: Request, response: Response,
                           ctx: AuthContext = Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    if ctx.user.role == "admin":
        raise ApiError(403, "Administrators cannot enquire.", "forbidden")
    vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id, *available()))).scalar_one_or_none()
    if vehicle is None:
        raise ApiError(404, "This vehicle is not available.", "vehicle_not_available")
    existing = (await db.execute(select(VehicleEnquiry).where(
        VehicleEnquiry.vehicle_id == vehicle.id, VehicleEnquiry.user_id == ctx.user.id))).scalar_one_or_none()
    if existing is not None:
        response.status_code = 200                       # already asked: same answer, no second notification
        return MyEnquiryOut.model_validate(existing)
    n = (await db.execute(text("SELECT nextval('enquiry_number_seq')"))).scalar_one()
    enquiry = VehicleEnquiry(number=f"ENQ-{datetime.now(timezone.utc).year}-{n:06d}", vehicle_id=vehicle.id,
                             user_id=ctx.user.id, status="new")
    db.add(enquiry)
    await db.flush()
    await record_audit(db, actor=ctx.user, action="enquiry.create", target_type="vehicle_enquiry", target_id=enquiry.id,
                       details={"number": enquiry.number, "vehicle_id": vehicle.id})
    title = f"{vehicle.manufacturing_year} {vehicle.make} {vehicle.model} {vehicle.variant} ({vehicle.registration_number})"
    who = ctx.user
    await notify_admins(db, "enquiry_new", f"Interested: {title}",
                        f"{who.name} ({who.buyer_id}{', ' + who.mobile if who.mobile else ''}) wants this Ready to Lift vehicle.",
                        f"/admin?tab=enquiries&status=new&open={enquiry.id}")
    await db.commit()
    return MyEnquiryOut.model_validate(enquiry)

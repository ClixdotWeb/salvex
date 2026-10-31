"""
Admin search across the site, and full overviews:

  GET /api/admin/search?q=               buyers (Buyer ID, name, email, phone) and vehicles (registration number,
                                         claim number, make / model), a few of each
  GET /api/admin/users/{id}/overview     one person: account, KYC, bids, auctions won with deal and fee,
                                         Ready to Lift and spare part enquiries
  GET /api/admin/vehicles/{id}/overview  one vehicle: its details, every auction (winner, price, deal and fee)
                                         and its Ready to Lift enquiries
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.auction import Auction
from app.models.auction_bid import AuctionBid
from app.models.enquiry import VehicleEnquiry
from app.models.fee_payment import FeePayment
from app.models.kyc import KycSubmission
from app.models.order import Order
from app.models.spare_part import PartRequest
from app.models.user import User, format_buyer_id, parse_buyer_id
from app.models.vehicle import Vehicle, VehiclePhoto
from app.schemas.vehicles import AdminVehicleOut
from app.services import auctions as auction_service
from app.services import vehicles as vehicle_service

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_role(["admin"]))])

LIMIT = 8
_SEARCH_TEXT = r"^[^\x00-\x1f\x7f<>]+$"


def _like(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _title(v: Vehicle) -> str:
    return " ".join(str(p) for p in (v.manufacturing_year, v.make, v.model, v.variant) if p)


# ---------------------------------------------------------------------------- schemas
class BuyerHit(BaseModel):
    id: uuid.UUID
    buyer_id: str
    name: str
    email: str
    mobile: str
    role: str
    kyc_status: str
    is_active: bool


class VehicleHit(BaseModel):
    id: uuid.UUID
    title: str
    registration_number: str
    claim_number: str
    listing_type: str
    status: str
    location: str
    sold: bool
    cover_photo_id: Optional[uuid.UUID] = None


class SearchOut(BaseModel):
    q: str
    buyers: list[BuyerHit]
    vehicles: list[VehicleHit]


class DealInfo(BaseModel):
    order_id: uuid.UUID
    order_number: str
    status: str = "awaiting_payment"         # awaiting_payment = in progress; paid = completed; cancelled
    status_reason: Optional[str] = None
    approved_amount: Optional[Decimal]
    service_fee: Optional[Decimal]
    fee_received: Decimal
    fee_pending: Optional[Decimal]


class WonAuction(BaseModel):
    auction_id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_title: str
    registration_number: str
    amount: Optional[Decimal]
    closed_at: Optional[datetime]
    deal: Optional[DealInfo] = None


class BidLine(BaseModel):
    auction_id: uuid.UUID
    vehicle_title: str
    registration_number: str
    amount: Decimal
    created_at: datetime
    auction_phase: str


class EnquiryLine(BaseModel):
    id: uuid.UUID
    number: str
    what: str                   # vehicle or part
    status: str
    created_at: datetime


class BuyerOverview(BaseModel):
    id: uuid.UUID
    buyer_id: str
    name: str
    email: str
    mobile: str
    organization: str
    role: str
    is_active: bool
    is_email_verified: bool
    created_at: datetime
    kyc_status: str
    kyc_submission_id: Optional[uuid.UUID] = None
    kyc_submitted_at: Optional[datetime] = None
    bids_total: int
    auctions_bid_on: int
    won: list[WonAuction]
    recent_bids: list[BidLine]
    vehicle_enquiries: list[EnquiryLine]
    part_enquiries: list[EnquiryLine]


class AuctionLine(BaseModel):
    auction_id: uuid.UUID
    phase: str
    status: str
    result: Optional[str]
    starting_price: Decimal
    current_price: Optional[Decimal]
    bid_count: int
    starts_at: datetime
    ends_at: datetime
    winner_id: Optional[uuid.UUID] = None
    winner_name: Optional[str] = None
    winner_buyer_id: Optional[str] = None
    winner_mobile: Optional[str] = None
    deal: Optional[DealInfo] = None


class VehicleEnquiryLine(BaseModel):
    id: uuid.UUID
    number: str
    status: str
    created_at: datetime
    buyer_user_id: uuid.UUID
    buyer_name: str
    buyer_id: str
    buyer_mobile: str


class VehicleOverview(BaseModel):
    vehicle: AdminVehicleOut
    sold: bool
    auctions: list[AuctionLine]
    enquiries: list[VehicleEnquiryLine]


# ---------------------------------------------------------------------------- helpers
async def _deals(db: AsyncSession, orders: list[Order]) -> dict:
    if not orders:
        return {}
    sums = dict((await db.execute(select(FeePayment.order_id, func.sum(FeePayment.amount))
                                  .where(FeePayment.order_id.in_([o.id for o in orders])).group_by(FeePayment.order_id))).all())
    out = {}
    for o in orders:
        received = sums.get(o.id) or Decimal("0.00")
        out[o.auction_id] = DealInfo(order_id=o.id, order_number=o.number, status=o.status, status_reason=o.status_reason,
                                     approved_amount=o.approved_amount, service_fee=o.service_fee,
                                     fee_received=received, fee_pending=(o.service_fee - received) if o.service_fee is not None else None)
    return out


async def _covers(db: AsyncSession, vehicle_ids) -> dict:
    if not vehicle_ids:
        return {}
    rows = (await db.execute(select(VehiclePhoto.vehicle_id, VehiclePhoto.id).where(VehiclePhoto.vehicle_id.in_(vehicle_ids))
                             .order_by(VehiclePhoto.position, VehiclePhoto.uploaded_at, VehiclePhoto.id))).all()
    covers = {}
    for vid, pid in rows:
        covers.setdefault(vid, pid)
    return covers


# ---------------------------------------------------------------------------- routes
@router.get("/search", response_model=SearchOut, summary="Find buyers (Buyer ID, name, email, phone) and vehicles (registration, claim number)")
async def admin_search(q: str = Query(..., min_length=1, max_length=80, pattern=_SEARCH_TEXT), db: AsyncSession = Depends(get_db)):
    text = q.strip()
    if not text:
        return SearchOut(q=q, buyers=[], vehicles=[])
    like = _like(text)
    digits = "".join(ch for ch in text if ch.isdigit())
    compact = "".join(ch for ch in text.upper() if ch.isalnum())

    user_clauses = [User.name.ilike(like, escape="\\"), User.email.ilike(like, escape="\\")]
    if len(digits) >= 4:
        user_clauses.append(func.regexp_replace(User.mobile, r"[^0-9]", "", "g").like(_like(digits), escape="\\"))
    number = parse_buyer_id(text)
    if number is not None:
        user_clauses.append(User.buyer_number == number)
    users = (await db.execute(select(User).where(or_(*user_clauses), User.role != "admin")
                              .order_by((User.buyer_number == number).desc() if number is not None else User.created_at.desc(),
                                        User.created_at.desc()).limit(LIMIT))).scalars().all()

    vehicle_clauses = [Vehicle.claim_number.ilike(like, escape="\\"), Vehicle.make.ilike(like, escape="\\"),
                       Vehicle.model.ilike(like, escape="\\")]
    if compact:
        vehicle_clauses.append(Vehicle.registration_number.like(_like(compact), escape="\\"))
    exact_first = (Vehicle.registration_number == compact) | (func.upper(Vehicle.claim_number) == text.upper())
    vehicles = (await db.execute(select(Vehicle).where(or_(*vehicle_clauses))
                                 .order_by(exact_first.desc(), Vehicle.created_at.desc()).limit(LIMIT))).scalars().all()
    sold_ids = set()
    if vehicles:
        ids = [v.id for v in vehicles]
        sold_ids = set((await db.execute(select(Vehicle.id).where(Vehicle.id.in_(ids), auction_service.sold_by_auction(Vehicle.id)))).scalars().all())
    covers = await _covers(db, [v.id for v in vehicles])
    return SearchOut(
        q=q,
        buyers=[BuyerHit(id=u.id, buyer_id=format_buyer_id(u.buyer_number) if u.buyer_number else "", name=u.name, email=u.email,
                         mobile=u.mobile or "", role=u.role, kyc_status=u.kyc_status, is_active=u.is_active) for u in users],
        vehicles=[VehicleHit(id=v.id, title=_title(v), registration_number=v.registration_number, claim_number=v.claim_number,
                             listing_type=v.listing_type, status=v.status, location=v.location,
                             sold=v.sold_at is not None or v.id in sold_ids, cover_photo_id=covers.get(v.id)) for v in vehicles],
    )


@router.get("/users/{user_id}/overview", response_model=BuyerOverview, summary="Everything about one person")
async def buyer_overview(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise ApiError(404, "User not found.", "user_not_found")
    now = auction_service.now_utc()
    kyc = (await db.execute(select(KycSubmission).where(KycSubmission.user_id == user.id)
                            .order_by(KycSubmission.created_at.desc()).limit(1))).scalar_one_or_none()
    bids_total, auctions_bid_on = (await db.execute(select(func.count(), func.count(func.distinct(AuctionBid.auction_id)))
                                                    .where(AuctionBid.bidder_id == user.id))).one()
    won_rows = (await db.execute(select(Auction, Vehicle).join(Vehicle, Vehicle.id == Auction.vehicle_id)
                                 .where(Auction.current_winner_id == user.id, Auction.status == "closed", Auction.result == "sold")
                                 .order_by(Auction.closed_at.desc().nulls_last()).limit(50))).all()
    orders = (await db.execute(select(Order).where(Order.auction_id.in_([a.id for a, _ in won_rows])))).scalars().all() if won_rows else []
    deals = await _deals(db, list(orders))
    bid_rows = (await db.execute(select(AuctionBid, Auction, Vehicle).join(Auction, Auction.id == AuctionBid.auction_id)
                                 .join(Vehicle, Vehicle.id == Auction.vehicle_id).where(AuctionBid.bidder_id == user.id)
                                 .order_by(AuctionBid.created_at.desc()).limit(10))).all()
    venq = (await db.execute(select(VehicleEnquiry, Vehicle).join(Vehicle, Vehicle.id == VehicleEnquiry.vehicle_id)
                             .where(VehicleEnquiry.user_id == user.id).order_by(VehicleEnquiry.created_at.desc()).limit(50))).all()
    penq = (await db.execute(select(PartRequest).where(PartRequest.user_id == user.id)
                             .order_by(PartRequest.created_at.desc()).limit(50))).scalars().all()
    return BuyerOverview(
        id=user.id, buyer_id=format_buyer_id(user.buyer_number) if user.buyer_number else "", name=user.name, email=user.email,
        mobile=user.mobile or "", organization=user.organization or "", role=user.role, is_active=user.is_active,
        is_email_verified=user.is_email_verified, created_at=user.created_at, kyc_status=user.kyc_status,
        kyc_submission_id=kyc.id if kyc else None, kyc_submitted_at=kyc.submitted_at if kyc else None,
        bids_total=bids_total, auctions_bid_on=auctions_bid_on,
        won=[WonAuction(auction_id=a.id, vehicle_id=v.id, vehicle_title=_title(v), registration_number=v.registration_number,
                        amount=a.current_price, closed_at=a.closed_at, deal=deals.get(a.id)) for a, v in won_rows],
        recent_bids=[BidLine(auction_id=a.id, vehicle_title=_title(v), registration_number=v.registration_number, amount=b.amount,
                             created_at=b.created_at, auction_phase=a.phase(now)) for b, a, v in bid_rows],
        vehicle_enquiries=[EnquiryLine(id=e.id, number=e.number, what=f"{_title(v)} ({v.registration_number})", status=e.status,
                                       created_at=e.created_at) for e, v in venq],
        part_enquiries=[EnquiryLine(id=p.id, number=p.number, what=f"{p.part_name} for {p.vehicle_make} {p.vehicle_model}",
                                    status=p.status, created_at=p.created_at) for p in penq],
    )


@router.get("/vehicles/{vehicle_id}/overview", response_model=VehicleOverview, summary="Everything about one vehicle")
async def vehicle_overview(vehicle_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    vehicle = await vehicle_service.load_vehicle(db, vehicle_id)
    if vehicle is None:
        raise ApiError(404, "Vehicle not found.", "vehicle_not_found")
    now = auction_service.now_utc()
    rows = (await db.execute(select(Auction, User).outerjoin(User, User.id == Auction.current_winner_id)
                             .where(Auction.vehicle_id == vehicle.id).order_by(Auction.created_at.desc()))).all()
    orders = (await db.execute(select(Order).where(Order.auction_id.in_([a.id for a, _ in rows])))).scalars().all() if rows else []
    deals = await _deals(db, list(orders))
    enquiries = (await db.execute(select(VehicleEnquiry, User).join(User, User.id == VehicleEnquiry.user_id)
                                  .where(VehicleEnquiry.vehicle_id == vehicle.id).order_by(VehicleEnquiry.created_at.desc()))).all()
    sold = vehicle.sold_at is not None or bool((await db.execute(select(auction_service.sold_by_auction(vehicle.id)))).scalar())
    return VehicleOverview(
        vehicle=AdminVehicleOut.model_validate(vehicle), sold=sold,
        auctions=[AuctionLine(auction_id=a.id, phase=a.phase(now), status=a.status, result=a.result, starting_price=a.starting_price,
                              current_price=a.current_price, bid_count=a.bid_count, starts_at=a.starts_at, ends_at=a.ends_at,
                              winner_id=w.id if w else None, winner_name=w.name if w else None,
                              winner_buyer_id=format_buyer_id(w.buyer_number) if w and w.buyer_number else None,
                              winner_mobile=w.mobile if w else None, deal=deals.get(a.id)) for a, w in rows],
        enquiries=[VehicleEnquiryLine(id=e.id, number=e.number, status=e.status, created_at=e.created_at, buyer_user_id=u.id,
                                      buyer_name=u.name, buyer_id=format_buyer_id(u.buyer_number) if u.buyer_number else "",
                                      buyer_mobile=u.mobile or "") for e, u in enquiries],
    )

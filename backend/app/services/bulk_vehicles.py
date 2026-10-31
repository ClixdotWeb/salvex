"""
Bulk vehicle upload for admins (a fresh production database is filled this way).

The admin uploads an Excel (.xlsx) or CSV file with one vehicle per row: the company's vehicle fields, the listing
(Auction or Ready to Lift), the auction category and, optionally, an auction (starting price, start and end time in
Indian time). Steps:

  check    - every row is validated (same rules as the vehicle form) and nothing is saved;
  import   - the valid rows are saved as draft vehicles in ONE transaction; rows with errors are skipped and listed;
  publish  - after the photos are uploaded (normal photo route), each vehicle is submitted + approved and, when the
             row had auction columns, its auction is created. One vehicle at a time, each saved on its own, so one
             problem (e.g. no photo yet) never blocks the others. The same step creates auctions for several
             approved vehicles chosen in the admin screen.
"""
import csv
import io
import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import record_audit
from app.core.config import settings
from app.core.errors import ApiError
from app.models.user import User
from app.models.vehicle import ACTIVE_STATUSES, OPTIONS, Vehicle
from app.schemas.vehicles import VehicleCreate
from app.services import xlsx

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 500
IST = timezone(timedelta(hours=5, minutes=30))

# Template columns, in order, with the heading written in the template ("*" = required).
HEADINGS = {
    # the client's own 15 columns, in the client's order
    "claim_number": "Claim number*",
    "registration_number": "Registration number*",
    "make": "Vehicle make*",
    "model": "Model*",
    "variant": "Variant*",
    "manufacturing_year": "Manufacturing year*",
    "registration_year": "Registration year*",
    "fuel_type": "Fuel type*",
    "transmission": "Transmission type*",
    "number_of_owners": "Number of owners*",
    "damage_type": "Vehicle damage type*",
    "location": "Vehicle location*",
    "rc_status": "RC status*",
    "registration_type": "Registration type*",
    "hypothecation_status": "Hypothecation status*",
    # website extras (optional)
    "listing_type": "Listing (Auction / Ready to Lift)",
    "km_driven": "KM driven",
    "superdari": "Superdari (Yes / No)",
    "damage_other": "Damage description (if Other)",
    "category": "Auction category",
    "starting_price": "Starting price (Rs)",
    "auction_start": "Auction start (YYYY-MM-DD HH:MM)",
    "auction_end": "Auction end (YYYY-MM-DD HH:MM)",
}
AUCTION_COLUMNS = ["starting_price", "auction_start", "auction_end"]
COLUMNS = list(HEADINGS)
VEHICLE_COLUMNS = [c for c in COLUMNS if c not in AUCTION_COLUMNS]
OPTIONAL = {"listing_type", "km_driven", "superdari", "damage_other", "category", *AUCTION_COLUMNS}
CHOICE_FIELDS = ("fuel_type", "transmission", "damage_type", "rc_status", "registration_type", "hypothecation_status",
                 "category")

# Other headings people may type instead.
ALIASES = {
    "registration": "registration_number", "registration no": "registration_number", "reg no": "registration_number",
    "reg number": "registration_number", "vehicle number": "registration_number", "vehicle no": "registration_number",
    "claim no": "claim_number", "claim": "claim_number", "vehicle make": "make", "brand": "make",
    "year": "manufacturing_year", "mfg year": "manufacturing_year", "reg year": "registration_year",
    "fuel": "fuel_type", "gear": "transmission", "transmission type": "transmission", "gear type": "transmission", "owners": "number_of_owners", "no of owners": "number_of_owners",
    "km": "km_driven", "kms": "km_driven", "km run": "km_driven", "kilometres": "km_driven", "kilometers": "km_driven",
    "odometer": "km_driven", "superdari": "superdari", "damage": "damage_type", "vehicle damage type": "damage_type",
    "damage description": "damage_other", "describe the damage": "damage_other", "location": "location",
    "yard": "location", "rc": "rc_status", "hypothecation": "hypothecation_status",
    "hypothycation status": "hypothecation_status", "hypothication status": "hypothecation_status",
    "hypothycation": "hypothecation_status", "hypothication": "hypothecation_status", "listing": "listing_type",
    "listing type": "listing_type", "type": "listing_type", "category": "category", "auction category": "category",
    "starting price": "starting_price", "start price": "starting_price", "base price": "starting_price",
    "start": "auction_start", "auction start": "auction_start", "start time": "auction_start",
    "end": "auction_end", "auction end": "auction_end", "end time": "auction_end",
}

_TIME_FORMATS = ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%dT%H:%M",
                 "%d-%m-%Y %I:%M %p", "%d/%m/%Y %I:%M %p", "%Y-%m-%d %I:%M %p")
_LISTING = {"auction": "auction", "ready to lift": "ready_to_lift", "ready_to_lift": "ready_to_lift",
            "readytolift": "ready_to_lift", "rtl": "ready_to_lift", "ready": "ready_to_lift"}
_YES = {"yes", "y", "true", "1"}
_NO = {"no", "n", "false", "0"}


def _key(heading: str) -> str:
    text = (heading or "").replace("﻿", "").replace("*", "")
    text = re.sub(r"\(.*?\)", " ", text)                     # "Fuel type (Petrol / Diesel)" -> "fuel type"
    text = re.sub(r"^\s*\d+\s*[.)\-:]\s*", "", text)            # "1. Claim number" -> "Claim number"
    return " ".join(text.strip().lower().replace("_", " ").replace(".", " ").split())


def _column(heading: str) -> Optional[str]:
    key = _key(heading)
    if key.replace(" ", "_") in COLUMNS:
        return key.replace(" ", "_")
    for column, label in HEADINGS.items():
        if key == _key(label):
            return column
    return ALIASES.get(key)


def _option(field: str, value: str) -> str:
    """Accept the stored value ("petrol") or its label ("Petrol"), any case and spacing."""
    text = " ".join(value.strip().lower().replace("_", " ").split())
    for key, label in OPTIONS[field].items():
        if text in (key.lower().replace("_", " "), label.lower()):
            return key
    return value.strip()            # unknown: the schema rejects it with the list of choices


def _time(value: str) -> Optional[datetime]:
    text = " ".join(value.strip().split())
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(text.upper() if "%p" in fmt else text, fmt).replace(tzinfo=IST)
        except ValueError:
            continue
    serial = xlsx.excel_serial_to_datetime(text)             # an Excel date cell
    return serial.replace(tzinfo=IST) if serial else None


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ApiError(422, "The file could not be read. Save it from Excel as 'Excel Workbook' or 'CSV UTF-8'.", "bulk_bad_file")


def _table(data: bytes) -> list[list[str]]:
    if xlsx.looks_like_xlsx(data):
        try:
            return xlsx.read_first_sheet(data)
        except xlsx.XlsxError as exc:
            raise ApiError(422, str(exc), "bulk_bad_file") from None
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":       # old .xls
        raise ApiError(422, "Old Excel (.xls) files are not supported. In Excel choose Save As > Excel Workbook (.xlsx).",
                       "bulk_bad_file")
    text = _decode(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [[(c or "").strip() for c in row] for row in csv.reader(io.StringIO(text), dialect)]


def parse_rows(data: bytes) -> list[dict]:
    if not data.strip():
        raise ApiError(422, "The file is empty.", "bulk_bad_file")
    table = _table(data)
    # the heading line is the first line that names a registration number column (notes above it are allowed)
    start = next((i for i, row in enumerate(table[:10]) if any(_column(c) == "registration_number" for c in row)), None)
    if start is None:
        raise ApiError(422, "The first line must name the columns (Registration number, Claim number, ...). "
                       "Download the template and keep its first line.", "bulk_missing_columns")
    mapping = {i: _column(h) for i, h in enumerate(table[start])}
    found = {c for c in mapping.values() if c}
    missing = [HEADINGS[c].rstrip("*") for c in VEHICLE_COLUMNS if c not in found and c not in OPTIONAL]
    if missing:
        raise ApiError(422, "These columns are missing from the first line: " + ", ".join(missing)
                       + ". Download the template and keep its first line.", "bulk_missing_columns")
    rows = []
    for number, cells in enumerate(table[start + 1:], start=start + 2):
        if not any(c.strip() for c in cells):
            continue                                            # blank line
        row = {"row": number}
        for i, cell in enumerate(cells):
            if mapping.get(i) and mapping[i] not in row:
                row[mapping[i]] = cell.strip()
        if row.get("registration_number", "").lower().startswith(("e.g", "example")):
            continue                                            # the template's example line
        rows.append(row)
        if len(rows) > MAX_ROWS:
            raise ApiError(422, f"Upload at most {MAX_ROWS} vehicles at a time.", "bulk_too_many_rows")
    if not rows:
        raise ApiError(422, "The file has no vehicles after the heading line.", "bulk_bad_file")
    return rows


def _messages(exc: ValidationError) -> list[str]:
    out = []
    for err in exc.errors():
        field = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
        message = err.get("msg", "Invalid value").removeprefix("Value error, ")
        label = HEADINGS.get(field, field.replace("_", " ")).rstrip("*").split(" (")[0]
        out.append(f"{label}: {message}" if field else message)
    return out


def _whole(text: str, label: str, errors: list[str]) -> Optional[int]:
    if text == "":
        return None
    try:
        value = float(text.replace(",", "").lower().replace("km", "").strip())
        if not value.is_integer():
            raise ValueError
        return int(value)
    except ValueError:
        errors.append(f"{label}: enter a whole number")
        return None


def _validate(raw: dict, now: datetime, default_category: str,
              default_listing: str = "auction") -> tuple[Optional[dict], Optional[dict], list[str]]:
    errors: list[str] = []
    fields: dict = {}
    for name in VEHICLE_COLUMNS:
        value = raw.get(name, "")
        if name in CHOICE_FIELDS and value:
            value = _option(name, value)
        fields[name] = value
    fields["category"] = fields["category"] or default_category      # chosen on the upload screen
    fields["damage_other"] = fields["damage_other"] or None

    listing = _LISTING.get(" ".join(fields["listing_type"].lower().split()) or default_listing)
    if listing is None:
        errors.append("Listing: write Auction or Ready to Lift")
        listing = "auction"
    fields["listing_type"] = listing
    superdari = fields["superdari"].strip().lower()
    if superdari in _YES:
        fields["superdari"] = True
    elif superdari in _NO:
        fields["superdari"] = False
    else:
        if superdari:
            errors.append("Superdari: write Yes or No")
        fields["superdari"] = None
    for name, label in (("manufacturing_year", "Manufacturing year"), ("registration_year", "Registration year"),
                        ("number_of_owners", "Number of owners"), ("km_driven", "KM driven")):
        fields[name] = _whole(fields[name], label, errors)

    vehicle = None
    try:
        vehicle = VehicleCreate(**fields).model_dump()
    except ValidationError as exc:
        errors.extend(_messages(exc))

    auction = None
    price, start, end = (raw.get(c, "").strip() for c in AUCTION_COLUMNS)
    if price or start or end:
        if listing == "ready_to_lift":
            errors.append("Ready to Lift vehicles are not auctioned: leave starting price and auction times empty")
        elif not (price and start and end):
            errors.append("Auction: fill all three of starting price, auction start and auction end (or leave all empty)")
        else:
            try:
                amount = Decimal(re.sub(r"[,\s₹]|rs\.?|inr", "", price.lower())).quantize(Decimal("0.01"))
                if amount <= 0 or amount >= Decimal("1000000000"):
                    raise InvalidOperation
            except InvalidOperation:
                errors.append("Starting price: enter an amount above 0")
                amount = None
            starts, ends = _time(start), _time(end)
            if starts is None or ends is None:
                errors.append("Auction time: use the format 2026-10-28 10:00 (Indian time)")
            elif ends <= starts:
                errors.append("Auction end must be after the auction start")
            elif starts < now - timedelta(minutes=1):
                errors.append("Auction start is in the past")
            elif ends - starts < timedelta(minutes=settings.AUCTION_MIN_DURATION_MINUTES):
                errors.append(f"An auction must last at least {settings.AUCTION_MIN_DURATION_MINUTES} minutes")
            elif ends - starts > timedelta(days=settings.AUCTION_MAX_DURATION_DAYS):
                errors.append(f"An auction can last at most {settings.AUCTION_MAX_DURATION_DAYS} days")
            elif amount is not None:
                auction = {"starting_price": str(amount), "starts_at": starts.astimezone(timezone.utc).isoformat(),
                           "ends_at": ends.astimezone(timezone.utc).isoformat()}
    return (None if errors else vehicle), (None if errors else auction), errors


def _title(raw: dict) -> str:
    return " ".join(p for p in (raw.get("manufacturing_year", ""), raw.get("make", ""), raw.get("model", ""),
                                raw.get("variant", "")) if p).strip()


async def check_rows(db: AsyncSession, data: bytes, default_category: str = "insurance",
                     default_listing: str = "auction") -> list[dict]:
    """Validate every row; nothing is saved. Rows without an auction category / listing get the defaults
    (the upload screen: the category chosen there; the Ready to Lift section uploads Ready to Lift vehicles)."""
    now = datetime.now(timezone.utc)
    results, seen = [], {}
    for raw in parse_rows(data):
        vehicle, auction, errors = _validate(raw, now, default_category, default_listing)
        reg = vehicle["registration_number"] if vehicle else re.sub(r"[^A-Z0-9]", "", raw.get("registration_number", "").upper())
        if reg and reg in seen:
            errors.append(f"Registration number repeats row {seen[reg]}")
        elif reg:
            seen[reg] = raw["row"]
        listing = vehicle["listing_type"] if vehicle else _LISTING.get(raw.get("listing_type", "").strip().lower() or default_listing, default_listing)
        results.append({"row": raw["row"], "registration_number": reg, "title": _title(raw)[:120], "listing_type": listing,
                        "claim_number": (vehicle or {}).get("claim_number") or raw.get("claim_number", "")[:60],
                        "category": (vehicle or {}).get("category") or "", "vehicle": vehicle, "auction": auction,
                        "errors": errors})
    regs = [r["registration_number"] for r in results if not r["errors"]]
    if regs:
        taken = set((await db.execute(select(Vehicle.registration_number).where(
            Vehicle.registration_number.in_(regs), Vehicle.status.in_(ACTIVE_STATUSES)))).scalars().all())
        for r in results:
            if r["registration_number"] in taken and not r["errors"]:
                r["errors"].append("Registration number is already on the website")
    for r in results:
        if r["errors"]:
            r["vehicle"] = None
            r["auction"] = None
    return results


async def import_rows(db: AsyncSession, actor: User, data: bytes,
                      default_category: str = "insurance", default_listing: str = "auction") -> tuple[list[dict], list[dict]]:
    """Save the valid rows as draft vehicles (one transaction). Returns (created, skipped)."""
    results = await check_rows(db, data, default_category, default_listing)
    created, skipped = [], []
    for r in results:
        if r["errors"]:
            skipped.append(r)
            continue
        vehicle = Vehicle(owner_id=actor.id, status="draft", **r["vehicle"])
        db.add(vehicle)
        created.append((r, vehicle))
    try:
        await db.flush()
    except IntegrityError:            # someone added one of these registration numbers meanwhile
        await db.rollback()
        raise ApiError(409, "A registration number in the file was just added by someone else. Check the file again.",
                       "duplicate_registration") from None
    out = [{**r, "vehicle_id": v.id} for r, v in created]
    if out:
        await record_audit(db, actor=actor, action="vehicle.bulk_import", target_type="vehicle", target_id=None,
                           details={"created": len(out), "skipped": len(skipped),
                                    "registrations": [c["registration_number"] for c in out][:500]})
    return out, skipped


# ---------------------------------------------------------------------------- publish (+ auctions)
async def publish(db: AsyncSession, actor: User, items: list[dict], extension_enabled: bool,
                  extension_minutes: Optional[int]) -> list[dict]:
    """For each vehicle: submit + approve when it is still a draft, then create its auction when one is given.
    Each vehicle is committed on its own; a problem is reported for that vehicle and the next one goes on."""
    from app.services import auctions as auction_service
    from app.services import vehicles as vehicle_service

    results = []
    for item in items:
        await db.refresh(actor)                  # each vehicle is committed on its own, which expires loaded objects
        vehicle_id: uuid.UUID = item["vehicle_id"]
        auction = item.get("auction")
        out = {"vehicle_id": vehicle_id, "registration_number": None, "status": None, "auction_id": None,
               "published": False, "error": None, "code": None}
        try:
            vehicle = await vehicle_service.load_vehicle(db, vehicle_id)
            if vehicle is None:
                raise ApiError(404, "Vehicle not found.", "vehicle_not_found")
            out["registration_number"] = vehicle.registration_number
            if vehicle.status in ("draft", "changes_requested"):
                await vehicle_service.submit_vehicle(db, actor, vehicle_id)
            if vehicle.status == "submitted":
                await vehicle_service.review_vehicle(db, actor, vehicle_id, "approve", None)
                out["published"] = True
            if vehicle.status != "approved":
                raise ApiError(409, "This vehicle is not approved (it was rejected or withdrawn).", "vehicle_not_approved")
            if auction:
                created = await auction_service.create_auction(db, actor, {
                    "vehicle_id": vehicle_id, "starting_price": auction["starting_price"],
                    "starts_at": auction["starts_at"], "ends_at": auction["ends_at"],
                    "extension_enabled": extension_enabled, "extension_minutes": extension_minutes,
                })
                out["auction_id"] = created.id
            await db.commit()
            out["status"] = "approved"
        except ApiError as exc:
            await db.rollback()
            out.update(error=exc.detail, code=exc.code, published=False, auction_id=None)
            fresh = await vehicle_service.load_vehicle(db, vehicle_id)
            out["status"] = fresh.status if fresh else None
        results.append(out)
    return results


# ---------------------------------------------------------------------------- the template
def _example_rows() -> list[list[str]]:
    start = (datetime.now(IST) + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
    auction = {
        "registration_number": "e.g. KL07AB1234", "claim_number": "CLM-2026-0001", "listing_type": "Auction", "make": "Maruti Suzuki",
        "model": "Swift", "variant": "VXI", "manufacturing_year": "2019", "registration_year": "2019", "fuel_type": "Petrol",
        "transmission": "Manual", "number_of_owners": "1", "km_driven": "48210", "superdari": "No", "damage_type": "Accident",
        "damage_other": "", "location": "Kochi Yard", "rc_status": OPTIONS["rc_status"][next(iter(OPTIONS["rc_status"]))],
        "registration_type": OPTIONS["registration_type"][next(iter(OPTIONS["registration_type"]))],
        "hypothecation_status": OPTIONS["hypothecation_status"][next(iter(OPTIONS["hypothecation_status"]))],
        "category": OPTIONS["category"].get("insurance", ""), "starting_price": "150000",
        "auction_start": start.strftime("%Y-%m-%d %H:%M"), "auction_end": (start + timedelta(hours=2)).strftime("%Y-%m-%d %H:%M"),
    }
    lift = {**auction, "registration_number": "e.g. KL01CD5678", "claim_number": "CLM-2026-0002", "listing_type": "Ready to Lift",
            "make": "Hyundai", "model": "i20", "variant": "Asta", "manufacturing_year": "2020", "registration_year": "2020",
            "km_driven": "32500", "superdari": "Yes", "location": "Aluva Yard", "starting_price": "", "auction_start": "", "auction_end": ""}
    return [[row[c] for c in COLUMNS] for row in (auction, lift)]


def _choices_sheet() -> list[list[str]]:
    lists = [("Listing", ["Auction", "Ready to Lift"]), ("Superdari", ["Yes", "No"])]
    lists += [(HEADINGS[f].rstrip("*").split(" (")[0], list(OPTIONS[f].values())) for f in CHOICE_FIELDS]
    height = max(len(values) for _, values in lists)
    rows = [[name for name, _ in lists]]
    rows += [[values[i] if i < len(values) else "" for _, values in lists] for i in range(height)]
    return rows


HELP = [
    ["How to fill the Vehicles sheet"],
    ["1. One vehicle per row. Keep the first line (column names) as it is. Columns marked * are required."],
    ["2. Rows whose registration number starts with \"e.g.\" are examples and are ignored. Write your vehicles below them or delete them."],
    ["3. Listing: Auction (default when empty) or Ready to Lift. Ready to Lift needs KM driven and Superdari, and no auction columns."],
    ["4. Auction (optional): fill all three of Starting price, Auction start and Auction end in Indian time, e.g. 2026-10-28 10:00."],
    ["   Leave them empty to create the auction later (Admin > Auctions > Waiting > Start auction)."],
    ["5. Choice columns accept the words in the Choices sheet (any case). An empty Auction category uses the category chosen on the upload screen."],
    ["6. Photos: keep each vehicle's photos in a folder named with its registration number or claim number (KL07AB1234 / CLM-2026-0001),"],
    ["   or name each photo with the registration number (KL07AB1234.jpg, KL07AB1234-2.jpg). Choose the main folder on the upload screen."],
    [f"7. At most {MAX_ROWS} vehicles per file. Upload, check the list of problems, fix them in Excel and upload again."],
]


def template_xlsx() -> bytes:
    headings = [HEADINGS[c] for c in COLUMNS]
    widths = [max(14, min(36, len(h) + 4)) for h in headings]
    choices = _choices_sheet()
    allowed = {"listing_type": ["Auction", "Ready to Lift"], "superdari": ["Yes", "No"],
               **{f: list(OPTIONS[f].values()) for f in CHOICE_FIELDS}}
    dropdowns = [(COLUMNS.index(name), values) for name, values in allowed.items()]
    return xlsx.write_workbook([
        ("Vehicles", [headings, *_example_rows()], widths, 1, dropdowns),
        ("Choices", choices, [24] * len(choices[0]), 1),
        ("How to", HELP, [120], 1),
    ])


def template_csv() -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([HEADINGS[c] for c in COLUMNS])
    for row in _example_rows():
        writer.writerow(row)
    return ("﻿" + buf.getvalue()).encode("utf-8")

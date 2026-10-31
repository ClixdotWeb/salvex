"""
KYC workflow. Functions add changes and audit entries to the caller's session WITHOUT committing; the
route commits once, so a status change and its audit record are stored together or not at all.

State machine (only these moves exist):
    draft              --submit-->            submitted          (user, needs >= 1 active document)
    submitted          --approve-->           approved           (admin)  users.kyc_status = verified
    submitted          --reject-->            rejected           (admin)  users.kyc_status = rejected
    submitted          --request_changes-->   changes_requested  (admin)  users.kyc_status = pending
    changes_requested  --submit-->            submitted          (user)
Documents can be added or withdrawn only in draft and changes_requested. approved and rejected are final
for that submission. After a rejection the user may start a NEW submission (a provisional default; see
docs/MASTER_PLAN.md); after approval they may not.

Locking: the submission row is locked first, then any user rows in id order (one statement). The Module 2
account actions lock only user rows, also in id order, so the two can never deadlock each other.
"""
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.audit import record_audit
from app.core.config import settings
from app.core.errors import ApiError
from app.models.kyc import EDITABLE_STATUSES, OPEN_STATUSES, KycDecision, KycDocument, KycSubmission
from app.models.user import User
from app.services.kyc_files import validate_upload
from app.services.notifications import notify, notify_admins
from app.services.storage import PrivateStorage

KYC_MESSAGES = {'approve': ('Identity verified', 'Your KYC is approved. You can now bid on live auctions.'), 'reject': ('KYC not approved', 'Your KYC was not approved: {reason}. You can start a new verification.'), 'request_changes': ('KYC: changes needed', 'Please update your KYC documents: {reason}')}
DECISION_STATUS = {"approve": "approved", "reject": "rejected", "request_changes": "changes_requested"}
ACCOUNT_STATUS = {"approved": "verified", "rejected": "rejected", "changes_requested": "pending"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _not_found() -> ApiError:
    return ApiError(404, "KYC submission not found.", "kyc_not_found")


async def load_submission(db: AsyncSession, submission_id: uuid.UUID, with_user: bool = False) -> Optional[KycSubmission]:
    """A submission with its documents and decisions (fresh from the database)."""
    options = [selectinload(KycSubmission.documents), selectinload(KycSubmission.decisions)]
    if with_user:
        options.append(joinedload(KycSubmission.user))
    stmt = select(KycSubmission).where(KycSubmission.id == submission_id).options(*options)
    return (await db.execute(stmt.execution_options(populate_existing=True))).scalar_one_or_none()


async def latest_submission_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[uuid.UUID]:
    return (await db.execute(
        select(KycSubmission.id).where(KycSubmission.user_id == user_id)
        .order_by(KycSubmission.created_at.desc(), KycSubmission.id.desc()).limit(1)
    )).scalar_one_or_none()


async def _lock_own_submission(db: AsyncSession, user: User, submission_id: uuid.UUID) -> KycSubmission:
    """Lock the submission; someone else's (or a missing) submission is reported as not found."""
    submission = (await db.execute(
        select(KycSubmission).where(KycSubmission.id == submission_id).with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if submission is None or submission.user_id != user.id:
        raise _not_found()
    return submission


def _require_editable(submission: KycSubmission) -> None:
    if submission.status not in EDITABLE_STATUSES:
        raise ApiError(409, "This submission can no longer be changed.", "kyc_not_editable")


async def _active_document_count(db: AsyncSession, submission_id: uuid.UUID) -> int:
    return (await db.execute(
        select(func.count()).select_from(KycDocument)
        .where(KycDocument.submission_id == submission_id, KycDocument.withdrawn_at.is_(None))
    )).scalar_one()


# ---------------------------------------------------------------------------- applicant actions
async def start_submission(db: AsyncSession, user: User) -> KycSubmission:
    if user.kyc_status == "verified":
        raise ApiError(409, "Your identity is already verified.", "kyc_already_verified")
    open_one = (await db.execute(
        select(KycSubmission.id).where(KycSubmission.user_id == user.id, KycSubmission.status.in_(OPEN_STATUSES))
    )).scalar_one_or_none()
    if open_one is not None:
        raise ApiError(409, "You already have a KYC submission in progress.", "kyc_submission_open")
    submission = KycSubmission(user_id=user.id, status="draft")
    db.add(submission)
    try:
        await db.flush()
    except IntegrityError:            # a simultaneous request created one first (partial unique index)
        await db.rollback()
        raise ApiError(409, "You already have a KYC submission in progress.", "kyc_submission_open") from None
    return submission


async def add_document(
    db: AsyncSession,
    storage: PrivateStorage,
    user: User,
    submission_id: uuid.UUID,
    document_type: str,
    data: bytes,
    declared_type: Optional[str],
) -> tuple[KycDocument, str]:
    """
    Validate and store the file, then record it. Returns (document, storage key). The caller commits and,
    if the commit fails, deletes the stored file with that key.
    """
    content_type = validate_upload(data, declared_type, settings.KYC_MAX_FILE_BYTES)
    submission = await _lock_own_submission(db, user, submission_id)
    _require_editable(submission)
    if await _active_document_count(db, submission.id) >= settings.KYC_MAX_DOCUMENTS_PER_SUBMISSION:
        raise ApiError(409, "This submission already has the maximum number of documents.", "kyc_too_many_documents")

    key = storage.save(data)
    try:
        document = KycDocument(
            submission_id=submission.id, user_id=user.id, document_type=document_type, storage_key=key,
            content_type=content_type, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
        )
        db.add(document)
        submission.updated_at = _now()
        await db.flush()
        # Metadata only: never the contents, the file name or the storage key.
        await record_audit(db, actor=user, action="kyc.document_upload", target_type="kyc_document", target_id=document.id,
                           details={"submission_id": submission.id, "document_type": document_type,
                                    "content_type": content_type, "size_bytes": len(data)})
    except BaseException:
        storage.delete(key)
        raise
    return document, key


async def withdraw_document(db: AsyncSession, user: User, document_id: uuid.UUID) -> KycDocument:
    """Withdraw (not delete) a document. The file is kept until a retention rule is decided."""
    found = (await db.execute(select(KycDocument.submission_id, KycDocument.user_id).where(KycDocument.id == document_id))).first()
    if found is None or found.user_id != user.id:
        raise ApiError(404, "Document not found.", "kyc_document_not_found")
    submission = await _lock_own_submission(db, user, found.submission_id)
    _require_editable(submission)
    document = (await db.execute(
        select(KycDocument).where(KycDocument.id == document_id).execution_options(populate_existing=True)
    )).scalar_one()
    if document.withdrawn_at is not None:
        raise ApiError(409, "This document has already been withdrawn.", "kyc_document_withdrawn")
    document.withdrawn_at = _now()
    submission.updated_at = _now()
    await record_audit(db, actor=user, action="kyc.document_withdraw", target_type="kyc_document", target_id=document.id,
                       details={"submission_id": submission.id, "document_type": document.document_type})
    return document


async def submit(db: AsyncSession, user: User, submission_id: uuid.UUID) -> KycSubmission:
    submission = await _lock_own_submission(db, user, submission_id)
    _require_editable(submission)
    if await _active_document_count(db, submission.id) == 0:
        raise ApiError(422, "Upload at least one document before submitting.", "kyc_no_documents")
    missing = await missing_documents(db, submission.id)
    if missing:
        from app.schemas.kyc import DOCUMENT_LABELS
        raise ApiError(422, "Please upload: " + ", ".join(DOCUMENT_LABELS.get(m, m) for m in missing) + ".",
                       "kyc_documents_missing")
    if settings.KYC_REQUIRE_AADHAAR_NUMBER and not submission.aadhaar_last4:
        raise ApiError(422, "Please enter your Aadhaar number.", "kyc_aadhaar_missing")
    applicant = (await db.execute(
        select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one()
    previous = submission.status
    submission.status = "submitted"
    submission.submitted_at = _now()
    if applicant.kyc_status == "rejected":          # a new attempt after an earlier rejection
        applicant.kyc_status = "pending"
    await record_audit(db, actor=user, action="kyc.submit", target_type="kyc_submission", target_id=submission.id,
                       details={"previous_status": previous})
    await notify_admins(db, "kyc_submitted", "New KYC to review", f"{user.name} submitted identity documents.",
                        f"/admin?tab=kyc&status=submitted&open={submission.id}")
    return submission


def required_document_types() -> list:
    return [t.strip() for t in (settings.KYC_REQUIRED_DOCUMENTS or "").split(",") if t.strip()]


async def missing_documents(db: AsyncSession, submission_id: uuid.UUID) -> list:
    required = required_document_types()
    if not required:
        return []
    have = set((await db.execute(select(KycDocument.document_type).where(
        KycDocument.submission_id == submission_id, KycDocument.withdrawn_at.is_(None)))).scalars().all())
    return [t for t in required if t not in have]


async def set_aadhaar(db: AsyncSession, user: User, submission_id: uuid.UUID, raw: str) -> KycSubmission:
    """Store the last 4 digits and a keyed hash of a valid Aadhaar number on the user's open submission."""
    from app.services.aadhaar import aadhaar_hash, clean_aadhaar
    number = clean_aadhaar(raw)
    if number is None:
        raise ApiError(422, "Enter a valid 12-digit Aadhaar number.", "invalid_aadhaar")
    submission = await _lock_own_submission(db, user, submission_id)
    _require_editable(submission)
    digest = aadhaar_hash(number)
    taken = (await db.execute(select(KycSubmission.id).where(
        KycSubmission.aadhaar_hash == digest, KycSubmission.user_id != user.id).limit(1))).first()
    if taken:
        raise ApiError(409, "This Aadhaar number is already used by another account. Please contact our team.",
                       "aadhaar_in_use")
    submission.aadhaar_last4, submission.aadhaar_hash = number[-4:], digest
    await record_audit(db, actor=user, action="kyc.aadhaar_set", target_type="kyc_submission", target_id=submission.id,
                       details={"last4": number[-4:]})
    return submission


# ---------------------------------------------------------------------------- reviewer actions
async def decide(db: AsyncSession, actor: User, submission_id: uuid.UUID, decision: str, reason: str) -> KycSubmission:
    submission = (await db.execute(
        select(KycSubmission).where(KycSubmission.id == submission_id).with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if submission is None:
        raise _not_found()

    # Lock the reviewer and the applicant together, in id order, and re-read them: a reviewer who lost
    # admin rights while this request waited is refused, as in the Module 2 account actions.
    rows = (await db.execute(
        select(User).where(User.id.in_([actor.id, submission.user_id])).order_by(User.id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalars().all()
    by_id = {row.id: row for row in rows}
    reviewer = by_id.get(actor.id)
    if reviewer is None or reviewer.role != "admin" or not reviewer.is_active:
        raise ApiError(403, "Access denied. You do not have permission to do this.", "forbidden")
    if submission.user_id == actor.id:
        raise ApiError(403, "You cannot review your own KYC submission.", "kyc_self_review_forbidden")
    if submission.status != "submitted":
        raise ApiError(409, "This submission is not waiting for review.", "kyc_not_awaiting_review")

    applicant = by_id[submission.user_id]
    new_status = DECISION_STATUS[decision]
    previous_account_status = applicant.kyc_status
    now = _now()
    db.add(KycDecision(submission_id=submission.id, reviewer_id=actor.id, decision=new_status, reason=reason, created_at=now))
    submission.status = new_status
    submission.decided_at = now
    applicant.kyc_status = ACCOUNT_STATUS[new_status]
    await db.flush()
    await record_audit(db, actor=actor, action=f"kyc.{decision}", target_type="kyc_submission", target_id=submission.id,
                       details={"user_id": applicant.id, "reason": reason,
                                "old_kyc_status": previous_account_status, "new_kyc_status": applicant.kyc_status})
    title, body = KYC_MESSAGES[decision]
    await notify(db, applicant.id, "kyc_decision", title, body.format(reason=reason), "/dashboard?tab=documents")
    return submission


# ---------------------------------------------------------------------------- reading files
async def readable_document(db: AsyncSession, reader: User, document_id: uuid.UUID) -> KycDocument:
    """The owner and administrators may read a document; everyone else is told it does not exist."""
    document = (await db.execute(select(KycDocument).where(KycDocument.id == document_id))).scalar_one_or_none()
    if document is None or (document.user_id != reader.id and reader.role != "admin"):
        raise ApiError(404, "Document not found.", "kyc_document_not_found")
    return document

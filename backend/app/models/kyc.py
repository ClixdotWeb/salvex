"""
KYC (identity verification) records.

  * KycSubmission - one attempt by a user to get verified. Its `status` is the current state:
        draft -> submitted -> approved | rejected | changes_requested -> submitted -> ...
    A user has at most ONE open submission (draft, submitted or changes_requested) at a time, enforced
    by a partial unique index. `users.kyc_status` is the summary the rest of the platform reads.
  * KycDocument - one uploaded file. The file itself lives in private storage (app/services/storage.py)
    under a random key; this row never holds the contents. Documents are never deleted by users, only
    withdrawn (the file is kept until a retention rule is decided).
  * KycDecision - one reviewer decision. Append-only: a database trigger rejects UPDATE, DELETE and
    TRUNCATE, so who decided what, when and why can never be rewritten.

Users and their KYC records are linked with ON DELETE RESTRICT: identity evidence must not disappear
because an account row is removed.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

SUBMISSION_STATUSES = ("draft", "submitted", "changes_requested", "approved", "rejected")
OPEN_STATUSES = ("draft", "submitted", "changes_requested")
EDITABLE_STATUSES = ("draft", "changes_requested")      # the user may add or withdraw documents
DECISIONS = ("approved", "rejected", "changes_requested")
CONTENT_TYPES = ("application/pdf", "image/jpeg", "image/png")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class KycSubmission(Base):
    __tablename__ = "kyc_submissions"
    __table_args__ = (
        CheckConstraint(_in("status", SUBMISSION_STATUSES), name="ck_kyc_submissions_status"),
        Index(
            "uq_kyc_submissions_one_open_per_user", "user_id", unique=True,
            postgresql_where=text(_in("status", OPEN_STATUSES)),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)   # latest submit
    # Aadhaar number: never stored in full (last 4 digits for display + keyed hash to stop re-use on another account)
    aadhaar_last4: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    aadhaar_hash: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)     # latest decision

    user: Mapped["User"] = relationship("User", lazy="raise")
    documents: Mapped[list["KycDocument"]] = relationship(
        "KycDocument", back_populates="submission", order_by="KycDocument.uploaded_at", lazy="raise"
    )
    decisions: Mapped[list["KycDecision"]] = relationship(
        "KycDecision", back_populates="submission", order_by="KycDecision.created_at", lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<KycSubmission {self.id} user={self.user_id} {self.status}>"


class KycDocument(Base):
    __tablename__ = "kyc_documents"
    __table_args__ = (
        CheckConstraint(_in("content_type", CONTENT_TYPES), name="ck_kyc_documents_content_type"),
        CheckConstraint("size_bytes > 0", name="ck_kyc_documents_size_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("kyc_submissions.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    # Owner, copied from the submission so every access check is one comparison.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    # Validated by the application against a provisional generic list (app/schemas/kyc.py); not a database
    # constraint, because the final list is still a company decision and should not need a migration.
    document_type: Mapped[str] = mapped_column(String(40), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)   # never sent to clients
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)                     # integrity check on read
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    withdrawn_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    submission: Mapped["KycSubmission"] = relationship("KycSubmission", back_populates="documents", lazy="raise")

    def __repr__(self) -> str:
        return f"<KycDocument {self.id} {self.document_type} submission={self.submission_id}>"


class KycDecision(Base):
    __tablename__ = "kyc_decisions"
    __table_args__ = (
        CheckConstraint(_in("decision", DECISIONS), name="ck_kyc_decisions_decision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("kyc_submissions.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)

    submission: Mapped["KycSubmission"] = relationship("KycSubmission", back_populates="decisions", lazy="raise")

    def __repr__(self) -> str:
        return f"<KycDecision {self.decision} submission={self.submission_id}>"

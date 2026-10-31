"""
Module 3: KYC submissions, document uploads, admin review and protected document access.

Database work runs on the isolated local test database inside a transaction that is always rolled back.
Uploaded files go to a temporary folder per test (never the real storage folder).
"""
import struct
import uuid
import zlib

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.api.deps import require_verified_kyc
from app.core.config import settings
from app.core.errors import register_error_handlers
from app.main import app as main_app
from app.models.audit_log import AuditLog
from app.models.kyc import KycDecision, KycDocument, KycSubmission
from app.models.user import User
from app.services.storage import LocalPrivateStorage, StorageError, get_private_storage
from helpers import login, new_email, register_and_verify
from test_admin_foundation import load_user, make_admin
from test_users_admin import make_user

# ---------------------------------------------------------------------------- sample files
PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"


def png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")


JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 32 + b"\xff\xd9"
SECRET_FIELDS = {"storage_key", "sha256", "password_hash", "token"}


@pytest.fixture
def storage(tmp_path):
    store = LocalPrivateStorage(tmp_path / "private")
    main_app.dependency_overrides[get_private_storage] = lambda: store
    yield store
    main_app.dependency_overrides.pop(get_private_storage, None)


def stored_files(store: LocalPrivateStorage) -> list:
    return [p for p in store.root.rglob("*") if p.is_file()] if store.root.exists() else []


async def start(api, headers) -> str:
    res = await api.client.post("/api/kyc/submissions", headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def upload(api, headers, submission_id, data=PDF, content_type="application/pdf", document_type="identity_proof"):
    return await api.client.post(
        f"/api/kyc/submissions/{submission_id}/documents", params={"document_type": document_type},
        content=data, headers={**headers, "Content-Type": content_type},
    )


async def submitted(api, role="bidder") -> tuple[str, dict, uuid.UUID, str, str]:
    """A user with one uploaded PDF, submitted for review. Returns (email, headers, user id, submission id, doc id)."""
    email, headers, uid = await make_user(api, role)
    sid = await start(api, headers)
    doc = await upload(api, headers, sid)
    assert doc.status_code == 201, doc.text
    res = await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=headers)
    assert res.status_code == 200, res.text
    return email, headers, uid, sid, doc.json()["id"]


async def decide(api, admin, sid, decision, reason="Checked against the documents"):
    return await api.client.post(f"/api/admin/kyc/submissions/{sid}/decision", headers=admin,
                                 json={"decision": decision, "reason": reason})


async def audits(api, action, target_id) -> list:
    async with api.db() as db:
        return list((await db.execute(select(AuditLog).where(
            AuditLog.action == action, AuditLog.target_id == str(target_id)))).scalars().all())


# ---------------------------------------------------------------------------- access control
async def test_kyc_routes_require_sign_in(api, storage):
    some = uuid.uuid4()
    for method, url in (("get", "/api/kyc/me"), ("post", "/api/kyc/submissions"),
                        ("post", f"/api/kyc/submissions/{some}/documents?document_type=other"),
                        ("post", f"/api/kyc/submissions/{some}/submit"), ("delete", f"/api/kyc/documents/{some}"),
                        ("get", f"/api/kyc/documents/{some}/file")):
        res = await api.client.request(method, url)
        assert res.status_code == 401, (method, url)


async def test_admins_cannot_apply_and_applicants_cannot_review(api, storage):
    _, admin = await make_admin(api)
    res = await api.client.post("/api/kyc/submissions", headers=admin)
    assert res.status_code == 403 and res.json()["code"] == "forbidden"
    _, headers, _, sid, _ = await submitted(api)
    for method, url, body in (("get", "/api/admin/kyc/submissions", None),
                              ("get", f"/api/admin/kyc/submissions/{sid}", None),
                              ("post", f"/api/admin/kyc/submissions/{sid}/decision", {"decision": "approve", "reason": "self approval"})):
        res = await api.client.request(method, url, headers=headers, json=body)
        assert res.status_code == 403, url
    async with api.db() as db:
        assert (await db.get(KycSubmission, uuid.UUID(sid))).status == "submitted"


async def test_users_cannot_set_their_own_kyc_status(api, storage):
    email, headers, _ = await make_user(api)
    for body in ({"kyc_status": "verified"}, {"name": "Valid Name", "kyc_status": "verified"}):
        assert (await api.client.patch("/api/users/me", headers=headers, json=body)).status_code == 422
    assert (await load_user(api, email)).kyc_status == "pending"


async def test_one_user_cannot_touch_another_users_submission_or_documents(api, storage):
    _, owner, _ = await make_user(api)
    sid = await start(api, owner)
    doc_id = (await upload(api, owner, sid)).json()["id"]
    _, intruder, _ = await make_user(api)

    for res in (await upload(api, intruder, sid),
                await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=intruder),
                await api.client.delete(f"/api/kyc/documents/{doc_id}", headers=intruder),
                await api.client.get(f"/api/kyc/documents/{doc_id}/file", headers=intruder)):
        assert res.status_code == 404                                 # existence is not revealed either
    assert (await api.client.get("/api/kyc/me", headers=intruder)).json()["submission"] is None
    assert len(stored_files(storage)) == 1                            # the intruder's upload stored nothing
    async with api.db() as db:
        document = await db.get(KycDocument, uuid.UUID(doc_id))
        assert document.withdrawn_at is None
        assert (await db.get(KycSubmission, uuid.UUID(sid))).status == "draft"


async def test_documents_are_downloaded_only_through_the_protected_route(api, storage):
    admin_email, admin = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    _, owner, _ = await make_user(api)
    sid = await start(api, owner)
    created = (await upload(api, owner, sid)).json()
    assert not SECRET_FIELDS & set(created)

    own = await api.client.get(f"/api/kyc/documents/{created['id']}/file", headers=owner)
    assert own.status_code == 200 and own.content == PDF
    assert own.headers["content-type"] == "application/pdf"
    assert own.headers["content-disposition"] == f'attachment; filename="kyc-{created["id"]}.pdf"'
    assert own.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in own.headers["cache-control"]
    assert "sandbox" in own.headers["content-security-policy"]
    assert await audits(api, "kyc.document_view", created["id"]) == []     # the owner's own view is not logged

    by_admin = await api.client.get(f"/api/kyc/documents/{created['id']}/file", headers=admin)
    assert by_admin.status_code == 200 and by_admin.content == PDF
    entry, = await audits(api, "kyc.document_view", created["id"])
    assert entry.actor_id == admin_id and entry.details == {"submission_id": sid}

    # nothing in any response reveals where the file is stored
    async with api.db() as db:
        key = (await db.get(KycDocument, uuid.UUID(created["id"]))).storage_key
    for res in (await api.client.get("/api/kyc/me", headers=owner),
                await api.client.get(f"/api/admin/kyc/submissions/{sid}", headers=admin)):
        assert key not in res.text and "sha256" not in res.text
    # unknown and malformed ids
    assert (await api.client.get(f"/api/kyc/documents/{uuid.uuid4()}/file", headers=admin)).status_code == 404
    assert (await api.client.get("/api/kyc/documents/..%2F..%2Fetc/file", headers=admin)).status_code in (404, 422)


async def test_a_tampered_or_missing_file_is_not_served(api, storage):
    _, owner, _ = await make_user(api)
    sid = await start(api, owner)
    doc_id = (await upload(api, owner, sid)).json()["id"]
    path, = stored_files(storage)
    path.write_bytes(PDF.replace(b"Catalog", b"Catalox"))
    res = await api.client.get(f"/api/kyc/documents/{doc_id}/file", headers=owner)
    assert res.status_code == 500 and res.json()["code"] == "kyc_file_integrity" and b"Catalox" not in res.content
    path.unlink()
    res = await api.client.get(f"/api/kyc/documents/{doc_id}/file", headers=owner)
    assert res.status_code == 500 and res.json()["code"] == "kyc_file_unavailable"


def test_storage_keys_cannot_escape_the_storage_folder(tmp_path):
    store = LocalPrivateStorage(tmp_path / "private")
    key = store.save(b"data")
    assert store.read(key) == b"data"
    for bad in ("../secret", "kyc/../../x", "/etc/passwd", "kyc/" + "g" * 32, "kyc/ABC", "", "kyc\\..\\x"):
        with pytest.raises(StorageError):
            store.read(bad)
    assert [p.name for p in (tmp_path / "private" / "kyc").iterdir()] == [key.split("/")[1]]   # no .part files


async def test_cookie_sessions_need_the_csrf_token_for_kyc_changes(api, storage):
    email = new_email("cookie")
    await register_and_verify(api, email)
    csrf = (await login(api.client, email)).json()["csrf_token"]
    refused = await api.client.post("/api/kyc/submissions")
    assert refused.status_code == 403 and refused.json()["code"] == "csrf_failed"
    sid = (await api.client.post("/api/kyc/submissions", headers={"X-CSRF-Token": csrf})).json()["id"]
    refused = await upload(api, {}, sid)
    assert refused.status_code == 403 and refused.json()["code"] == "csrf_failed"
    assert stored_files(storage) == []
    assert (await upload(api, {"X-CSRF-Token": csrf}, sid)).status_code == 201


# ---------------------------------------------------------------------------- upload validation
@pytest.mark.parametrize("data,content_type", [(PDF, "application/pdf"), (png(), "image/png"), (JPEG, "image/jpeg"),
                                               (JPEG, "image/jpg"), (PDF, "application/pdf; charset=binary")])
async def test_accepted_file_types(api, storage, data, content_type):
    _, headers, _ = await make_user(api)
    sid = await start(api, headers)
    res = await upload(api, headers, sid, data, content_type)
    assert res.status_code == 201, res.text
    assert res.json()["size_bytes"] == len(data)
    assert len(stored_files(storage)) == 1 and stored_files(storage)[0].read_bytes() == data


@pytest.mark.parametrize("data,content_type,status,code", [
    (b"MZ\x90\x00 windows program", "application/pdf", 415, "unsupported_file_type"),
    (b"<html><script>alert(1)</script></html>", "text/html", 415, "unsupported_file_type"),
    (b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>", "image/svg+xml", 415, "unsupported_file_type"),
    (b"just some text", "text/plain", 415, "unsupported_file_type"),
    (PDF, "image/png", 415, "file_type_mismatch"),
    (png(), "application/pdf", 415, "file_type_mismatch"),
    (PDF, "application/octet-stream", 415, "unsupported_file_type"),
    (PDF, "", 415, "unsupported_file_type"),
    (b"", "application/pdf", 422, "file_empty"),
    (PDF.replace(b"<< /Type /Catalog >>", b"<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"),
     "application/pdf", 422, "unsafe_pdf"),
    (PDF.replace(b"<< /Type /Catalog >>", b"<< /Type /Catalog /Names << /EmbeddedFiles 2 0 R >> >>"),
     "application/pdf", 422, "unsafe_pdf"),
    (PDF.replace(b"<< /Type /Catalog >>", b"<< /S /Launch /F (cmd.exe) >>"), "application/pdf", 422, "unsafe_pdf"),
    (PDF[:-7], "application/pdf", 422, "damaged_file"),
    (png()[:-12], "image/png", 422, "damaged_file"),
    (JPEG[:-2], "image/jpeg", 422, "damaged_file"),
])
async def test_bad_files_are_refused_and_nothing_is_kept(api, storage, data, content_type, status, code):
    _, headers, _ = await make_user(api)
    sid = await start(api, headers)
    res = await upload(api, headers, sid, data, content_type)
    assert res.status_code == status and res.json()["code"] == code, res.text
    assert stored_files(storage) == []
    async with api.db() as db:
        assert (await db.execute(select(KycDocument).where(KycDocument.submission_id == uuid.UUID(sid)))).first() is None


async def test_size_limit_is_enforced(api, storage, monkeypatch):
    monkeypatch.setattr(settings, "KYC_MAX_FILE_BYTES", 2048)
    _, headers, _ = await make_user(api)
    sid = await start(api, headers)
    def pdf_of(size: int) -> bytes:
        padding = size - len(PDF)                     # a PDF comment line pads the body to an exact size
        return PDF[:-6] + b"%" + b"x" * (padding - 2) + b"\n" + PDF[-6:]

    at_limit, over = pdf_of(2048), pdf_of(2049)
    assert len(at_limit) == 2048 and len(over) == 2049
    res = await upload(api, headers, sid, over)
    assert res.status_code == 413 and res.json()["code"] == "file_too_large"
    assert stored_files(storage) == []
    assert (await upload(api, headers, sid, at_limit)).status_code == 201
    assert [p.stat().st_size for p in stored_files(storage)] == [2048]

    # Without a Content-Length (chunked transfer) the limit is enforced while the body streams in.
    async def chunks():
        for _ in range(10):
            yield b"%" * 512

    streamed = await api.client.post(f"/api/kyc/submissions/{sid}/documents", params={"document_type": "other"},
                                     content=chunks(), headers={**headers, "Content-Type": "application/pdf"})
    assert streamed.status_code == 413 and streamed.json()["code"] == "file_too_large"
    assert len(stored_files(storage)) == 1


async def test_document_type_must_be_from_the_provisional_list(api, storage):
    _, headers, _ = await make_user(api)
    sid = await start(api, headers)
    for document_type in ("aadhaar", "../x", "", "IDENTITY_PROOF"):
        assert (await upload(api, headers, sid, document_type=document_type)).status_code == 422, document_type
    missing = await api.client.post(f"/api/kyc/submissions/{sid}/documents", content=PDF,
                                    headers={**headers, "Content-Type": "application/pdf"})
    assert missing.status_code == 422
    assert stored_files(storage) == []


async def test_document_count_limit(api, storage, monkeypatch):
    monkeypatch.setattr(settings, "KYC_MAX_DOCUMENTS_PER_SUBMISSION", 2)
    _, headers, _ = await make_user(api)
    sid = await start(api, headers)
    first = (await upload(api, headers, sid)).json()["id"]
    assert (await upload(api, headers, sid)).status_code == 201
    third = await upload(api, headers, sid)
    assert third.status_code == 409 and third.json()["code"] == "kyc_too_many_documents"
    await api.client.delete(f"/api/kyc/documents/{first}", headers=headers)   # withdrawn ones do not count
    assert (await upload(api, headers, sid)).status_code == 201


# ---------------------------------------------------------------------------- status transitions
async def test_full_happy_path_with_approval(api, storage):
    admin_email, admin = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    email, headers, uid, sid, _ = await submitted(api)
    me = (await api.client.get("/api/kyc/me", headers=headers)).json()
    assert me["kyc_status"] == "pending" and me["submission"]["status"] == "submitted"

    queue = (await api.client.get("/api/admin/kyc/submissions?status=submitted&page_size=100", headers=admin)).json()
    row = next(item for item in queue["items"] if item["id"] == sid)
    assert row["user"]["email"] == email and not SECRET_FIELDS & set(row["user"])

    res = await decide(api, admin, sid, "approve", "  Identity confirmed  ")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "approved" and body["decided_at"] and body["user"]["kyc_status"] == "verified"
    decision, = body["decisions"]
    assert decision["reviewer_id"] == str(admin_id) and decision["reason"] == "Identity confirmed"
    assert (await load_user(api, email)).kyc_status == "verified"

    mine = (await api.client.get("/api/kyc/me", headers=headers)).json()
    assert mine["kyc_status"] == "verified"
    assert mine["submission"]["decisions"] == [{"decision": "approved", "reason": "Identity confirmed",
                                                "created_at": decision["created_at"]}]   # no reviewer identity
    entry, = await audits(api, "kyc.approve", sid)
    assert entry.actor_id == admin_id and entry.details == {
        "user_id": str(uid), "reason": "Identity confirmed", "old_kyc_status": "pending", "new_kyc_status": "verified"}
    again = await api.client.post("/api/kyc/submissions", headers=headers)
    assert again.status_code == 409 and again.json()["code"] == "kyc_already_verified"


async def test_rejection_is_final_for_that_submission_but_a_new_one_may_be_started(api, storage):
    _, admin = await make_admin(api)
    email, headers, _, sid, doc_id = await submitted(api)
    res = await decide(api, admin, sid, "reject", "Document unreadable")
    assert res.status_code == 200 and res.json()["status"] == "rejected"
    assert (await load_user(api, email)).kyc_status == "rejected"
    assert (await upload(api, headers, sid)).status_code == 409
    assert (await api.client.delete(f"/api/kyc/documents/{doc_id}", headers=headers)).status_code == 409
    assert (await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=headers)).status_code == 409
    assert (await decide(api, admin, sid, "approve")).status_code == 409

    new_sid = await start(api, headers)
    assert (await load_user(api, email)).kyc_status == "rejected"          # still rejected until resubmitted
    await upload(api, headers, new_sid)
    await api.client.post(f"/api/kyc/submissions/{new_sid}/submit", headers=headers)
    assert (await load_user(api, email)).kyc_status == "pending"
    assert (await api.client.get("/api/kyc/me", headers=headers)).json()["submission"]["id"] == new_sid


async def test_correction_requests_reopen_the_submission_for_changes(api, storage):
    _, admin = await make_admin(api)
    email, headers, _, sid, first_doc = await submitted(api)
    res = await decide(api, admin, sid, "request_changes", "Address proof missing")
    assert res.status_code == 200 and res.json()["status"] == "changes_requested"
    assert (await load_user(api, email)).kyc_status == "pending"
    assert (await audits(api, "kyc.request_changes", sid))[0].details["reason"] == "Address proof missing"

    mine = (await api.client.get("/api/kyc/me", headers=headers)).json()["submission"]
    assert mine["status"] == "changes_requested" and mine["decisions"][0]["reason"] == "Address proof missing"
    assert (await upload(api, headers, sid, png(), "image/png", "address_proof")).status_code == 201
    assert (await api.client.delete(f"/api/kyc/documents/{first_doc}", headers=headers)).status_code == 200
    resubmitted = await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=headers)
    assert resubmitted.status_code == 200 and resubmitted.json()["status"] == "submitted"

    final = (await decide(api, admin, sid, "approve", "All documents in order")).json()
    assert [d["decision"] for d in final["decisions"]] == ["changes_requested", "approved"]
    docs = {d["id"]: d for d in final["documents"]}
    assert docs[first_doc]["withdrawn_at"] is not None and len(docs) == 2      # history kept, withdrawal visible
    assert (await load_user(api, email)).kyc_status == "verified"


async def test_invalid_transitions_and_requests_are_refused(api, storage):
    _, admin = await make_admin(api)
    _, headers, _ = await make_user(api)
    sid = await start(api, headers)
    again = await api.client.post("/api/kyc/submissions", headers=headers)
    assert again.status_code == 409 and again.json()["code"] == "kyc_submission_open"

    empty = await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=headers)
    assert empty.status_code == 422 and empty.json()["code"] == "kyc_no_documents"
    doc = (await upload(api, headers, sid)).json()["id"]
    await api.client.delete(f"/api/kyc/documents/{doc}", headers=headers)
    assert (await api.client.delete(f"/api/kyc/documents/{doc}", headers=headers)).status_code == 409   # already withdrawn
    assert (await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=headers)).status_code == 422

    draft_decision = await decide(api, admin, sid, "approve")
    assert draft_decision.status_code == 409 and draft_decision.json()["code"] == "kyc_not_awaiting_review"

    await upload(api, headers, sid)
    assert (await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=headers)).status_code == 200
    assert (await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=headers)).status_code == 409
    assert (await upload(api, headers, sid)).status_code == 409                       # locked while under review

    for body in ({"decision": "approve"}, {"decision": "approve", "reason": "  "}, {"decision": "approved", "reason": "fine reason"},
                 {"decision": "approve", "reason": "fine reason", "kyc_status": "verified"}, {"reason": "fine reason"},
                 {"decision": "approve", "reason": "x" * 1001}):
        assert (await api.client.post(f"/api/admin/kyc/submissions/{sid}/decision", headers=admin, json=body)).status_code == 422, body
    assert (await decide(api, admin, uuid.uuid4(), "approve")).status_code == 404
    assert (await decide(api, admin, sid, "approve")).status_code == 200
    second = await decide(api, admin, sid, "reject")
    assert second.status_code == 409                                                  # a decided submission stays decided
    async with api.db() as db:
        assert len((await db.execute(select(KycDecision).where(KycDecision.submission_id == uuid.UUID(sid)))).all()) == 1


async def test_an_admin_cannot_review_their_own_submission(api, storage):
    from app.core.errors import ApiError
    from app.services.kyc import decide as decide_service
    admin_email, _ = await make_admin(api)
    async with api.db() as db:
        admin = (await db.execute(select(User).where(User.email == admin_email))).scalar_one()
        submission = KycSubmission(user_id=admin.id, status="submitted")   # e.g. an applicant later made admin
        db.add(submission)
        await db.flush()
        with pytest.raises(ApiError) as refused:
            await decide_service(db, admin, submission.id, "approve", "my own")
        assert refused.value.code == "kyc_self_review_forbidden"
        await db.rollback()


async def test_a_reviewer_who_lost_admin_rights_mid_request_is_refused(api, storage):
    from app.core.errors import ApiError
    from app.services.kyc import decide as decide_service
    admin_email, _ = await make_admin(api)
    email, _, _, sid, _ = await submitted(api)
    async with api.db() as request_db:
        actor = (await request_db.execute(select(User).where(User.email == admin_email))).scalar_one()
        async with api.db() as other:
            (await other.execute(select(User).where(User.email == admin_email))).scalar_one().is_active = False
            await other.commit()
        with pytest.raises(ApiError) as refused:
            await decide_service(request_db, actor, uuid.UUID(sid), "approve", "stale rights")
        assert refused.value.status_code == 403
        await request_db.rollback()
    assert (await load_user(api, email)).kyc_status == "pending"


# ---------------------------------------------------------------------------- audit and history
async def test_applicant_steps_are_audited_without_file_contents(api, storage):
    _, headers, uid, sid, doc_id = await submitted(api)
    upload_entry, = await audits(api, "kyc.document_upload", doc_id)
    assert upload_entry.actor_id == uid and upload_entry.actor_role == "bidder"
    assert upload_entry.details == {"submission_id": sid, "document_type": "identity_proof",
                                    "content_type": "application/pdf", "size_bytes": len(PDF)}
    submit_entry, = await audits(api, "kyc.submit", sid)
    assert submit_entry.details == {"previous_status": "draft"}
    async with api.db() as db:
        everything = (await db.execute(select(AuditLog).where(AuditLog.actor_id == uid))).scalars().all()
        key = (await db.get(KycDocument, uuid.UUID(doc_id))).storage_key
    assert all(key not in str(e.details) and "Catalog" not in str(e.details) for e in everything)


@pytest.mark.parametrize("decision,status", [("approve", "approved"), ("reject", "rejected"), ("request_changes", "changes_requested")])
async def test_a_failed_audit_write_undoes_the_whole_decision(api, storage, monkeypatch, decision, status):
    _, admin = await make_admin(api)
    email, _, _, sid, _ = await submitted(api)

    async def broken(*args, **kwargs):
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr("app.services.kyc.record_audit", broken)
    with pytest.raises(RuntimeError):
        await decide(api, admin, sid, decision)
    monkeypatch.undo()
    async with api.db() as db:
        submission = await db.get(KycSubmission, uuid.UUID(sid))
        await db.refresh(submission)
        assert submission.status == "submitted" and submission.decided_at is None
        assert (await db.execute(select(KycDecision).where(KycDecision.submission_id == submission.id))).first() is None
    assert (await load_user(api, email)).kyc_status == "pending"


async def test_a_failed_audit_write_on_upload_keeps_no_record_and_no_file(api, storage, monkeypatch):
    _, headers, _ = await make_user(api)
    sid = await start(api, headers)

    async def broken(*args, **kwargs):
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr("app.services.kyc.record_audit", broken)
    with pytest.raises(RuntimeError):
        await upload(api, headers, sid)
    monkeypatch.undo()
    assert stored_files(storage) == []
    async with api.db() as db:
        assert (await db.execute(select(KycDocument).where(KycDocument.submission_id == uuid.UUID(sid)))).first() is None


async def test_decisions_cannot_be_edited_or_deleted(api, storage):
    _, admin = await make_admin(api)
    _, _, _, sid, _ = await submitted(api)
    await decide(api, admin, sid, "approve")
    async with api.db() as db:
        decision_id = (await db.execute(select(KycDecision.id).where(KycDecision.submission_id == uuid.UUID(sid)))).scalar_one()
    for sql in ("UPDATE kyc_decisions SET decision = 'rejected' WHERE id = :i",
                "UPDATE kyc_decisions SET reason = 'rewritten' WHERE id = :i",
                "DELETE FROM kyc_decisions WHERE id = :i", "TRUNCATE kyc_decisions"):
        async with api.db() as db:
            with pytest.raises(DBAPIError) as caught:
                await db.execute(text(sql), {"i": decision_id})
            assert "append-only" in str(caught.value)
            await db.rollback()


async def test_the_database_allows_only_one_open_submission_per_user_and_known_statuses(api, storage):
    _, _, uid = await make_user(api)
    async with api.db() as db:
        db.add(KycSubmission(user_id=uid, status="draft"))
        await db.flush()
        db.add(KycSubmission(user_id=uid, status="submitted"))
        with pytest.raises(DBAPIError):
            await db.flush()
        await db.rollback()
    async with api.db() as db:
        db.add(KycSubmission(user_id=uid, status="verified"))
        with pytest.raises(DBAPIError):
            await db.flush()
        await db.rollback()


# ---------------------------------------------------------------------------- admin queue
async def test_admin_queue_filters_orders_and_paginates(api, storage):
    _, admin = await make_admin(api)
    ids = [ (await submitted(api))[3] for _ in range(3) ]
    _, headers, _ = await make_user(api)
    draft = await start(api, headers)
    body = (await api.client.get("/api/admin/kyc/submissions?status=submitted&page_size=100", headers=admin)).json()
    listed = [i["id"] for i in body["items"]]
    assert set(ids) <= set(listed) and draft not in listed
    assert [i for i in listed if i in ids] == ids                                  # oldest submitted first
    assert set(body) == {"items", "page", "page_size", "total", "pages"}
    page = (await api.client.get("/api/admin/kyc/submissions?status=submitted&page_size=1", headers=admin)).json()
    assert len(page["items"]) == 1 and page["total"] >= 3
    for query in ("status=verified", "page_size=101", "user_id=abc"):
        assert (await api.client.get(f"/api/admin/kyc/submissions?{query}", headers=admin)).status_code == 422
    assert (await api.client.get(f"/api/admin/kyc/submissions/{uuid.uuid4()}", headers=admin)).status_code == 404


# ---------------------------------------------------------------------------- require_verified_kyc
async def test_require_verified_kyc_reads_the_status_from_the_database(api, storage):
    probe = FastAPI()
    register_error_handlers(probe)

    @probe.get("/needs-kyc")
    async def needs_kyc(user: User = Depends(require_verified_kyc)):
        return {"ok": True}

    probe.dependency_overrides = main_app.dependency_overrides
    _, admin = await make_admin(api)
    _, headers, _, sid, _ = await submitted(api)
    async with AsyncClient(transport=ASGITransport(app=probe), base_url="http://test") as client:
        assert (await client.get("/needs-kyc")).status_code == 401
        refused = await client.get("/needs-kyc", headers=headers)
        assert refused.status_code == 403 and refused.json()["code"] == "kyc_required"
        await decide(api, admin, sid, "approve")
        assert (await client.get("/needs-kyc", headers=headers)).status_code == 200    # same token, immediately

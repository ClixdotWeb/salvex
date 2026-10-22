"""
Administrator provisioning: only through the operator command, with strong passwords, never over HTTP.
Everything here runs inside the rolled-back test transaction; no real administrator is created.
"""
import pytest
from sqlalchemy import select

from app.core.security import verify_password
from app.models.user import User
from app.services.admin_provisioning import AdminProvisioningError, provision_admin
from helpers import PASSWORD, login, new_email, register_and_verify

STRONG = "a-long-admin-passphrase-2026"


async def test_a_new_administrator_is_verified_active_and_has_a_hashed_password(api):
    email = new_email("newadmin")
    async with api.db() as db:
        user = await provision_admin(db, email=email.upper(), name="  Admin User ", password=STRONG)
        await db.commit()
        row = (await db.execute(select(User).where(User.email == email))).scalar_one()
        assert row.role == "admin" and row.is_email_verified and row.is_active
        assert row.name == "Admin User" and row.email == email
        assert row.password_hash != STRONG and verify_password(STRONG, row.password_hash)
    assert (await login(api.client, email, STRONG)).json()["user"]["role"] == "admin"


@pytest.mark.parametrize("password, why", [
    ("short-one", "shorter than 12"),
    ("password1234", "common password"),
    (None, "missing"),
    ("            ", "only spaces"),
])
async def test_weak_or_missing_administrator_passwords_are_refused(api, password, why):
    async with api.db() as db:
        with pytest.raises(AdminProvisioningError):
            await provision_admin(db, email=new_email("weak"), name="Admin User", password=password)


async def test_input_problems_are_refused(api):
    async with api.db() as db:
        with pytest.raises(AdminProvisioningError):
            await provision_admin(db, email="not-an-email", name="Admin User", password=STRONG)
        with pytest.raises(AdminProvisioningError):
            await provision_admin(db, email=new_email("noname"), name="A", password=STRONG)
        with pytest.raises(AdminProvisioningError):
            email = new_email("same")
            await provision_admin(db, email=email, name="Admin User", password=email)


async def test_an_existing_account_is_never_silently_changed(api):
    email = new_email("existing")
    await register_and_verify(api, email)
    async with api.db() as db:
        with pytest.raises(AdminProvisioningError):
            await provision_admin(db, email=email, name="Admin User", password=STRONG)   # no explicit promotion
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        assert user.role == "bidder" and verify_password(PASSWORD, user.password_hash)


async def test_promoting_requires_an_active_verified_user_and_signs_them_out(api):
    email = new_email("promote")
    await register_and_verify(api, email)
    token = (await login(api.client, email, bearer=True)).json()["access_token"]
    api.client.cookies.clear()
    headers = {"Authorization": f"Bearer {token}"}
    assert (await api.client.get("/api/auth/me", headers=headers)).status_code == 200

    async with api.db() as db:
        promoted = await provision_admin(db, email=email, name="", promote_existing=True)
        await db.commit()
        assert promoted.role == "admin"
    assert (await api.client.get("/api/auth/me", headers=headers)).status_code == 401   # must sign in again

    unverified = new_email("unverified")
    await api.client.post("/api/auth/register", json={"name": "Some One", "email": unverified, "password": PASSWORD})
    async with api.db() as db:
        with pytest.raises(AdminProvisioningError):
            await provision_admin(db, email=unverified, name="", promote_existing=True)
    with pytest.raises(AdminProvisioningError):
        async with api.db() as db:
            await provision_admin(db, email=new_email("nobody"), name="", promote_existing=True)   # nobody to promote and no password


def test_the_operator_command_refuses_mismatches_before_touching_the_database(monkeypatch, capsys):
    from app import cli

    answers = iter(["first-password-value", "different-password"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    assert cli.main(["create-admin", "--email", "boss@example.test", "--name", "Boss"]) == 1
    assert "do not match" in capsys.readouterr().out

    answers = iter(["same-password-value", "same-password-value"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    monkeypatch.setattr("builtins.input", lambda prompt="": "someone-else@example.test")
    assert cli.main(["create-admin", "--email", "boss@example.test", "--name", "Boss"]) == 1
    output = capsys.readouterr().out
    assert "Confirmation did not match" in output
    assert "same-password-value" not in output

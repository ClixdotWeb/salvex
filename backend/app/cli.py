"""
Operator commands. Run from the backend folder with the project's virtual environment:

    python -m app.cli create-admin --email boss@example.com --name "Boss Name"
    python -m app.cli create-admin --email existing@example.com --promote-existing
    python -m app.cli dev-last-code someone@example.com        (development/test only)

The administrator password is typed at a hidden prompt and is never printed, logged or passed on
the command line. These commands use whichever database DATABASE_URL points at, so check
that first. They never run automatically.
"""
import argparse
import asyncio
import getpass
import sys

from app.core.config import settings


async def _create_admin(args: argparse.Namespace) -> int:
    from app.db.session import AsyncSessionLocal, engine
    from app.services.admin_provisioning import AdminProvisioningError, provision_admin

    password = None
    if not args.promote_existing:
        password = getpass.getpass("New administrator password (hidden): ")
        if password != getpass.getpass("Repeat the password: "):
            print("The passwords do not match. Nothing was changed.")
            return 1

    print(f"Environment: {settings.APP_ENV}")
    typed = input(f"Type the email address again ({args.email}) to confirm: ").strip().lower()
    if typed != args.email.strip().lower():
        print("Confirmation did not match. Nothing was changed.")
        return 1

    try:
        async with AsyncSessionLocal() as session:
            user = await provision_admin(
                session,
                email=args.email,
                name=args.name or "",
                password=password,
                promote_existing=args.promote_existing,
            )
            await session.commit()
            print(f"Done: {user.email} is now an administrator.")
        return 0
    except AdminProvisioningError as exc:
        print(f"Not done: {exc}")
        return 1
    finally:
        await engine.dispose()


def _dev_last_code(args: argparse.Namespace) -> int:
    from app.services.email import read_dev_outbox

    try:
        messages = [m for m in read_dev_outbox() if m["to"].lower() == args.email.strip().lower()]
    except RuntimeError as exc:
        print(exc)
        return 1
    if not messages:
        print("No message found for that address in the developer outbox.")
        return 1
    last = messages[-1]
    print(f"{last['time']}  {last['subject']}\n\n{last['text']}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    admin = sub.add_parser("create-admin", help="Create (or explicitly promote) an administrator")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", default="")
    admin.add_argument("--promote-existing", action="store_true", help="Promote an existing verified user instead of creating one")

    code = sub.add_parser("dev-last-code", help="Show the newest developer-outbox email for an address")
    code.add_argument("email")

    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return asyncio.run(_create_admin(args))
    return _dev_last_code(args)


if __name__ == "__main__":
    sys.exit(main())

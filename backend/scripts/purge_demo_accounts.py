"""
Deactivate (or, with --hard-delete, remove) the known demo accounts that
demo_seed.py used to create.

WHY THIS EXISTS
----------------
demo_seed.py created 8 accounts - admin@vishakan.com, admin2@vishakan.com,
manager@vishakan.com, manager2@vishakan.com, karthik@vishakan.com,
suresh@vishakan.com, dinesh@vishakan.com, sales2@vishakan.com - all sharing
the single password "Password123!" (also printed in DEMO.md). If this
script was ever run against a database that is now serving production,
those 8 accounts and that shared password are live right now. That is a
real credential exposure, not a cosmetic cleanup item - anyone who has
ever seen DEMO.md can sign in as an admin.

demo_seed.py itself, and DEMO.md/DEMO.html, have been removed from this
production handover for the same reason: a script that recreates known-
password accounts, and a document that publishes them, have no place in
a production deliverable.

WHAT THIS SCRIPT DOES
----------------------
Default (safe) mode: sets is_active = false on exactly those 8 emails,
if they exist. This is reversible, touches no other table, and is
enough to close the exposure immediately - a deactivated account cannot
log in regardless of what the password is. It does NOT delete any
visits/orders/attendance/etc. those accounts may have created, because
guessing which of that activity is "fake" versus real work someone did
while testing is exactly the kind of guess that silently destroys real
data when it's wrong.

--hard-delete additionally attempts to DELETE the 8 user rows themselves
(not their historical records) after deactivating them. If the schema's
foreign keys block that (RESTRICT, as many of this codebase's tables
deliberately are), it reports exactly which table blocked it and leaves
that account deactivated rather than retrying with escalating force.

USAGE
-----
    cd backend
    python3 scripts/purge_demo_accounts.py            # dry run - lists what would change
    python3 scripts/purge_demo_accounts.py --confirm   # actually deactivates
    python3 scripts/purge_demo_accounts.py --confirm --hard-delete  # also tries to delete the rows

Back up the database before using --hard-delete.
"""

import argparse
import asyncio

from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal

_DEMO_EMAILS = [
    "admin@vishakan.com",
    "admin2@vishakan.com",
    "manager@vishakan.com",
    "manager2@vishakan.com",
    "karthik@vishakan.com",
    "suresh@vishakan.com",
    "dinesh@vishakan.com",
    "sales2@vishakan.com",
]


async def main(confirm: bool, hard_delete: bool) -> None:
    async with AsyncSessionLocal() as session:
        found = (
            await session.execute(
                text("SELECT id, email, full_name, is_active FROM users WHERE email = ANY(:emails)")
                .bindparams(emails=_DEMO_EMAILS)
            )
        ).all()

        if not found:
            print("None of the known demo accounts exist in this database. Nothing to do.")
            return

        print(f"Found {len(found)} demo account(s):")
        for row in found:
            print(f"  - {row.email} ({row.full_name}) - currently {'active' if row.is_active else 'inactive'}")

        if not confirm:
            print("\nDry run only. Re-run with --confirm to deactivate these accounts.")
            return

        ids = [row.id for row in found]
        await session.execute(
            text("UPDATE users SET is_active = false WHERE id = ANY(:ids)").bindparams(ids=ids)
        )
        await session.commit()
        print(f"\nDeactivated {len(ids)} demo account(s). They can no longer log in.")

        if hard_delete:
            print("\n--hard-delete requested. Attempting to remove the user rows themselves...")
            for row in found:
                try:
                    await session.execute(text("DELETE FROM users WHERE id = :id").bindparams(id=row.id))
                    await session.commit()
                    print(f"  - {row.email}: deleted.")
                except Exception as exc:  # noqa: BLE001 - reporting, not handling
                    await session.rollback()
                    print(f"  - {row.email}: could not delete (left deactivated instead). Reason: {exc}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="Actually deactivate the demo accounts (default is dry-run).")
    parser.add_argument("--hard-delete", action="store_true", help="After deactivating, also try to delete the rows. Back up first.")
    args = parser.parse_args()
    asyncio.run(main(confirm=args.confirm, hard_delete=args.hard_delete))

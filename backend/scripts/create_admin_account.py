"""
Create (or promote-in-place) a single admin account directly in the
database, bypassing the /users API endpoint.
"""

import argparse
import asyncio
import secrets
import string
import uuid

from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal
from app.infrastructure.security.bcrypt_password_hasher import BcryptPasswordHasher


def _generate_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="Admin account email")
    parser.add_argument("--name", required=True, help="Full name for the account")
    parser.add_argument("--employee-id", default=None, help="Optional employee ID")
    parser.add_argument("--password", default=None, help="Password to set. If omitted, a random one is generated and printed once.")
    parser.add_argument("--confirm", action="store_true", help="Actually write to the database. Without this, only a dry-run preview is shown.")
    args = parser.parse_args()

    email = args.email.strip().lower()
    password = args.password or _generate_password()
    hasher = BcryptPasswordHasher()
    password_hash = hasher.hash(password)

    async with AsyncSessionLocal() as session:
        existing = (
            await session.execute(
                text("SELECT id, role, is_active FROM users WHERE lower(email) = :email"),
                {"email": email},
            )
        ).mappings().first()

        if existing:
            action = f"PROMOTE existing user {existing['id']} (current role={existing['role']}, is_active={existing['is_active']}) to role=admin, is_active=true, and reset its password"
        else:
            action = f"CREATE a new user with email={email}, role=admin"

        print(f"[dry-run] Would {action}")

        if not args.confirm:
            print("\nNo changes made. Re-run with --confirm to apply.")
            return

        if existing:
            await session.execute(
                text(
                    """
                    UPDATE users
                    SET role = 'admin',
                        is_active = true,
                        hashed_password = :password_hash,
                        full_name = :full_name,
                        employee_id = COALESCE(:employee_id, employee_id)
                    WHERE id = :id
                    """
                ),
                {
                    "password_hash": password_hash,
                    "full_name": args.name,
                    "employee_id": args.employee_id,
                    "id": existing["id"],
                },
            )
            print(f"\nPromoted {email} to admin and reset its password.")
        else:
            new_id = uuid.uuid4()
            await session.execute(
                text(
                    """
                    INSERT INTO users (id, email, password_hash, full_name, role,
                                        is_active, employee_id, created_at, updated_at)
                    VALUES (:id, :email, :password_hash, :full_name, 'admin',
                            true, :employee_id, now(), now())
                    """
                ),
                {
                    "id": new_id,
                    "email": email,
                    "password_hash": password_hash,
                    "full_name": args.name,
                    "employee_id": args.employee_id,
                },
            )
            print(f"\nCreated new admin account {email} ({new_id}).")

        await session.commit()

        if not args.password:
            print(f"\nGenerated password (shown once - save it now): {password}")
        print("Log in from the web app or mobile app with this email and password.")


if __name__ == "__main__":
    asyncio.run(main())

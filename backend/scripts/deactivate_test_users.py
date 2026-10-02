import asyncio
import sys
from sqlalchemy import text
from app.infrastructure.database.session import AsyncSessionLocal

async def run(confirm: bool):
    async with AsyncSessionLocal() as session:
        # 1. Reactivate accounts that were wrongly disabled (@test.local and @t.local)
        reactivate_query = text("""
            UPDATE users 
            SET is_active = true 
            WHERE is_active = false 
              AND (email LIKE '%@test.local' OR email LIKE '%@t.local')
            RETURNING email
        """)
        if confirm:
            res = await session.execute(reactivate_query)
            reactivated = res.fetchall()
            print(f"Reactivated {len(reactivated)} users matching @test.local or @t.local.")
            for r in reactivated:
                print(f"  - {r[0]}")
            await session.commit()
        else:
            res = await session.execute(text("SELECT email FROM users WHERE is_active = false AND (email LIKE '%@test.local' OR email LIKE '%@t.local')"))
            reactivated = res.fetchall()
            print(f"[DRY RUN] Would reactivate {len(reactivated)} users matching @test.local or @t.local.")
            for r in reactivated:
                print(f"  - {r[0]}")

        # 2. Find ONLY @example.com users to deactivate, EXCLUDING any that might be fixtures if any.
        # Wait, the prompt says "limit it strictly to @example.com".
        find_query = text("""
            SELECT id, email 
            FROM users 
            WHERE is_active = true 
              AND is_deleted = false
              AND email LIKE '%@example.com'
        """)
        res = await session.execute(find_query)
        to_deactivate = res.fetchall()

        if not to_deactivate:
            print("No @example.com test users found to deactivate.")
            return

        if not confirm:
            print(f"\n[DRY RUN] Would deactivate {len(to_deactivate)} users.")
            for row in to_deactivate[:10]:
                print(f"  - {row[1]}")
            if len(to_deactivate) > 10:
                print(f"  ... and {len(to_deactivate) - 10} more.")
            return
            
        print(f"\nDeactivating {len(to_deactivate)} users...")
        update_query = text("""
            UPDATE users 
            SET is_active = false 
            WHERE is_active = true 
              AND is_deleted = false
              AND email LIKE '%@example.com'
        """)
        await session.execute(update_query)
        await session.commit()
        print("Done.")

if __name__ == "__main__":
    confirm = "--confirm" in sys.argv
    asyncio.run(run(confirm))

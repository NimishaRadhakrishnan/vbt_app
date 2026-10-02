# Phase 3a — edits to existing files

New files drop in as-is. These eight existing files need edits. Each shows the exact anchor text so the change is unambiguous.

---

## 1. `mobile/app.json` — DELETE

```bash
git rm mobile/app.json
```

It duplicated `app.config.js` with a different app name and already-drifted permission strings. `app.config.js` wins the Expo merge, so `app.json` was dead config that still read as authoritative.

---

## 2. `mobile/package.json` — dependencies for the SDK 51 target

The `scripts` block currently uses bare `react-native run-android`, which is wrong for a managed Expo project and will not apply the config plugins. Replace the scripts and bump the Expo packages:

```json
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "prebuild": "expo prebuild --clean",
    "doctor": "npx expo-doctor",
    "test": "jest"
  },
```

Then let Expo pick the correct native versions rather than hand-editing them:

```bash
cd mobile
npx expo install expo@^51.0.0
npx expo install --fix
npx expo install @expo/config-plugins
npx expo-doctor
```

`@expo/config-plugins` is a direct dependency now because `plugins/withMonitoringTool.js` imports it.

**Known breaking change on this path:** `expo-location` 16 → 17 changes background permission behaviour on Android. Re-test `LocationService.startTracking()` on a physical Android 14 device before recording the demo video — an emulator will not reproduce OEM battery-manager behaviour.

**Do NOT bundle the React Navigation v6 → v7 upgrade into this change.** It isn't required by the SDK bump, and mixing them makes a navigation regression indistinguishable from an SDK regression.

---

## 3. `mobile/src/services/db.ts` — add the consent sync type

```ts
  type: 'check_in' | 'check_out' | 'gps_ping' | 'farmer_register' | 'stock_audit' | 'dealer_order' | 'crop_issue' | 'plan_submit' | 'task_action' | 'visit_tracker_submit';
```

becomes

```ts
  type: 'check_in' | 'check_out' | 'gps_ping' | 'farmer_register' | 'stock_audit' | 'dealer_order' | 'crop_issue' | 'plan_submit' | 'task_action' | 'visit_tracker_submit' | 'consent';
```

`'consent'` is added for the type signature only. `ConsentService` never queues — it requires connectivity, because proceeding to request location permissions on the strength of an unconfirmed consent is the one case where the offline queue would do real harm.

---

## 4. `mobile/src/navigation/AppNavigator.tsx` — register the disclosure screen

Add the import:

```tsx
import LocationDisclosureScreen from '../screens/LocationDisclosureScreen';
```

Add the screen, **between `Login` and `Tabs`**:

```tsx
        <Stack.Screen
          name="LocationDisclosure"
          component={LocationDisclosureScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
```

`gestureEnabled: false` matters: a swipe-back past the disclosure would let an officer reach the app without either accepting or declining, leaving no record of which they did.

---

## 5. `mobile/src/screens/LoginScreen.tsx` — gate on consent after login

Find where a successful login navigates to `Tabs` (`navigation.reset(...)` or `navigation.replace('Tabs')`) and route through the consent check first:

```tsx
import { ConsentService } from '../services/consent';

// ...after a successful login, replacing the direct navigation to 'Tabs':
const cached = await ConsentService.getCachedAcceptedVersion();
if (cached === null) {
  // First login on this device, or a different officer on a shared
  // phone. Show the disclosure before anything else — it must appear
  // before the first permission prompt, and check-in is reachable from
  // the dashboard immediately.
  navigation.reset({ index: 0, routes: [{ name: 'LocationDisclosure' }] });
} else {
  navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
}
```

The cached read is deliberate — it is local and instant, so a slow connection never blocks login. The backend check in `getStatus()` still runs inside the disclosure screen, and the server-side guard on check-in is what actually enforces it.

Also add to the logout handler, wherever the session is cleared:

```tsx
await ConsentService.clearCache();
```

Without this, a shared phone would carry the previous officer's acceptance to the next one.

---

## 6. `mobile/src/screens/AttendanceScreen.tsx` — block check-in without consent

At the top of `handleCheckIn`, **before** `Location.requestForegroundPermissionsAsync()` — the ordering is the policy requirement, not a preference:

```tsx
    const acceptedVersion = await ConsentService.getCachedAcceptedVersion();
    if (acceptedVersion === null) {
      navigation.navigate('LocationDisclosure', { onAcceptNavigateTo: 'back' });
      return;
    }
```

And handle the server-side guard, since the cache can be stale when a new disclosure version is published:

```tsx
    } catch (err: any) {
      if (err?.status === 403 && String(err?.message ?? '').includes('location notice')) {
        navigation.navigate('LocationDisclosure', { onAcceptNavigateTo: 'back' });
        return;
      }
      // ...existing error handling
    }
```

Add the import:

```tsx
import { ConsentService } from '../services/consent';
```

---

## 7. `mobile/src/screens/ProfileScreen.tsx` — link to My tracking

Add a row in the existing menu list:

```tsx
  { label: 'My tracking', onPress: () => navigation.navigate('MyTracking') },
```

and register the screen inside `ProfileStack` in `TabNavigator.tsx`:

```tsx
import MyTrackingScreen from '../screens/MyTrackingScreen';

// inside ProfileStack.Navigator:
<ProfileStack.Screen
  name="MyTracking"
  component={MyTrackingScreen}
  options={{ title: 'My tracking' }}
/>
```

Profile rather than a new tab: it doesn't earn a bottom-nav slot, and the five-tab structure is fixed.

---

## 8. `backend/app/presentation/api/v1/router.py` — register the consent router

```python
api_v1_router.include_router(consent_router)
```

with the matching import, placed next to `attendance_router` since the two are coupled by the guard.

---

## 9. `backend/app/presentation/api/v1/routers/attendance_router.py` — enforce the guard

```python
from app.presentation.api.v1.routers.consent_router import require_location_consent
```

and on the check-in endpoint only:

```python
@router.post("/check-in", response_model=AttendanceResponse, status_code=status.HTTP_201_CREATED)
async def check_in(
    payload: CheckInRequest,
    current_user: CurrentUser,
    use_case: Annotated[AttendanceUseCase, Depends(get_attendance_use_case)],
    _consent: Annotated[None, Depends(require_location_consent)] = None,
) -> AttendanceResponse:
```

Check-in only. Check-out must never be gated — an officer who is already checked in and being tracked has to be able to stop it, whatever their consent state. Gating check-out would trap someone in exactly the situation the disclosure promises they can leave.

---

## 10. `backend/app/presentation/api/v1/routers/location_router.py` — the officer's own view

`GET /location/history/{officer_id}` is `require_role(ADMIN, MANAGER)`, so an officer has no way to see their own data. Add:

```python
@router.get("/me/today")
async def get_my_tracking_today(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """An officer's own tracking summary for today.

    Deliberately a summary, not the raw point list: the officer's real
    questions are "is it on?", "what did it record?", "when did it start
    and stop?", and a 2,000-row payload answers none of them better
    than four numbers do.

    Company-local day boundary via company_time, NOT the UTC-based
    DATE(...) grouping used elsewhere in this file — see Phase 3 bug A.
    An officer looking at "today" and being shown a UTC day would see
    their own early-morning pings missing, which on this screen
    specifically would look like the app hiding something.
    """
    from app.infrastructure.config.company_time import company_today, company_tz
    from datetime import datetime, time, timedelta

    tz = company_tz()
    day_start = datetime.combine(company_today(), time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    row = (
        await session.execute(
            text(
                """
                SELECT COUNT(*) AS point_count,
                       MIN(recorded_at) AS first_recorded_at,
                       MAX(recorded_at) AS last_recorded_at,
                       COALESCE(SUM(distance_from_prev), 0) / 1000.0 AS total_distance_km
                FROM gps_tracks
                WHERE user_id = :user_id
                  AND recorded_at >= :day_start
                  AND recorded_at <  :day_end
                """
            ).bindparams(
                user_id=current_user.user_id, day_start=day_start, day_end=day_end
            )
        )
    ).first()

    checked_in = (
        await session.execute(
            text(
                """
                SELECT 1 FROM attendance
                WHERE user_id = :user_id AND date = :today AND check_out_time IS NULL
                """
            ).bindparams(user_id=current_user.user_id, today=company_today())
        )
    ).first() is not None

    retention = (
        await session.execute(
            text("SELECT retention_months FROM location_disclosure_versions WHERE is_active")
        )
    ).scalar_one_or_none() or 12

    return {
        "point_count": row.point_count or 0,
        "first_recorded_at": row.first_recorded_at,
        "last_recorded_at": row.last_recorded_at,
        "total_distance_km": float(row.total_distance_km or 0.0),
        "checked_in": checked_in,
        "retention_months": retention,
    }
```

Note the range comparison rather than `DATE(recorded_at AT TIME ZONE ...)`. This is the correct pattern; the rest of the file gets the same treatment in Phase 3.

Verify the attendance table name against `attendance_model.py` before running — the rest of this file uses raw SQL, so a name mismatch surfaces at runtime, not import time.

---

## 11. Retention job — the number has to be real

The disclosure says 12 months. Nothing currently deletes anything, which makes that statement false. Add a scheduled task alongside `sweep_stale_locations()`:

```python
async def purge_expired_gps_tracks() -> None:
    """Deletes GPS history past the retention period stated in the
    active disclosure.

    Reads the period from location_disclosure_versions rather than a
    constant so the number officers were TOLD and the number enforced
    are the same value. A retention promise nobody implements is worse
    than a longer one stated honestly.
    """
```

Run daily, log the deleted row count, and batch the delete (`DELETE ... WHERE ctid IN (SELECT ctid ... LIMIT 10000)` in a loop) so it can't lock the table during working hours.

---

## Test checklist for this phase

| # | Test |
|---|---|
| 1 | Fresh install → login → disclosure appears before any OS permission prompt |
| 2 | "Not now" → app opens and is usable; Tasks, Profile, Leave all work |
| 3 | After "Not now", check-in → disclosure reappears; accept → check-in proceeds |
| 4 | Accept → `location_consent_acceptances` row exists with the right version |
| 5 | Publish disclosure v2 → next check-in is blocked until re-accept (tests the 409 and the guard together) |
| 6 | Check-out is **never** blocked, whatever the consent state |
| 7 | Logout → login as a different officer on the same phone → disclosure shows again |
| 8 | Airplane mode on first run → bundled copy shown; accept fails with a clear message; no permission prompt appears |
| 9 | `isMonitoringTool` present in the merged manifest after `expo prebuild` |
| 10 | Android 14 physical device: check in → persistent notification appears; check out → it disappears |
| 11 | My tracking screen shows OFF when checked out, ON when checked in |
| 12 | Admin consent page lists officers who have **not** accepted |

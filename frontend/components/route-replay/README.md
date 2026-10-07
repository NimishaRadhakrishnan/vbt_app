# Route Replay (Team > History)

The story of an officer's day: summary first, then the route on a map and the
places visited, listed like a train timetable.

```
components/route-replay/
  RouteReplayScreen.tsx   the screen: loads data, looks up place names, wires the parts
  FilterBar.tsx           officer, date (prev / next / Today), GPS quality badge, Export, Data quality report
  SummaryCards.tsx        distance, moving vs stationary, stops, day span (+ skeletons)
  RouteMap.tsx            Leaflet map: faint full path, traveled path, stops, gaps, moving marker, legend
  Timeline.tsx            places visited like a train timetable: arrival, place name, departure, travel between; click to show on the map
  EmptyState.tsx          no data, error with Retry, info banner, "choose an officer"
  QualityReport.tsx       the existing /location/diagnostics report
  routeAnalysis.ts        pure logic: distance, bad-fix filter, stops, gaps, quality, positions
  routeAnalysis.test.ts   unit tests (npm test)
  mockData.ts             fake days for every state
  exportUtils.ts          CSV (opens in Excel)
  format.ts, avatar.ts    small helpers (Asia/Kolkata, 12-hour)
```

## Reviewing every state without a backend

Build or run with `NEXT_PUBLIC_ROUTE_DEMO=1` and open `/route-replay-demo`:

```
NEXT_PUBLIC_ROUTE_DEMO=1 npm run dev
```

Pick a demo officer: full day (5,000+ points, 7 stops, a few bad fixes), signal
gaps, a 2-minute day, a single point, no data, API error. Without that
variable the page answers 404, so production builds do not expose it.

## Connecting the real API

Nothing to do: with no `fetchDay` prop the screen calls
`GET /location/history/{officer_id}?date=YYYY-MM-DD` (admin/manager only) and
`GET /location/diagnostics/{officer_id}?date=...` for the quality report.

Each history row: `{ lat, lng, recorded_at, speed (km/h), battery_level, accuracy (m) }`.
`accuracy` was added to the endpoint for this screen; an older server that
omits it still works, it just cannot drop poor-accuracy fixes. `9999` means
"phone gave no figure" and is treated as unknown, not as bad.

To use another source pass `fetchDay(officerId, date) => Promise<RawHistoryRow[]>`.

## Props (`RouteReplayScreen`)

| Prop | Type | Notes |
|---|---|---|
| `officers` | `OfficerOption[]` | `{ id, name, role, employeeId?, territory? }` |
| `places` | `Place[]` | `{ id, name, type, lat, lng }`: dealers, farmers, clinics. A stop within 150 m is named after the nearest one, otherwise "Unknown location" |
| `officerId`, `onOfficerChange` | string, fn | controlled |
| `date`, `onDateChange` | `YYYY-MM-DD`, fn | controlled; "Today" and the future limit use IST |
| `fetchDay` | fn | optional, replaces the history call |
| `fetchDiagnostics` | fn | optional, replaces the quality-report call |
| `demo` | boolean | shows the "Demo data" banner |

Parents may pass new arrays and functions on every render; the screen keeps
the latest in refs, so a parent re-render never refetches or re-fits the map.

## Rules (all in `DEFAULT_OPTIONS`, `routeAnalysis.ts`)

| Rule | Value |
|---|---|
| Stop | stays within 50 m of its centre for 5+ minutes. One stray fix is ignored; a signal gap always ends a stop |
| Bad fix | accuracy over 100 m, or a jump needing over 120 km/h (three in a row are accepted, so one bad first fix cannot erase the day) |
| Signal gap | no ping for more than 10 minutes |
| Distance | sum of straight lines between consecutive kept points (crosses gaps in a straight line) |
| Moving / stationary | stationary = time inside stops; moving = tracked time minus stops; gaps counted separately |
| GPS quality | starts at 100; minus gap share (up to 50), slow pings (up to 25), discarded points (up to 25); Good 80+, Fair 55+, else Poor. Under 10 minutes of tracking is never better than Fair. Hover the badge for the reasons |

## Place names

Each stop is named from the dealer, farmer or clinic it matches. Every other
stop (and the first and last position of the day) is named by
`POST /location/place-names`, which reverse-geocodes through an
OpenStreetMap-compatible service (`GEOCODER_URL`, default public Nominatim) and
caches every answer in Redis for the GPS retention period. If a name cannot be
found the coordinates are shown instead.

## Design tokens

| Token | Value |
|---|---|
| Primary (actions, active state) | `primary-700` `#9f1d1d` (brand maroon), hover `primary-800` |
| Route | blue `#2563EB`; slow `#F59E0B`; no signal `#64748B` dashed |
| Status | start green `#16A34A`; end red `#DC2626`; quality: emerald / amber / rose |
| Cards | 12 px radius (`rounded-xl`), 1 px `slate-200` border, soft two-layer shadow |
| Type | title 21 px semibold; section labels 12 px uppercase tracking-wider; body 14 px; captions 12 px `slate-500` |
| Spacing | 8 px grid (`gap-2/4`, `p-4`) |
| Icons | `lucide-react` only |
| Motion | 150 ms colour/transform transitions |
| Base map | OpenStreetMap tiles with the `.route-tiles` CSS filter (desaturated), in `globals.css` |

Focus rings are visible on every control, every icon button has an
`aria-label` and tooltip, and colour is never the only signal (stops are
numbered, gaps are dashed and labelled).

## Known limits

* Stop names come only from the dealers and farmers the portal already has. There is no reverse geocoding.
* "PDF" opens the browser print dialog (choose Save as PDF); the printout includes the portal frame. "Excel" is a CSV file that Excel opens directly.
* The officer's `territory` shows the user's `district` when the API sends one.

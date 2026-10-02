# Phase 3a — Submission Package (items 9–13)

Everything here is copy-and-paste ready. Fill the bracketed placeholders.

Do these **in order**. The video must be recorded on the API-34 build with the disclosure screen and the monitoring flag already in it — recording early is the most common wasted day in this process.

---

## Item 9 — Privacy policy

Applies to `frontend/app/privacy/page.tsx` and `mobile/src/screens/PrivacyPolicyScreen.tsx`. Both already exist and are already reachable before login, which is correct and unusual — keep that.

The policy must be live at a public URL, specific to this app, and must cover background location explicitly. Generic boilerplate gets flagged.

### Sections to add or replace

**Location data we collect**

> VBT One records your device's precise location while you are checked in for work. Recording starts when you tap Check In and stops when you tap Check Out. It does not run at any other time — not when you are checked out, not overnight, and not on leave or holidays.
>
> While recording is active, your phone displays a permanent notification stating that VBT One is recording your location. You can see your own recorded location at any time in the app under Profile → My tracking.
>
> For each recorded point we store: latitude and longitude, accuracy, speed, battery level, the time it was recorded, and whether the device reported a simulated (mock) location.

**Why we collect it**

> To confirm that field visits to farmers and dealers took place, and to make attendance records accurate. Vishakan Biotech Pvt. Ltd. uses this only for managing its own field operations. We do not sell it, share it with advertisers, or use it for advertising or analytics.

**Who can see it**

> Your reporting manager and the company administrator. It is not visible to other field officers and is not accessible to anyone outside Vishakan Biotech Pvt. Ltd.

**How long we keep it**

> Location history is deleted automatically **[12] months** after it is recorded. Attendance records — check-in and check-out times and locations — are kept for **[X] years** as employment records.

**Your choices**

> You may decline location recording. The app remains usable: you can see your tasks, your profile, your leave and the knowledge base. You will not be able to check in, because checking in is the action that starts recording. You can withdraw agreement at any time by contacting **[HR contact]**.

**Other data**

> Photographs you attach to visit logs and crop issue reports; farmer and dealer records you enter; your name, employee ID and role.

**Contact**

> **[Data contact name, email, postal address]**

### Also required

- Same content in both web and mobile, **and** at a public URL for the store listing.
- Link the URL in the Play Console listing **and** in App Store Connect.
- Data safety form in Play Console must match this page exactly. A mismatch between the declared data-safety form and the privacy policy is an automatic flag, and it is checked programmatically.

---

## Item 10 — Reviewer test account

Create **now**, before recording, and never delete it.

| Field | Value |
|---|---|
| Email / employee ID | `google.reviewer@vishakanbiotech.com` |
| Role | Field Officer |
| Password | Fixed, non-expiring, no forced change on first login |
| Region | Any active territory |

Seed the account so the app isn't empty on first open:

- 2–3 farmers with realistic Tamil Nadu villages
- 1 dealer
- 3–4 products with allocated stock (so the trial step is usable)
- 1–2 assigned tasks
- No requirement to complete day closure before the reviewer can explore

Then, in Play Console → App content → **App access**: select that all or some functionality is restricted, and give the credentials with these instructions:

> 1. Open the app and log in with the credentials above.
> 2. A screen titled "How VBT One uses your location" appears. Tap "I understand, continue".
> 3. Grant location permission, then "Allow all the time" when prompted.
> 4. On the Dashboard, tap Check In. A permanent notification appears showing that location is being recorded.
> 5. Tap Check Out. The notification disappears and recording stops.

Do the same in App Store Connect under App Review Information.

---

## Item 11 — Demo video (60–90 seconds)

Screen-record on a **physical Android 14 device** running the API-34 build. Not an emulator, and not the old build. Upload unlisted to YouTube; paste the link into the declaration form.

| Time | Shot | Why it's in the video |
|---|---|---|
| 0:00–0:05 | App icon on home screen, tap to open | Establishes the unique, identifiable icon the monitoring policy requires |
| 0:05–0:15 | Login screen, log in as the reviewer account | Reviewers must be shown how to reach the permission flow |
| 0:15–0:30 | **Disclosure screen, held still and readable for a full 6–8 seconds.** Scroll slowly through all five blocks | This is the prominent disclosure. It must be legible in the recording, not flashed past |
| 0:30–0:35 | Tap "I understand, continue" | Affirmative consent, captured |
| 0:35–0:45 | OS foreground prompt → grant. OS background prompt ("Allow all the time") → grant | The exact prompts the declaration is about |
| 0:45–0:55 | Dashboard → tap Check In. **Pull down the notification shade and show the persistent notification** | Proves the persistent-notification requirement |
| 0:55–1:05 | Profile → My tracking, showing "Location recording is ON" and today's points | Proves the officer can see their own data — the strongest anti-stalkerware signal available |
| 1:05–1:20 | Tap Check Out. **Pull down the shade again and show the notification is gone** | Proves tracking genuinely stops. Most submissions skip this; it is the most persuasive shot in the video |

No voiceover needed. Add short on-screen captions if anything is ambiguous. Do not speed up or cut the disclosure or permission sections.

---

## Item 12a — Background location declaration

Play Console → App content → **Sensitive app permissions** → Location permissions.

**Which feature requires background location:**

> Continuous verification of field visits during a working shift.

**Description:**

> VBT One is an enterprise field-force application used exclusively by employees of Vishakan Biotech Pvt. Ltd., an agricultural inputs company operating in Tamil Nadu and Kerala. It is not available to the general public.
>
> Field officers check in at the start of a shift and travel to farmers and dealers across rural areas. The app records the officer's location from check-in until check-out so that the company can confirm field visits took place and that attendance records are accurate. Recording stops immediately at check-out and does not occur at any other time.
>
> Officers are shown a full-screen notice explaining what is recorded, when, why, who can see it and how long it is kept, before any location permission is requested, and they must affirmatively agree. A permanent notification is displayed on the device whenever recording is active, and each officer can view their own recorded location within the app.
>
> Without background location the app cannot verify field visits, which is its primary purpose. Foreground-only location would require officers to keep the app open on screen throughout a full working day of travel, which is not viable.

**Wording rules, because they matter here:** never write *monitoring*, *surveillance*, or *tracking employees*. Write *verifying field visits*, *confirming attendance*. Same language in the listing, the policy and the app.

---

## Item 12b — Precise location declaration (new, April 2026)

Since April 2026 `ACCESS_FINE_LOCATION` needs its **own** declaration, separate from background location. Most guidance online predates this; expect two forms, not one.

**Why coarse location is insufficient:**

> Coarse location is accurate to approximately a city block or several hundred metres. The app's purpose is to confirm that an officer visited a specific farm or dealer premises, which are frequently within a few hundred metres of each other in rural areas. Coarse location cannot distinguish one farm from a neighbouring one and therefore cannot verify the visit.

**Why the Android location button is insufficient:**

> The location button supports one-time, user-initiated location requests. This app requires continuous recording across a working shift, which the button cannot provide.

---

## Item 12c — Store listing description

The monitoring policy requires the tracking to be disclosed in the store description itself. Put it near the top, not buried.

> **VBT One — Vishakan Biotech Field Force**
>
> VBT One is an internal application for employees of Vishakan Biotech Pvt. Ltd. It is not intended for the general public.
>
> Field officers use VBT One to check in for work, log visits to farmers and dealers, record crop issues and get expert advice, track product stock, apply for leave and see their assigned tasks.
>
> **Location recording:** while you are checked in for work, this app records your location so that the company can confirm your field visits and attendance. Recording starts when you check in and stops when you check out. While it is running, your phone shows a permanent notification. You can see your own recorded location in the app at any time. You are shown a full explanation and asked to agree before any location permission is requested.
>
> **Main features**
> • Check in and check out with location-verified attendance
> • Log farmer and dealer visits, including crop details and product trials
> • Report crop issues with photos and receive expert advice
> • Search a knowledge base of past crop problems and solutions
> • Track your product stock and trial giveaways
> • Apply for leave and view your tasks
>
> Requires a Vishakan Biotech employee account.

---

## Item 13 — Managed Google Play private distribution

**Recommended route.** Nobody outside the company should ever install this. A private app is invisible outside the enterprise, which removes the "would a member of the public expect this?" question — the question that sinks most employee-location apps in the public queue.

**Be clear on what it does not do:** private apps are still subject to Play policy and still get policy enforcement. Every item above still gets built. What you avoid is the slowest and most subjective part of review, not the compliance work.

### Steps

1. **Confirm Google Workspace.** If Vishakan Biotech already has it, the enterprise already exists and this is much shorter. If not, either sign up for Workspace or use Android Enterprise with a managed Google Play Accounts enterprise.
2. **Create the enterprise** at `play.google.com/work` and bind the company domain.
3. **Publish as a private app.** Either route works:
   - Google Play Console → create the app → **Advanced settings → Managed Google Play → make private to your organisation**. Simplest if you already have a Play Console developer account.
   - Or the managed Google Play iframe's Private apps page, which creates a Play Console account on the enterprise's behalf and waives the $25 registration fee.
4. **Choose Google-hosted, not self-hosted.** Google-hosted private apps install on any device mode; self-hosted ones have device-mode limitations and need an APK definition file.
5. **Upload the AAB** built from the corrected config (API 34, `isMonitoringTool`, full permission set).
6. **Complete all the forms anyway** — data safety, app access with the reviewer account, both location declarations, privacy policy URL, content rating.
7. **Distribute to employees.** Officers sign in to the Play Store with their work account and see VBT One in the Work tab. No APK sideloading, no "install from unknown sources" — which is also what makes updates reliable.

### Zoho

Your quote was ₹99/user. Ask directly what that covers beyond distribution. If it's essentially MDM plus app delivery, managed Google Play covers the delivery part at no per-user cost, and Android Enterprise covers device policy. Worth knowing before you sign.

### iOS

Apple Business Manager → **Custom Apps**. Same logic: distributed only to the organisation, no public listing. Still needs the disclosure screen and the same `NSLocation*` strings, which are already corrected in `app.config.js`.

---

## Item 13b — DPDP Act

India's Digital Personal Data Protection Act applies to employee location data. Employment-purpose processing has some latitude, but notice and purpose limitation still apply — and the disclosure screen plus the acceptance log is substantially the notice obligation already satisfied, which is a useful thing to be able to show.

Budget 30 minutes with the company's advisor before rollout rather than after. Not a blocker; cheap insurance.

---

## Timeline

| | |
|---|---|
| Code work (items 1–9) | 5–7 working days |
| Expo upgrade + physical device testing | 2–3 days, isolated |
| Submission package (items 10–12) | 1 day |
| Managed Google Play setup | 1–2 days including waiting |
| Review | **2–4 weeks, and expect one rejection** |

Do not tie a client go-live date to the first submission. Employee-tracking apps usually come back at least once, and the private-app route — also the recommendation on risk grounds — is the fastest path if the timeline gets tight.

---

## Carried-over open questions

1. Returned leftover trial stock — company pool, another officer, or written off?
2. Architecture — converge on thin-router + services, or the other way?
3. Dealer Payments and Enquiry — keep or cut?
4. Retention period — confirm 12 months for GPS, and set the figure for attendance records.
5. Google Workspace — does the company already have it?

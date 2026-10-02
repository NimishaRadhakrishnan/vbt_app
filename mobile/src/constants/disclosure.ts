/**
 * PHASE 3A ITEM 6 — disclosure content and versioning.
 *
 * The AUTHORITATIVE copy lives on the backend (GET /consent/location),
 * not here, for one reason that matters legally: the acceptance log has
 * to record which wording the officer actually agreed to. If the text
 * lived only in the app bundle, "version 1" would mean different words
 * on different phones depending on when each officer last updated, and
 * the consent record would be evidence of nothing.
 *
 * Backend-served copy also means the wording can be corrected after a
 * Play review comment without shipping a new build and waiting on
 * another review round - which, on this app's timeline, matters.
 *
 * What lives here is a BUNDLED FALLBACK, used only when the device
 * cannot reach the backend on first run. It is deliberately identical to
 * the backend's v1 text. If it is ever shown, the acceptance is recorded
 * with `source: 'bundled_fallback'` so it is distinguishable in the log.
 */

export interface DisclosureContent {
  version: number;
  title: string;
  /** Ordered what / when / why / who / how-long blocks. */
  points: { label: string; text: string }[];
  retentionMonths: number;
  footer: string;
}

/**
 * RETENTION PERIOD — 12 months.
 *
 * This number is not cosmetic: it appears in the disclosure screen, the
 * privacy policy and the Play declaration, and it must be enforced by a
 * real deletion job (see backend docs/PHASE_3A_SUBMISSION_PACKAGE.md,
 * "GPS retention"). Stating a period the system does not actually honour
 * is worse than stating a longer one honestly.
 *
 * 12 months chosen because it covers a full annual review cycle for
 * field-visit verification - the app's stated purpose - without keeping
 * movement history indefinitely. Confirm with the company before launch;
 * change it in ONE place (the backend), not here.
 */
export const DEFAULT_RETENTION_MONTHS = 12;

export const BUNDLED_DISCLOSURE: DisclosureContent = {
  version: 1,
  title: 'How VBT One uses your location',
  points: [
    {
      label: 'What',
      text: 'This app records where you are while you are checked in for work.',
    },
    {
      label: 'When',
      text:
        'Only from the moment you check in until the moment you check out. ' +
        'It never runs when you are checked out, and it never runs at night or on leave.',
    },
    {
      label: 'Why',
      text:
        'So your visits to farmers and dealers can be confirmed, and your attendance is accurate.',
    },
    {
      label: 'Who can see it',
      text: 'Your manager and the company admin. Nobody outside the company.',
    },
    {
      label: 'How long it is kept',
      text: `Location history is kept for ${DEFAULT_RETENTION_MONTHS} months, then deleted automatically.`,
    },
  ],
  retentionMonths: DEFAULT_RETENTION_MONTHS,
  footer:
    'While tracking is on, your phone will show a notification saying VBT One is recording your location. ' +
    'You can see your own location history any time from Profile > My tracking.',
};

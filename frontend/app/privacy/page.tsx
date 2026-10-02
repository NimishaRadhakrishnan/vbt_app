// Public, unauthenticated privacy policy page - required for the Play
// Store Data Safety form, which asks for a live URL, not just in-app
// text. Deliberately NOT a client component: this page needs no
// interactivity and should stay reachable (and fast) with no auth,
// no API calls, and no JS bundle beyond the framework's own.
//
// Content here must stay in sync with mobile/src/screens/PrivacyPolicyScreen.tsx
// manually - there's no shared CMS in this repo. If you edit one, edit
// both, and update both "last updated" dates together.

const LAST_UPDATED = "August 24, 2026";
const CONTACT_EMAIL = "privacy@vishakanbiotech.com";

export const metadata = {
  title: "Privacy Policy — VBT One",
};

export default function PrivacyPolicyPage() {
  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>Privacy Policy</h1>
        <p style={styles.updated}>Last updated: {LAST_UPDATED}</p>

        <Section title="What this app collects">
          <ul style={styles.list}>
            <li>Your name, employee ID, and role</li>
            <li>Your location, while you&apos;re checked in for work</li>
            <li>Photos you take for visit and crop issue reports</li>
            <li>Your task, visit, and leave records</li>
          </ul>
        </Section>

        <Section title="Why we collect it">
          <ul style={styles.list}>
            <li>We use your location to confirm your field visits really happened, and to record your attendance.</li>
            <li>We use your photos as proof for visit and crop issue reports.</li>
            <li>We use your task, visit, and leave records to run day-to-day field operations.</li>
          </ul>
        </Section>

        <Section title="Who can see it">
          <p style={styles.paragraph}>
            Your manager and company admins, for work purposes only. We don&apos;t sell your data or share it with
            anyone outside the company.
          </p>
        </Section>

        <Section title="When location tracking happens">
          <p style={styles.paragraph}>
            Only while you&apos;re checked in during company working hours (9 AM–6 PM). Tracking stops the moment
            you check out. We don&apos;t track your location on personal time.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p style={styles.paragraph}>
            We keep your work records for as long as you&apos;re employed with us, and for 24 months after your
            last working day.
          </p>
        </Section>

        <Section title="Your choices">
          <p style={styles.paragraph}>
            You can ask your manager or an admin to see or correct your own data at any time.
          </p>
        </Section>

        <Section title="Contact">
          <p style={styles.paragraph}>
            Questions about this policy? Write to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={styles.link}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <p style={styles.reviewNote}>
          Note for the team: the retention period and contact address above are placeholders pending sign-off
          from whoever owns compliance/HR — update this page and the in-app copy together before publishing.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#ffffff",
    padding: "40px 20px",
  },
  container: {
    maxWidth: 680,
    margin: "0 auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: "#1b5e20",
    margin: 0,
  },
  updated: {
    fontSize: 13,
    color: "#999",
    marginTop: 4,
    marginBottom: 32,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#333",
    marginBottom: 10,
  },
  paragraph: {
    fontSize: 15,
    color: "#555",
    lineHeight: 1.6,
  },
  list: {
    fontSize: 15,
    color: "#555",
    lineHeight: 1.8,
    paddingLeft: 20,
  },
  link: {
    color: "#1b5e20",
    fontWeight: 600,
  },
  reviewNote: {
    fontSize: 12,
    color: "#bbb",
    fontStyle: "italic",
    marginTop: 32,
  },
};

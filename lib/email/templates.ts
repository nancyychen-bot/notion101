import { renderTemplate } from "./render";

export type EmailKind =
  | "approved"
  | "decline"
  | "upgrade_3d"
  | "reminder_1d_free"
  | "reminder_1d_paid"
  | "feedback";

export interface EmailFields {
  guestName: string | null;
  eventName: string | null;
  eventDate?: string | null;
  location?: string | null;
  surveyUrl?: string | null;
  freeTrialUrl: string;
  eventUrl?: string | null;
}

export interface RenderedEmail { subject: string; html: string; text: string; }

export interface TemplateDef {
  label: string;
  audience: string;
  when: string;
  subject: string;
  body: string;
}

export type OverrideMap = Map<string, { subject?: string | null; body?: string | null }>;

const SIGNOFF = "The Notion Community Team";
const b = (...lines: string[]) => lines.join("\n");

export const TEMPLATE_REGISTRY: Record<EmailKind, TemplateDef> = {
  approved: {
    label: "Approved — you're in",
    audience: "All approved guests",
    when: "On approval (with calendar invite)",
    subject: "You're in — {{eventName}} 🎉",
    body: b(
      "Hi {{firstName}},", "",
      "Great news — you're **approved for {{eventName}}**! We can't wait to build with you. 🎉", "",
      "{{sessionDetails}}", "",
      "📅 A calendar invite is attached so the time is locked in. You can also [view the event page]({{eventUrl}}).", "",
      "On a Free plan? **[Start a free Notion trial]({{trialLink}})** before you come — you'll get much more out of the session.", "",
      "See you soon,", SIGNOFF,
    ),
  },
  decline: {
    label: "Declined — update on your registration",
    audience: "Declined guests",
    when: "On decline",
    subject: "An update on your {{eventName}} registration",
    body: b(
      "Hi {{firstName}},", "",
      "Thanks so much for your interest in **{{eventName}}**. Unfortunately we couldn't confirm you a spot this time — these sessions fill up fast.", "",
      "We'd love to see you at a future one. In the meantime, keep building: **[start a free Notion trial]({{trialLink}})**.", "",
      "Thanks,", SIGNOFF,
    ),
  },
  upgrade_3d: {
    label: "Upgrade nudge — 3 days before",
    audience: "Free & No-Account plans only",
    when: "3 days before the event",
    subject: "One thing to do before {{eventName}} ✨",
    body: b(
      "Hi {{firstName}},", "",
      "You're **confirmed for {{eventName}}** — we can't wait to build with you!", "",
      "{{sessionDetails}}", "",
      "One thing before you arrive: **[start your free Notion trial]({{trialLink}})** — it takes about a minute. You'll get much more out of the session with a full-featured workspace ready to go.", "",
      "See you soon,", SIGNOFF,
    ),
  },
  reminder_1d_free: {
    label: "Day-before reminder (Free)",
    audience: "Free & No-Account plans only",
    when: "1 day before the event",
    subject: "{{eventName}} is tomorrow ✨",
    body: b(
      "Hi {{firstName}},", "",
      "Quick reminder — **{{eventName}}** is **tomorrow**. We can't wait to build with you!", "",
      "{{sessionDetails}}", "",
      "**Before you come:**",
      "✅ Bring your laptop + the workspace or question you want help with",
      "✅ **[Start your free Notion trial]({{trialLink}})** if you haven't yet (about a minute)", "",
      "See you tomorrow,", SIGNOFF,
    ),
  },
  reminder_1d_paid: {
    label: "Day-before reminder (paid)",
    audience: "Paid plans (Plus / Business / Enterprise)",
    when: "1 day before the event",
    subject: "{{eventName}} is tomorrow ✨",
    body: b(
      "Hi {{firstName}},", "",
      "Quick reminder — **{{eventName}}** is **tomorrow**. We can't wait to build with you!", "",
      "{{sessionDetails}}", "",
      "**What to bring:**",
      "✅ Your laptop + the workspace or question you want help with", "",
      "See you tomorrow,", SIGNOFF,
    ),
  },
  feedback: {
    label: "Post-event feedback",
    audience: "Checked-in attendees",
    when: "A few hours after the event ends",
    subject: "How was {{eventName}}? (2 mins) 💜",
    body: b(
      "Hi {{firstName}},", "",
      "Thank you so much for coming to **{{eventName}}** — it was so great to have you, and we hope you left with something you're excited to build.", "",
      "We'd love your feedback — it takes about **2 minutes** and directly shapes the next event.", "",
      "👉 **[Share your feedback]({{feedbackLink}})**", "",
      "With gratitude,", SIGNOFF,
    ),
  },
};

/** Placeholder legend for the editor. */
export const PLACEHOLDERS: Array<{ token: string; desc: string }> = [
  { token: "{{firstName}}", desc: "Guest's first name (falls back to 'there')" },
  { token: "{{eventName}}", desc: "Event name (falls back to 'Notion 101')" },
  { token: "{{sessionDetails}}", desc: "Auto-built 🗓 date / 📍 location block (only the lines we have)" },
  { token: "{{eventDate}}", desc: "Event date, e.g. Monday, December 18" },
  { token: "{{location}}", desc: "Event location/city (blank if unknown)" },
  { token: "{{eventUrl}}", desc: "Public Luma event page" },
  { token: "{{trialLink}}", desc: "Free Notion trial URL" },
  { token: "{{feedbackLink}}", desc: "Post-event feedback form URL" },
];

const firstName = (n: string | null) => (n ?? "there").trim().split(/\s+/)[0] || "there";

/** A scannable date/location block — only the lines we actually have, so an empty
 * value never leaves a stray "📍" behind (mirrors office-hours' guestSessionLines). */
function sessionDetails(f: EmailFields): string {
  const lines: string[] = [];
  if (f.eventDate) lines.push(`🗓  ${f.eventDate}`);
  if (f.location) lines.push(`📍  ${f.location}`);
  return lines.join("\n");
}

/** Map EmailFields → placeholder token values. */
export function buildVars(f: EmailFields): Record<string, string> {
  return {
    firstName: firstName(f.guestName),
    eventName: f.eventName ?? "Notion 101",
    eventDate: f.eventDate ?? "",
    location: f.location ?? "",
    sessionDetails: sessionDetails(f),
    eventUrl: f.eventUrl ?? "",
    trialLink: f.freeTrialUrl,
    feedbackLink: f.surveyUrl ?? f.freeTrialUrl,
  };
}

/** Render a kind's subject+html+text, preferring a published override per field. */
export function renderKind(kind: EmailKind, f: EmailFields, overrides?: OverrideMap): RenderedEmail {
  const def = TEMPLATE_REGISTRY[kind];
  const ov = overrides?.get(kind);
  const content = { subject: ov?.subject ?? def.subject, body: ov?.body ?? def.body };
  return renderTemplate(content, buildVars(f));
}

/** Sample data for the editor's live preview. */
export const SAMPLE_FIELDS: EmailFields = {
  guestName: "Ada Lovelace",
  eventName: "Notion 101 for Small Businesses",
  eventDate: "Monday, December 18",
  location: "New York",
  surveyUrl: "https://example.com/feedback",
  freeTrialUrl: "https://www.notion.so/product",
  eventUrl: "https://luma.com/notion101",
};

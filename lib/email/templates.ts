export type EmailKind = "approved" | "decline" | "reminder_3d" | "reminder_1d" | "survey";

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

const SIGNOFF = "The Notion Community Team";
const firstName = (n: string | null) => (n ?? "there").trim().split(/\s+/)[0] || "there";
const p = (s: string) => `<p style="margin:0 0 16px">${s}</p>`;
const wrap = (body: string) =>
  `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${body}</div>`;
const btn = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;
const details = (f: EmailFields) =>
  [f.eventDate ? `🗓  ${f.eventDate}` : null, f.location ? `📍  ${f.location}` : null]
    .filter(Boolean).join("<br>");

export function renderEmail(kind: EmailKind, f: EmailFields): RenderedEmail {
  const fn = firstName(f.guestName);
  const ev = f.eventName ?? "Notion 101";
  const trial = `Come early to Notion? ${"You can start a free Notion trial here"} — <a href="${f.freeTrialUrl}">${f.freeTrialUrl}</a>.`;

  switch (kind) {
    case "approved": {
      const subject = `You're in — ${ev} 🎉`;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Great news — you're approved for <strong>${ev}</strong>. We can't wait to build with you!`) +
        (details(f) ? p(details(f)) : "") +
        p(`A calendar invite is attached so the time is locked in.`) +
        (f.eventUrl ? p(`Event page: <a href="${f.eventUrl}">${f.eventUrl}</a>`) : "") +
        p(trial) +
        p(`See you soon,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nYou're approved for ${ev}. We can't wait to build with you!\n` +
        `${f.eventDate ?? ""} ${f.location ?? ""}\n\nA calendar invite is attached.\n` +
        `Start a free Notion trial: ${f.freeTrialUrl}\n\nSee you soon,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
    case "decline": {
      const subject = `An update on your ${ev} registration`;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Thanks so much for your interest in <strong>${ev}</strong>. Unfortunately we weren't able to confirm you a spot this time — these sessions fill up fast.`) +
        p(`We'd love to see you at a future event. In the meantime, you can keep building: <a href="${f.freeTrialUrl}">start a free Notion trial</a>.`) +
        p(`Thanks,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nThanks for your interest in ${ev}. Unfortunately we couldn't confirm you a spot this time.\n` +
        `We'd love to see you at a future event. Start a free Notion trial: ${f.freeTrialUrl}\n\nThanks,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
    case "reminder_3d":
    case "reminder_1d": {
      const when = kind === "reminder_3d" ? "in 3 days" : "tomorrow";
      const subject = `${ev} is ${when} — see you there!`;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Quick reminder that <strong>${ev}</strong> is ${when}.`) +
        (details(f) ? p(details(f)) : "") +
        (f.eventUrl ? btn(f.eventUrl, "View event details") : "") +
        p(`New to Notion? ${trial}`) +
        p(`See you soon,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nReminder: ${ev} is ${when}.\n${f.eventDate ?? ""} ${f.location ?? ""}\n` +
        `${f.eventUrl ? `Details: ${f.eventUrl}\n` : ""}Start a free Notion trial: ${f.freeTrialUrl}\n\nSee you soon,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
    case "survey": {
      const subject = `Thanks for coming to ${ev} — 2 quick questions`;
      const url = f.surveyUrl ?? f.freeTrialUrl;
      const bodyHtml =
        p(`Hi ${fn},`) +
        p(`Thanks for joining us at <strong>${ev}</strong>! We'd love your feedback — it takes under two minutes.`) +
        btn(url, "Share your feedback") +
        p(`Thanks again,<br>${SIGNOFF}`);
      const text =
        `Hi ${fn},\n\nThanks for joining ${ev}! Please share quick feedback: ${url}\n\nThanks again,\n${SIGNOFF}`;
      return { subject, html: wrap(bodyHtml), text };
    }
  }
}

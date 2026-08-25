# Email Editing UI + Revised Email Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard email editor (edit copy → draft → publish) and a filterable sent-email log to Notion 101, and replace the hardcoded email set with six segment-aware templates.

**Architecture:** Convert the imperative `renderEmail()` into an editable data `TEMPLATE_REGISTRY` rendered by a ported markdown-ish renderer. A new `email_overrides` Neon table stores draft/live copy; the send path prefers a published override, else the built-in default. Reminder dispatch segments approved guests by their Notion-plan answer. UI ports office-hours' `EmailEditor`/settings pages, adapted to Neon + Notion 101's dashboard session (no publish passphrase).

**Tech Stack:** Next.js App Router (RSC), Neon Postgres via `sql` tagged templates, Vitest, Resend, TypeScript.

**Reference source (read-only, do NOT import):** `../office-hours/lib/email/templates.ts`, `../office-hours/components/hub/{EmailEditor,EmailLog,SettingsNav,HubNav}.tsx`, `../office-hours/lib/db/email-overrides.ts`, `../office-hours/app/api/hub/email-draft/route.ts`.

**Key type/name contract (used across tasks — keep consistent):**
- `EmailKind = "approved" | "decline" | "upgrade_3d" | "reminder_1d_free" | "reminder_1d_paid" | "feedback"`
- `TemplateDef = { label: string; audience: string; when: string; subject: string; body: string }`
- `TEMPLATE_REGISTRY: Record<EmailKind, TemplateDef>`
- `OverrideMap = Map<string, { subject?: string | null; body?: string | null }>`
- Placeholders: `{{firstName}} {{eventName}} {{eventDate}} {{eventUrl}} {{trialLink}} {{feedbackLink}}`
- Renderer in `lib/email/render.ts`: `renderTemplate({subject, body}, vars) → { subject, html, text }`
- Registry API in `lib/email/templates.ts`: `buildVars(f: EmailFields)`, `renderKind(kind, f, overrides?)`, `PLACEHOLDERS`, `SAMPLE_FIELDS`
- Segment in `lib/email/segment.ts`: `planSegment(answers, questionMap) → "free" | "paid"`
- Overrides DB in `lib/db/email-overrides.ts`: `listOverrides()`, `getLiveOverrideMap()`, `saveDraft()`, `publishDraft()`, `discardDraft()`

---

## Task 1: `email_overrides` table

**Files:**
- Modify: `lib/db/schema.sql` (append)
- Migration: apply to Neon via psql

- [ ] **Step 1: Append the table to `lib/db/schema.sql`**

```sql
create table if not exists email_overrides (
  key text primary key,
  draft_subject text,
  draft_body text,
  draft_note text,
  draft_updated_at timestamptz,
  live_subject text,
  live_body text,
  live_updated_at timestamptz
);
```

- [ ] **Step 2: Apply to Neon**

Run: `DBURL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) && psql "$DBURL" -f lib/db/schema.sql`
Expected: `CREATE TABLE` (or `NOTICE ... already exists, skipping` for the others), no error.

- [ ] **Step 3: Verify**

Run: `psql "$DBURL" -c "\d email_overrides"`
Expected: table with the 8 columns above.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.sql
git commit -m "feat(db): add email_overrides table for editable email copy"
```

---

## Task 2: Markdown-ish renderer (`lib/email/render.ts`)

Ported from office-hours' formatting helpers. Pure functions, fully unit-tested.

**Files:**
- Create: `lib/email/render.ts`
- Test: `tests/email-render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderTemplate, substitute } from "../lib/email/render";

describe("substitute", () => {
  it("replaces known tokens and leaves unknown ones", () => {
    expect(substitute("Hi {{firstName}} {{x}}", { firstName: "Ada" })).toBe("Hi Ada {{x}}");
  });
});

describe("renderTemplate", () => {
  it("renders bold, italic, links, and paragraphs; strips markup in text", () => {
    const r = renderTemplate(
      { subject: "Hello {{name}}", body: "Hi **there**,\nline two\n\n[Click]({{url}})" },
      { name: "Ada", url: "https://x.co" },
    );
    expect(r.subject).toBe("Hello Ada");
    expect(r.html).toContain("<strong>there</strong>");
    expect(r.html).toContain('<a href="https://x.co"');
    expect(r.html).toContain("<br/>"); // "Hi there," and "line two" share a paragraph
    expect(r.html.match(/<p /g)?.length).toBe(2); // blank line splits paragraphs
    expect(r.text).toContain("Click: https://x.co");
    expect(r.text).not.toContain("**");
  });

  it("cleans up empty parens/dangling dashes in subjects", () => {
    expect(renderTemplate({ subject: "Event ({{missing}})", body: "" }, {}).subject).toBe("Event ({{missing}})");
    expect(renderTemplate({ subject: "Notion 101 — {{x}}", body: "" }, {}).subject).toBe("Notion 101");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email-render.test.ts`
Expected: FAIL — cannot find module `../lib/email/render`.

- [ ] **Step 3: Implement `lib/email/render.ts`**

```ts
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Blank line = new paragraph; consecutive non-blank lines join with <br/>. */
function toParagraphs(bodyLines: string[], fmt: (s: string) => string): string {
  const paras: string[][] = [];
  let cur: string[] = [];
  for (const l of bodyLines) {
    if (l.trim() === "") { if (cur.length) { paras.push(cur); cur = []; } }
    else cur.push(l);
  }
  if (cur.length) paras.push(cur);
  return paras
    .map((p) => `<p style="margin:0 0 10px;line-height:1.45">${p.map(fmt).join("<br/>")}</p>`)
    .join("");
}

function inlineFormat(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="font-weight:700">$1</a>');
  out = out.replace(/(^|[^"=>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" style="font-weight:700">$2</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

/** Replace {{token}} with known values; unknown tokens are left untouched. */
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Drop empty "()", dangling "— "/"at", collapse spaces. */
function cleanupSubject(s: string): string {
  return s.replace(/\s*\(\s*\)/g, "").replace(/\s+(—|at)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
}

const wrapDiv = (inner: string) =>
  `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${inner}</div>`;

/** Render an editable template's subject + body against placeholder values. */
export function renderTemplate(
  content: { subject: string; body: string },
  vars: Record<string, string>,
): { subject: string; html: string; text: string } {
  const subject = cleanupSubject(substitute(content.subject, vars));
  const lines = substitute(content.body, vars).split("\n");
  return {
    subject,
    html: wrapDiv(toParagraphs(lines, inlineFormat)),
    text: lines.map(stripInline).join("\n"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/email-render.test.ts`
Expected: PASS (both suites).

- [ ] **Step 5: Commit**

```bash
git add lib/email/render.ts tests/email-render.test.ts
git commit -m "feat(email): markdown-ish template renderer"
```

---

## Task 3: Template registry (`lib/email/templates.ts` rewrite)

Replaces `renderEmail()` with data templates + `renderKind()`. **This changes the public API of `templates.ts`; Tasks 6–8 update the callers.**

**Files:**
- Rewrite: `lib/email/templates.ts`
- Test: `tests/email-templates.test.ts` (replace existing — it currently tests `renderEmail`)

- [ ] **Step 1: Rewrite the test file**

```ts
import { describe, it, expect } from "vitest";
import { TEMPLATE_REGISTRY, renderKind, buildVars, SAMPLE_FIELDS, type EmailKind } from "../lib/email/templates";

const KINDS: EmailKind[] = ["approved", "decline", "upgrade_3d", "reminder_1d_free", "reminder_1d_paid", "feedback"];

describe("TEMPLATE_REGISTRY", () => {
  it("has every kind with audience + when labels", () => {
    for (const k of KINDS) {
      expect(TEMPLATE_REGISTRY[k]).toBeTruthy();
      expect(TEMPLATE_REGISTRY[k].audience.length).toBeGreaterThan(0);
      expect(TEMPLATE_REGISTRY[k].when.length).toBeGreaterThan(0);
    }
  });
});

describe("buildVars", () => {
  it("derives firstName and maps links", () => {
    const v = buildVars({ ...SAMPLE_FIELDS, guestName: "Ada Lovelace" });
    expect(v.firstName).toBe("Ada");
    expect(v.trialLink).toBe(SAMPLE_FIELDS.freeTrialUrl);
  });
});

describe("renderKind", () => {
  it("renders the default subject/body for a kind", () => {
    const r = renderKind("feedback", { ...SAMPLE_FIELDS, guestName: "Ada" });
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.html).toContain("Ada");
  });

  it("prefers a published override over the default", () => {
    const overrides = new Map([["feedback", { subject: "Custom subj", body: "Custom **body**" }]]);
    const r = renderKind("feedback", { ...SAMPLE_FIELDS, guestName: "Ada" }, overrides);
    expect(r.subject).toBe("Custom subj");
    expect(r.html).toContain("<strong>body</strong>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email-templates.test.ts`
Expected: FAIL — `renderKind`/`TEMPLATE_REGISTRY` not exported.

- [ ] **Step 3: Rewrite `lib/email/templates.ts`**

```ts
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
      "Great news — you're **approved for {{eventName}}**. We can't wait to build with you!", "",
      "A calendar invite is attached so the time is locked in.", "",
      "Event page: {{eventUrl}}", "",
      "New to Notion? **[Start a free Notion trial]({{trialLink}})** before you come.", "",
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
      "Thanks so much for your interest in **{{eventName}}**. Unfortunately we weren't able to confirm you a spot this time — these sessions fill up fast.", "",
      "We'd love to see you at a future event. In the meantime, you can keep building: **[start a free Notion trial]({{trialLink}})**.", "",
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
      "Before you arrive, **[start your free Notion trial]({{trialLink}})** — it takes about a minute. You'll get much more out of the session with a full-featured workspace ready to go.", "",
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
  { token: "{{eventDate}}", desc: "Event date, e.g. Monday, December 18" },
  { token: "{{eventUrl}}", desc: "Public Luma event page" },
  { token: "{{trialLink}}", desc: "Free Notion trial URL" },
  { token: "{{feedbackLink}}", desc: "Post-event feedback form URL" },
];

const firstName = (n: string | null) => (n ?? "there").trim().split(/\s+/)[0] || "there";

/** Map EmailFields → placeholder token values. */
export function buildVars(f: EmailFields): Record<string, string> {
  return {
    firstName: firstName(f.guestName),
    eventName: f.eventName ?? "Notion 101",
    eventDate: f.eventDate ?? "",
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
  location: null,
  surveyUrl: "https://example.com/feedback",
  freeTrialUrl: "https://www.notion.so/product",
  eventUrl: "https://luma.com/notion101",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/email-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts tests/email-templates.test.ts
git commit -m "feat(email): editable template registry with segment labels"
```

---

## Task 4: Plan segmentation (`lib/email/segment.ts`)

**Files:**
- Create: `lib/email/segment.ts`
- Test: `tests/email-segment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { planSegment } from "../lib/email/segment";

const QMAP = { ialukd7h: { prop: "Notion Plan", kind: "select" } };

describe("planSegment", () => {
  it("treats Free and No Account as free", () => {
    expect(planSegment({ ialukd7h: "Free" }, QMAP)).toBe("free");
    expect(planSegment({ ialukd7h: "No Account" }, QMAP)).toBe("free");
  });
  it("treats Plus/Business/Enterprise as paid", () => {
    expect(planSegment({ ialukd7h: "Plus" }, QMAP)).toBe("paid");
    expect(planSegment({ ialukd7h: "Business" }, QMAP)).toBe("paid");
    expect(planSegment({ ialukd7h: "Enterprise" }, QMAP)).toBe("paid");
  });
  it("treats blank/unknown/missing as free", () => {
    expect(planSegment({ ialukd7h: "" }, QMAP)).toBe("free");
    expect(planSegment({}, QMAP)).toBe("free");
    expect(planSegment(null, QMAP)).toBe("free");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email-segment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/email/segment.ts`**

```ts
interface QMapEntry { prop: string; kind: string }
type QMap = Record<string, QMapEntry>;

const PAID = new Set(["Plus", "Business", "Enterprise"]);

/**
 * Segment a guest by their Notion-plan registration answer.
 * Paid = Plus/Business/Enterprise; everything else (Free, No Account,
 * blank, unknown, missing) = free, so they still get the upgrade nudge.
 * The plan question is found via QUESTION_MAP (prop === "Notion Plan"),
 * so it survives cloned events with different question ids.
 */
export function planSegment(
  answers: Record<string, unknown> | null | undefined,
  questionMap: QMap,
): "free" | "paid" {
  const qid = Object.keys(questionMap).find((k) => questionMap[k].prop === "Notion Plan");
  const value = qid && answers ? String(answers[qid] ?? "").trim() : "";
  return PAID.has(value) ? "paid" : "free";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/email-segment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/segment.ts tests/email-segment.test.ts
git commit -m "feat(email): plan-based guest segmentation"
```

---

## Task 5: Overrides DB access (`lib/db/email-overrides.ts`)

Neon rewrite of office-hours' Supabase version. No unit test (DB integration); verified via the editor in Task 12 and a manual query here.

**Files:**
- Create: `lib/db/email-overrides.ts`

- [ ] **Step 1: Implement**

```ts
import { sql } from "./client";
import type { OverrideMap } from "../email/templates";

export interface OverrideRow {
  key: string;
  draft_subject: string | null;
  draft_body: string | null;
  draft_note: string | null;
  draft_updated_at: string | null;
  live_subject: string | null;
  live_body: string | null;
  live_updated_at: string | null;
}

/** All override rows (draft + live) for the editor. */
export async function listOverrides(): Promise<OverrideRow[]> {
  return (await sql`select * from email_overrides`) as OverrideRow[];
}

/** Map of kind → published subject/body, only where a live override exists. */
export async function getLiveOverrideMap(): Promise<OverrideMap> {
  const rows = (await sql`select key, live_subject, live_body from email_overrides`) as {
    key: string; live_subject: string | null; live_body: string | null;
  }[];
  const map: OverrideMap = new Map();
  for (const r of rows) {
    if (r.live_subject != null || r.live_body != null) {
      map.set(r.key, { subject: r.live_subject, body: r.live_body });
    }
  }
  return map;
}

/** Upsert a draft. */
export async function saveDraft(key: string, subject: string, body: string, note: string | null): Promise<void> {
  await sql`
    insert into email_overrides (key, draft_subject, draft_body, draft_note, draft_updated_at)
    values (${key}, ${subject}, ${body}, ${note}, now())
    on conflict (key) do update set
      draft_subject = excluded.draft_subject,
      draft_body = excluded.draft_body,
      draft_note = excluded.draft_note,
      draft_updated_at = now()
  `;
}

/** Copy draft → live, then clear the draft. No-op if there is no draft. */
export async function publishDraft(key: string): Promise<void> {
  await sql`
    update email_overrides set
      live_subject = draft_subject,
      live_body = draft_body,
      live_updated_at = now(),
      draft_subject = null, draft_body = null, draft_note = null, draft_updated_at = null
    where key = ${key} and (draft_subject is not null or draft_body is not null)
  `;
}

/** Clear the draft (leaves live untouched). */
export async function discardDraft(key: string): Promise<void> {
  await sql`
    update email_overrides set
      draft_subject = null, draft_body = null, draft_note = null, draft_updated_at = null
    where key = ${key}
  `;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/db/email-overrides.ts
git commit -m "feat(db): email_overrides CRUD (Neon)"
```

---

## Task 6: Repoint the send path (`comms.ts`)

**Files:**
- Modify: `lib/email/comms.ts`

- [ ] **Step 1: Update imports and rendering**

Replace the import line:
```ts
import { renderEmail, type EmailKind, type EmailFields } from "./templates";
```
with:
```ts
import { renderKind, type EmailKind, type EmailFields } from "./templates";
import { getLiveOverrideMap } from "../db/email-overrides";
```

Replace `const rendered = renderEmail(kind, fields);` with:
```ts
    const overrides = await getLiveOverrideMap();
    const rendered = renderKind(kind, fields, overrides);
```

Leave everything else (ICS attachment on `approved`, `reserveCommsSlot`/`finalizeComms`, error logging) unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (callers in Tasks 7–8 still reference old kinds until updated — if tsc errors on `reminder_3d`/`survey`, proceed to Tasks 7–8 which fix them, then re-run).

- [ ] **Step 3: Commit**

```bash
git add lib/email/comms.ts
git commit -m "feat(email): render sends from registry + published overrides"
```

---

## Task 7: Segmented reminder dispatch (`lib/events/reminders.ts`)

**Files:**
- Rewrite: `lib/events/reminders.ts`
- Test: `tests/reminder-select.test.ts` (replace existing `reminderKindForEvent` test)

- [ ] **Step 1: Rewrite the test**

```ts
import { describe, it, expect } from "vitest";
import { reminderPlanForEvent } from "../lib/events/reminders";

const now = new Date("2026-12-15T12:00:00Z");

describe("reminderPlanForEvent", () => {
  it("returns upgrade_3d window 3 days out", () => {
    // event starts 2026-12-18 → 3 days before 12-15
    expect(reminderPlanForEvent("2026-12-18T19:00:00Z", now)).toBe("three_day");
  });
  it("returns one_day window 1 day out", () => {
    expect(reminderPlanForEvent("2026-12-16T19:00:00Z", now)).toBe("one_day");
  });
  it("returns null otherwise", () => {
    expect(reminderPlanForEvent("2026-12-25T19:00:00Z", now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reminder-select.test.ts`
Expected: FAIL — `reminderPlanForEvent` not exported.

- [ ] **Step 3: Rewrite `lib/events/reminders.ts`**

```ts
import { listEvents } from "../db/events";
import { listApprovedForEvent } from "../db/guests";
import { sendGuestEmail } from "../email/comms";
import { isWithinDaysBefore } from "./dates";
import { planSegment } from "../email/segment";
import { QUESTION_MAP } from "../notion/schema";

/** Which reminder window (if any) an event's start warrants relative to `now`. */
export function reminderPlanForEvent(startIso: string, now: Date): "three_day" | "one_day" | null {
  if (isWithinDaysBefore(startIso, now, 3)) return "three_day";
  if (isWithinDaysBefore(startIso, now, 1)) return "one_day";
  return null;
}

/**
 * Send due reminders, segmented by Notion plan:
 *  - 3 days before → upgrade_3d to Free/No-Account guests only
 *  - 1 day before  → reminder_1d_free (Free) / reminder_1d_paid (paid)
 */
export async function dispatchReminders(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  for (const ev of await listEvents()) {
    if (!ev.start_at) continue;
    const window = reminderPlanForEvent(ev.start_at, now);
    if (!window) continue;
    for (const g of await listApprovedForEvent(ev.id)) {
      const seg = planSegment(g.answers, QUESTION_MAP);
      if (window === "three_day") {
        if (seg === "free") { await sendGuestEmail(g.id, "upgrade_3d"); sent++; }
      } else {
        await sendGuestEmail(g.id, seg === "free" ? "reminder_1d_free" : "reminder_1d_paid");
        sent++;
      }
    }
  }
  return { sent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reminder-select.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/events/reminders.ts tests/reminder-select.test.ts
git commit -m "feat(email): segment reminders by Notion plan"
```

---

## Task 8: Feedback kind (`lib/events/survey.ts`)

**Files:**
- Modify: `lib/events/survey.ts:1` (import comment ok) and the send call

- [ ] **Step 1: Change the send kind**

Replace `await sendGuestEmail(g.id, "survey");` with `await sendGuestEmail(g.id, "feedback");`.
(Leave `dispatchSurvey`/`eventEndedInWindow` names as-is — the cron route already calls them.)

- [ ] **Step 2: Typecheck (whole project should now be clean)**

Run: `npx tsc --noEmit`
Expected: exit 0. If any file still references removed kinds (`reminder_3d`, `reminder_1d`, `survey`), fix those references to the new kinds.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/events/survey.ts
git commit -m "feat(email): post-event feedback replaces survey kind"
```

---

## Task 9: Editor API route (`/api/hub/email-draft`)

Session-gated (dashboard cookie); **no publish passphrase**.

**Files:**
- Create: `app/api/hub/email-draft/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { saveDraft, publishDraft, discardDraft } from "@/lib/db/email-overrides";
import { TEMPLATE_REGISTRY, type EmailKind } from "@/lib/email/templates";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

/** Email-copy editor actions (all require a valid dashboard session). */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { action?: string; key?: string; subject?: string; body?: string; note?: string } = {};
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const key = body.key as EmailKind | undefined;
  if (!key || !(key in TEMPLATE_REGISTRY)) {
    return NextResponse.json({ error: "unknown template key" }, { status: 400 });
  }

  try {
    if (body.action === "save") {
      await saveDraft(key, body.subject ?? "", body.body ?? "", body.note ?? null);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "discard") { await discardDraft(key); return NextResponse.json({ ok: true }); }
    if (body.action === "publish") { await publishDraft(key); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/hub/email-draft/route.ts
git commit -m "feat(email): draft/publish/discard API (session-gated)"
```

---

## Task 10: Email editor component (`components/hub/EmailEditor.tsx`)

Adapted from office-hours: audience badge instead of role, single flat list grouped by journey stage, **publish has no passphrase prompt**.

**Files:**
- Create: `components/hub/EmailEditor.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  TEMPLATE_REGISTRY, PLACEHOLDERS, SAMPLE_FIELDS, buildVars,
  type EmailKind, type TemplateDef,
} from "@/lib/email/templates";
import { renderTemplate } from "@/lib/email/render";

export interface OverrideRow {
  key: string;
  draft_subject: string | null; draft_body: string | null; draft_note: string | null; draft_updated_at: string | null;
  live_subject: string | null; live_body: string | null; live_updated_at: string | null;
}

const STAGES: Array<{ title: string; blurb: string; keys: EmailKind[] }> = [
  { title: "On approval", blurb: "Sent the moment a guest is approved or declined.", keys: ["approved", "decline"] },
  { title: "Before the event", blurb: "Upgrade nudge and day-before reminders, segmented by plan.", keys: ["upgrade_3d", "reminder_1d_free", "reminder_1d_paid"] },
  { title: "After the event", blurb: "Closing the loop and gathering feedback.", keys: ["feedback"] },
];

export function EmailEditor({ overrides }: { overrides: OverrideRow[] }) {
  const router = useRouter();
  const rows = new Map(overrides.map((r) => [r.key, r]));
  const [openKey, setOpenKey] = useState<EmailKind | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function effective(key: EmailKind, row: OverrideRow | undefined) {
    const def = TEMPLATE_REGISTRY[key];
    const liveSubject = row?.live_subject ?? def.subject;
    const liveBody = row?.live_body ?? def.body;
    const hasDraft = !!(row && (row.draft_subject != null || row.draft_body != null));
    const draftSubject = row?.draft_subject ?? liveSubject;
    const draftBody = row?.draft_body ?? liveBody;
    const pending = hasDraft && (draftSubject !== liveSubject || draftBody !== liveBody);
    return { def, liveSubject, liveBody, hasDraft, draftSubject, draftBody, pending };
  }

  function startEdit(key: EmailKind) {
    const e = effective(key, rows.get(key));
    setOpenKey(key); setSubject(e.draftSubject); setBody(e.draftBody); setNote(rows.get(key)?.draft_note ?? "");
  }

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/hub/email-draft", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(`Failed: ${j.error ?? res.status}`); return false; }
      return true;
    } finally { setBusy(false); }
  }

  async function save(key: EmailKind) { if (await post({ action: "save", key, subject, body, note })) { setOpenKey(null); router.refresh(); } }
  async function discard(key: EmailKind) {
    if (!confirm("Discard this draft? The live copy stays as-is.")) return;
    if (await post({ action: "discard", key })) { if (openKey === key) setOpenKey(null); router.refresh(); }
  }
  async function publish(key: EmailKind) {
    if (!confirm("Publish this draft? It becomes the copy that actually sends.")) return;
    if (await post({ action: "publish", key })) { router.refresh(); alert("Published — this copy is now live."); }
  }

  const pendingCount = (Object.keys(TEMPLATE_REGISTRY) as EmailKind[]).filter((k) => effective(k, rows.get(k)).pending).length;

  const renderCard = (k: EmailKind) => {
    const row = rows.get(k);
    const e = effective(k, row);
    const isOpen = openKey === k;
    const previewFrom = { subject: isOpen ? subject : e.draftSubject, body: isOpen ? body : e.draftBody };
    const preview = renderTemplate(previewFrom, buildVars(SAMPLE_FIELDS));
    const def = e.def as TemplateDef;
    return (
      <div key={k} className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
          <span className="font-medium text-neutral-800">{def.label}</span>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800">{def.audience}</span>
          {e.pending ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Pending</span> : null}
          {row?.live_updated_at ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">Customized</span> : null}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => (isOpen ? setOpenKey(null) : startEdit(k))} disabled={busy} className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50">{isOpen ? "Close" : "Edit"}</button>
            {e.pending ? (
              <>
                <button onClick={() => publish(k)} disabled={busy} className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800">Publish</button>
                <button onClick={() => discard(k)} disabled={busy} className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-50">Discard</button>
              </>
            ) : null}
          </div>
        </div>
        <div className="border-b border-neutral-200 bg-neutral-50/50 px-4 py-1.5 text-xs text-neutral-500">
          Sent when: {def.when}
        </div>

        {isOpen ? (
          <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">Subject</label>
              <input value={subject} onChange={(ev) => setSubject(ev.target.value)} className="mb-3 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-neutral-400" />
              <label className="mb-1 block text-xs font-medium text-neutral-500">Body</label>
              <textarea value={body} onChange={(ev) => setBody(ev.target.value)} rows={14} className="w-full rounded-md border border-neutral-200 px-2 py-1.5 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400" />
              <label className="mb-1 mt-3 block text-xs font-medium text-neutral-500">Note (optional)</label>
              <input value={note} onChange={(ev) => setNote(ev.target.value)} className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-neutral-400" />
              <div className="mt-3 flex gap-2">
                <button onClick={() => save(k)} disabled={busy} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800">Save draft</button>
                <button onClick={() => setOpenKey(null)} disabled={busy} className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">Cancel</button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-neutral-500">Placeholders you can use</summary>
                <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-500">
                  {PLACEHOLDERS.map((p) => (<li key={p.token}><code className="rounded bg-neutral-100 px-1">{p.token}</code> — {p.desc}</li>))}
                </ul>
                <p className="mt-1 text-[11px] text-neutral-400">Formatting: <code>**bold**</code>, <code>*italic*</code>, <code>[text](https://…)</code>. Blank line = new paragraph.</p>
              </details>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-neutral-500">Live preview (sample data)</div>
              <div className="rounded-md border border-neutral-200">
                <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-800">{preview.subject}</div>
                <div className="px-3 py-2 text-sm text-neutral-700" dangerouslySetInnerHTML={{ __html: preview.html }} />
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Subject</div>
            <div className="mb-2 text-sm font-semibold text-neutral-800">{preview.subject}</div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Body</div>
            <div className="text-sm text-neutral-500" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm text-neutral-600">
        <span><b className="text-neutral-900">{pendingCount}</b> pending change{pendingCount === 1 ? "" : "s"}</span>
        <span className="text-neutral-400">·</span>
        <span>Editing saves a <b>draft</b>. Publishing makes it the copy that actually sends.</span>
      </div>
      <div className="space-y-10">
        {STAGES.map((stage, i) => (
          <section key={stage.title}>
            <div className="mb-3 flex items-baseline gap-3 border-b-2 border-neutral-900 pb-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">{i + 1}</span>
              <h2 className="text-lg font-bold text-neutral-900">{stage.title}</h2>
              <span className="text-sm text-neutral-400">{stage.blurb}</span>
            </div>
            <div className="space-y-3">{stage.keys.map((k) => renderCard(k))}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/hub/EmailEditor.tsx
git commit -m "feat(email): email editor with audience badges"
```

---

## Task 11: Settings nav, middleware guard, dashboard link

**Files:**
- Create: `components/hub/SettingsNav.tsx`
- Modify: `middleware.ts` (matcher)
- Modify: `components/Dashboard.tsx` (header link)

- [ ] **Step 1: Create `components/hub/SettingsNav.tsx`**

```tsx
import Link from "next/link";

export function SettingsNav({ active }: { active: "emails" | "log" }) {
  const tab = (href: string, key: string, label: string) => (
    <Link href={href} className={`rounded-md px-3 py-1.5 text-sm ${active === key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>{label}</Link>
  );
  return (
    <div className="mb-6 flex items-center gap-2">
      <Link href="/" className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">← Dashboard</Link>
      <span className="text-neutral-300">|</span>
      {tab("/settings/emails", "emails", "Email editor")}
      {tab("/settings/emails/log", "log", "Sent log")}
    </div>
  );
}
```

- [ ] **Step 2: Extend the middleware matcher to guard settings**

In `middleware.ts`, change:
```ts
export const config = {
  matcher: ["/"],
};
```
to:
```ts
export const config = {
  matcher: ["/", "/settings/:path*"],
};
```

- [ ] **Step 3: Add a Settings link to the dashboard header**

In `components/Dashboard.tsx`, inside the header `div` (around line 58-66), add a link next to "Track an event":
```tsx
        <a
          href="/settings/emails"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Emails
        </a>
```
(Place it just before the existing "Track an event" anchor; wrap the two anchors in a `<div className="flex gap-2">` if not already.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/hub/SettingsNav.tsx middleware.ts components/Dashboard.tsx
git commit -m "feat(email): settings nav + guard /settings + dashboard link"
```

---

## Task 12: Email editor page (`/settings/emails`)

**Files:**
- Create: `app/settings/emails/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { SettingsNav } from "@/components/hub/SettingsNav";
import { EmailEditor } from "@/components/hub/EmailEditor";
import { listOverrides } from "@/lib/db/email-overrides";

export const dynamic = "force-dynamic";

export default async function EmailsPage() {
  const overrides = await listOverrides();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <SettingsNav active="emails" />
      <h1 className="mb-1 text-xl font-semibold">Email editor</h1>
      <p className="mb-6 text-sm text-neutral-500">Edit each automated email, save a draft, then publish to go live.</p>
      <EmailEditor overrides={overrides} />
    </main>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npx next build` (or `npm run build`)
Expected: builds without type/route errors.

- [ ] **Step 3: Manual verify locally**

Run: `npm run dev`, log in at `/login`, open `/settings/emails`. Edit `feedback` subject → Save draft → Publish. Confirm the "Customized" badge appears.
Then verify the override persisted:
Run: `psql "$DBURL" -c "select key, live_subject from email_overrides;"`
Expected: a row for `feedback` with your new subject.

- [ ] **Step 4: Commit**

```bash
git add app/settings/emails/page.tsx
git commit -m "feat(email): /settings/emails editor page"
```

---

## Task 13: Sent-email log (`/settings/emails/log`)

**Files:**
- Modify: `lib/db/email-log.ts` (add `listEmailLog`, `listEmailFilterOptions`)
- Create: `components/hub/EmailLog.tsx`
- Create: `app/settings/emails/log/page.tsx`

- [ ] **Step 1: Add query helpers to `lib/db/email-log.ts`**

```ts
export interface EmailLogRow {
  kind: string; recipient_email: string; status: string; created_at: string;
  guest_name: string | null; event_name: string | null;
}

const PAGE_SIZE = 50;

/** One page of sent-email history, newest first, optionally filtered. */
export async function listEmailLog(
  opts: { kind?: string | null; eventId?: string | null; page?: number } = {},
): Promise<{ rows: EmailLogRow[]; hasMore: boolean }> {
  const page = Math.max(0, opts.page ?? 0);
  const kind = opts.kind || null;
  const eventId = opts.eventId || null;
  const rows = (await sql`
    select el.kind, el.recipient_email, el.status, el.created_at,
           g.name as guest_name, ev.name as event_name
    from email_log el
    left join guests g on g.id = el.guest_id
    left join events ev on ev.id = g.event_id
    where (${kind}::text is null or el.kind = ${kind})
      and (${eventId}::uuid is null or ev.id = ${eventId})
    order by el.created_at desc
    limit ${PAGE_SIZE + 1} offset ${page * PAGE_SIZE}
  `) as EmailLogRow[];
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

/** Distinct kinds + events for the log filters. */
export async function listEmailFilterOptions(): Promise<{
  kinds: string[]; events: { id: string; name: string | null }[];
}> {
  const kinds = (await sql`select distinct kind from email_log order by kind`) as { kind: string }[];
  const events = (await sql`select id, name from events order by created_at desc`) as { id: string; name: string | null }[];
  return { kinds: kinds.map((k) => k.kind), events };
}
```

- [ ] **Step 2: Create `components/hub/EmailLog.tsx`**

```tsx
import type { EmailLogRow } from "@/lib/db/email-log";

function fmt(v: string | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

export function EmailLog({ rows }: { rows: EmailLogRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No emails match these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-neutral-50 text-left">
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Recipient</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Sent at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b hover:bg-neutral-50">
              <td className="px-3 py-2">{r.kind}</td>
              <td className="px-3 py-2">{r.recipient_email}</td>
              <td className="px-3 py-2">{r.guest_name ?? "—"}</td>
              <td className="px-3 py-2">{r.event_name ?? "—"}</td>
              <td className="px-3 py-2">{r.status}</td>
              <td className="px-3 py-2 whitespace-nowrap">{fmt(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create `app/settings/emails/log/page.tsx`**

```tsx
import { SettingsNav } from "@/components/hub/SettingsNav";
import { EmailLog } from "@/components/hub/EmailLog";
import { listEmailLog, listEmailFilterOptions } from "@/lib/db/email-log";

export const dynamic = "force-dynamic";

export default async function SentLogPage({
  searchParams,
}: { searchParams: Promise<{ page?: string; kind?: string; event?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? "0") || 0);
  const kind = sp.kind || null;
  const eventId = sp.event || null;

  const [{ rows, hasMore }, opts] = await Promise.all([
    listEmailLog({ kind, eventId, page }),
    listEmailFilterOptions(),
  ]);

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (eventId) p.set("event", eventId);
    p.set("page", String(page));
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <SettingsNav active="log" />
      <h1 className="mb-4 text-xl font-semibold">Sent email log</h1>
      <form className="mb-4 flex flex-wrap gap-2 text-sm" method="GET">
        <select name="kind" defaultValue={kind ?? ""} className="rounded border border-neutral-300 px-2 py-1">
          <option value="">All kinds</option>
          {opts.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select name="event" defaultValue={eventId ?? ""} className="rounded border border-neutral-300 px-2 py-1">
          <option value="">All events</option>
          {opts.events.map((e) => <option key={e.id} value={e.id}>{e.name ?? e.id}</option>)}
        </select>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1 text-white">Filter</button>
      </form>

      <EmailLog rows={rows} />

      <div className="mt-4 flex items-center justify-between text-sm">
        {page > 0 ? <a className="underline" href={qs({ page: page - 1 })}>← Newer</a> : <span />}
        {hasMore ? <a className="underline" href={qs({ page: page + 1 })}>Older →</a> : <span />}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Build + typecheck**

Run: `npx tsc --noEmit && npx next build`
Expected: exit 0, clean build.

- [ ] **Step 5: Manual verify**

`npm run dev`, log in, open `/settings/emails/log`. Confirm rows render and the kind/event filters work.

- [ ] **Step 6: Commit**

```bash
git add lib/db/email-log.ts components/hub/EmailLog.tsx app/settings/emails/log/page.tsx
git commit -m "feat(email): filterable sent-email log page"
```

---

## Task 14: Full verification + deploy

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: all tests pass, no type errors, clean build.

- [ ] **Step 2: Deploy**

Run: `vercel --prod --yes`
Expected: exit 0.

- [ ] **Step 3: Smoke-test prod**

- Log in at `/login`, open `/settings/emails` and `/settings/emails/log`.
- Edit + publish one email; confirm "Customized" badge and the DB row.
- Confirm `/api/hub/email-draft` rejects unauthenticated POSTs:
  Run: `node -e 'fetch("https://notion-101.vercel.app/api/hub/email-draft",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(r=>console.log(r.status))'`
  Expected: `401`.

- [ ] **Step 4: Confirm email set end-to-end (optional, no live send)**

With `COMMS_ENABLED` off or via a dry run, trigger `/api/cron/reminders` and `/api/cron/survey` and check `sync_log`/`email_log` for the new kinds (`upgrade_3d`, `reminder_1d_free`, `reminder_1d_paid`, `feedback`).

---

## Self-review notes

- **Spec coverage:** email set + segmentation (Tasks 3,4,7,8); editing infra registry/renderer/overrides (Tasks 2,3,5); editor UI + audience labels (Tasks 10,12); log (Task 13); nav + guard (Task 11); send-path preserves ICS + idempotency (Task 6). ✅
- **Removed kinds:** `reminder_3d`, `reminder_1d`, `survey` are eliminated in Tasks 3/7/8; Task 8 Step 2 explicitly greps for stragglers. Historical `email_log` rows with old kinds remain (harmless; log just shows them).
- **No passphrase:** Task 9/10 drop office-hours' `HUB_PUBLISH_SECRET`. Dashboard session is the gate.
- **Type consistency:** `EmailKind`, `renderKind`, `TemplateDef`, `OverrideMap`, `planSegment(answers, questionMap)`, `getLiveOverrideMap` used consistently across tasks.

# Notion 101 — Email editing UI + revised email set

**Date:** 2026-08-25
**Status:** Approved design (Approach A)

## Goal

Give the Notion 101 dashboard an **email editor** (edit each automated email's copy in the
UI, save a draft, publish to go live) and a **filterable sent-email log**, modeled on the
existing office-hours hub. As part of this, replace the current hardcoded email set with the
attendee-journey emails Nancy wants, segmented by the guest's Notion plan.

Reviewing the actual email copy happens **in the editor** (the copy is editable data), not in
prose here — so this spec fixes structure, segmentation, and behavior, not final wording.

## 1. Email set

Current kinds (`approved`, `decline`, `reminder_3d`, `reminder_1d`, `survey`) are replaced by:

| Kind | Sent when | Audience (segment) | Purpose | Based on (office-hours) |
|---|---|---|---|---|
| `approved` | on approval | All approved guests | Confirmation + calendar invite (unchanged behavior) | — |
| `decline` | on decline | Declined guests | Polite decline | — |
| `upgrade_3d` | 3 days before | **Free & No-Account plans only** | Nudge to upgrade / start a free Notion trial before the event | `prep_reminder__guest` |
| `reminder_1d_free` | 1 day before | **Free & No-Account plans only** | Bring laptop **+ upgrade** the account | `prep_reminder_day_before__guest` |
| `reminder_1d_paid` | 1 day before | **Paid plans (Plus / Business / Enterprise)** | Bring laptop (no upgrade line) | `prep_reminder_day_before_paid__guest` |
| `feedback` | after the event | Checked-in attendees | Post-event feedback form | `feedback_request__guest` |

## 2. Segmentation

- Source of truth: the guest's **Notion Plan** registration answer (Luma question `ialukd7h`,
  mapped to the `Notion Plan` column via `QUESTION_MAP.json`), stored in `guests.answers`.
- Options: `Enterprise`, `Business`, `Plus`, `Free`, `No Account`.
- **Free segment** = `Free` or `No Account`. **Blank / unknown** is treated as Free (they still
  get the upgrade nudge; low harm).
- **Paid segment** = `Plus`, `Business`, `Enterprise`.
- A small helper `planSegment(answers): "free" | "paid"` centralizes this rule (unit-tested).

## 3. Editing infrastructure (Approach A)

Adopt office-hours' data-template approach:

- **Template registry**: convert the six emails into `TEMPLATE_REGISTRY: Record<Kind, TemplateDef>`
  where `TemplateDef = { label, audience, when, subject, body }`. `body` is markdown-ish text
  with `{{placeholders}}`. `audience` and `when` are new fields driving the editor's segment label.
- **Renderer**: port `renderTemplate` (markdown → HTML: `**bold**`, `*italic*`, `[text](url)`,
  blank-line paragraphs) and `buildVars` from office-hours. Placeholders for Notion 101:
  `{{firstName}}`, `{{eventName}}`, `{{eventDate}}`, `{{eventUrl}}`, `{{trialLink}}`,
  `{{feedbackLink}}`. A `PLACEHOLDERS` legend + `SAMPLE_FIELDS` power the editor preview.
- **Overrides table** (new): `email_overrides` keyed by template key, holding draft and live
  subject/body:
  ```sql
  create table if not exists email_overrides (
    key text primary key,
    draft_subject text, draft_body text, draft_note text, draft_updated_at timestamptz,
    live_subject text, live_body text, live_updated_at timestamptz
  );
  ```
- **Effective copy**: `live_*` override → else registry default. Editing writes `draft_*`;
  publishing copies draft → live.

## 4. Editor UI

- Route **`/settings/emails`** rendering the ported `EmailEditor`.
- One card per email. Card header shows a prominent **Audience badge** (e.g.
  "Free & No-Account plans only") and a **"Sent when"** line — so the segment is unmistakable.
- Per card: **Edit** (subject + body + optional note), **live preview** with sample data,
  **Save draft**, **Publish**, **Discard**. Pending drafts show a diff (live vs proposed).
- Cards grouped by journey stage: *On approval* (`approved`, `decline`),
  *Before the event* (`upgrade_3d`, `reminder_1d_free`, `reminder_1d_paid`), *After* (`feedback`).
- **Publish gate**: dashboard login only (no separate passphrase). The draft→publish step is the
  safety. `/api/hub/email-draft` (ported) handles `save` / `discard` / `publish`, protected by the
  existing dashboard session.

## 5. Email log

- Route **`/settings/emails/log`** — filterable by kind and event, paginated, reading the existing
  `email_log` (joined to guests/events for name + event). Simpler than office-hours'
  correspondence grouping.
- **Settings nav** component linking Dashboard ↔ Emails ↔ Log; shown on settings pages.

## 6. Send-path & cron changes

- `comms.ts`: replace `renderEmail(kind, fields)` with a registry+override renderer
  `renderKind(kind, fields, override)`. **The `approved` ICS calendar attachment and email_log
  idempotency stay exactly as-is** — the editor only governs subject/body copy.
- `lib/events/reminders.ts` (`dispatchReminders`): within each lead window, segment approved
  guests by `planSegment` and send `upgrade_3d` (3d, free only), `reminder_1d_free` /
  `reminder_1d_paid` (1d, by segment). Survey cron → send `feedback`.
- `EmailKind` type updated to the new set. Idempotency keys change with the new kind names
  (no historical collisions since these are new kinds).

## 7. Non-goals

- No WYSIWYG editor (markdown-ish textarea + preview, like office-hours).
- No per-event copy overrides (overrides are global per template).
- Not porting admins / slack / backups / bookings tabs — email editing + log only.
- No styled CTA buttons; links render as inline markdown links (minor visual change from the
  current hardcoded buttons).

## 8. Testing

- `planSegment` unit tests (Free/No Account/Plus/blank).
- `renderTemplate` tests (bold/italic/link/paragraph) and placeholder substitution.
- Effective-copy resolution (draft vs live vs default).
- Reminder dispatch segmentation (right kind per plan + lead window).
- Existing email/comms tests updated for the new kinds.

## 9. Rollout

1. Migration for `email_overrides` (additive; no existing-table changes).
2. Ship code; defaults come from the registry so nothing needs configuring to keep sending.
3. Nancy reviews/edits copy in `/settings/emails`, publishes.

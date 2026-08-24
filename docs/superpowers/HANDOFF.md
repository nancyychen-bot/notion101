# Notion 101 — Handoff / Resume Notes

**Last updated:** 2026-08-24
**Status:** Design + plan COMPLETE. Implementation NOT yet started.

## How to resume (paste this to a fresh Claude session)

> Resume the Notion 101 build. Read `docs/superpowers/specs/2026-08-24-notion-101-luma-notion-sync-design.md`
> and `docs/superpowers/plans/2026-08-24-notion-101-luma-notion-sync.md`, then execute the plan
> using the superpowers:subagent-driven-development skill, starting at Task 0.1. Work on the
> `feat/implementation` branch. Nothing in the plan has been implemented yet.

## Where things stand

- **Repo:** standalone git repo at `Apps Created/Notion 101` (created via `git init`). **No remote yet.**
- **Branch:** `feat/implementation` (currently identical to `main` — only docs are committed).
- **Committed so far (docs only):**
  - `docs/superpowers/specs/2026-08-24-notion-101-luma-notion-sync-design.md` — approved design spec
  - `docs/superpowers/plans/2026-08-24-notion-101-luma-notion-sync.md` — full implementation plan (9 phases, 26 tasks, TDD, full code)
- **No source code written yet.** `package.json`, `lib/`, `app/`, etc. do not exist.

## Reference project (copy source)

`Apps Created/office-hours` (Notion Build Bar Hub). The plan's copy-and-adapt steps point at
specific files there: `lib/luma/*`, `lib/email/*`, `lib/auth/*`, `lib/events/register.ts`,
`lib/events/decline-pending.ts`, `app/add-event`, `middleware.ts`. Same Mac/iCloud has it.

## Execution method chosen

Subagent-Driven Development: one implementer subagent per plan task, then a spec-compliance
review, then a code-quality review, then next task — no stopping between tasks. Was about to
dispatch the Task 0.1 implementer when the session was interrupted.

## Task checklist (recreate in the task tracker on resume — tracker state is session-local)

- [ ] 0.1 Scaffold Next.js + tooling
- [ ] 0.2 Environment access layer (`lib/env.ts`, `.env.example`)
- [ ] 1.1 Neon DDL + DB client
- [ ] 1.2 sync-log + events modules + date helpers
- [ ] 1.3 guests + email-log modules
- [ ] 2.1 Luma types + client
- [ ] 2.2 Luma verify + parse
- [ ] 3.1 Notion client + schema + hash
- [ ] 3.2 Notion mappers
- [ ] 3.3 Notion push
- [ ] 4.1 Resend + ICS
- [ ] 4.2 Email templates
- [ ] 4.3 Comms orchestrator
- [ ] 5.1 apply-status
- [ ] 5.2 Event registration + backfill
- [ ] 5.3 decline-pending, reminders, survey
- [ ] 6.1 Health + cron auth
- [ ] 6.2 Luma webhook route
- [ ] 6.3 Notion webhook route
- [ ] 6.4 Cron routes + vercel.json
- [ ] 7.1 create-notion-database script
- [ ] 7.2 register-event CLI
- [ ] 8.1 Dashboard auth
- [ ] 8.2 Add-event signup page
- [ ] 8.3 Dashboard + manual actions
- [ ] 9.1 Full suite, build, README
- [ ] 9.2 Deployment checklist (manual, at deploy time)

## Credentials needed before live verification (not required to write code + unit tests)

Neon `DATABASE_URL`, `LUMA_API_KEY` + `LUMA_WEBHOOK_SECRET`, `NOTION_TOKEN` +
`NOTION_GUESTS_DATA_SOURCE_ID` + `NOTION_WEBHOOK_SECRET`, `RESEND_API_KEY` + `COMMS_FROM`,
`CRON_SECRET`, `DASHBOARD_PASSWORD` + `SESSION_SECRET`, `SURVEY_URL`, `FREE_TRIAL_URL`.
Code and Vitest tests can be completed without these; live steps (apply schema, setup:notion,
webhook config) are deferred to the Phase 9 deployment checklist.

## Optional: push to GitHub for cross-machine safety

No git remote is configured. To back up off this machine:
`gh repo create nchen-notion/notion-101 --private --source . --push`
(iCloud already holds the files, so another account on THIS Mac needs no push.)

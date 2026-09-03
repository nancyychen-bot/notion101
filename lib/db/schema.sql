create extension if not exists "pgcrypto";

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  luma_event_id text unique not null,
  name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  public_url text,
  survey_url text,
  location text,
  created_at timestamptz not null default now()
);

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  luma_guest_id text unique not null,
  name text,
  email text,
  luma_status text not null default 'pending',
  checked_in_at timestamptz,
  answers jsonb,
  notion_page_id text,
  last_synced_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guests_event_idx on guests(event_id);
create index if not exists guests_notion_page_idx on guests(notion_page_id);

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references guests(id) on delete cascade,
  kind text not null,
  recipient_email text not null,
  resend_id text,
  status text not null,
  created_at timestamptz not null default now(),
  unique (guest_id, kind, recipient_email)
);

create table if not exists sync_log (
  id uuid primary key default gen_random_uuid(),
  direction text,
  action text,
  result text,
  guest_id uuid,
  note text,
  payload jsonb,
  created_at timestamptz not null default now()
);

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

create table if not exists feedback (
  notion_page_id   text primary key,
  event_id         uuid references events(id) on delete set null,
  guest_id         uuid references guests(id) on delete set null,
  respondent_name  text,
  respondent_email text,
  satisfaction_score  int,
  satisfaction_label  text,
  confidence       text,
  interests        text[],
  feature_intent   text,
  highlight        text,
  submitted_at     timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists feedback_event_idx on feedback(event_id);

create table if not exists volunteer_feedback (
  ambassador_page_id text primary key,
  dev_page_id        text,
  event_id           uuid references events(id) on delete set null,
  volunteer_name     text,
  volunteer_type     text,
  city               text,
  tracks             text[],
  preparedness_label text,
  preparedness_score int,
  experience_label   text,
  experience_score   int,
  what_worked        text,
  challenges         text,
  improvements       text,
  submitted_at       timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists volunteer_feedback_event_idx on volunteer_feedback(event_id);

create table if not exists luma_calendars (
  id             text primary key,
  api_key        text not null,
  webhook_secret text,
  calendar_id    text,
  city           text,
  calendar_url   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists luma_calendars_calendar_id_idx on luma_calendars(calendar_id);

alter table events add column if not exists luma_calendar text;

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

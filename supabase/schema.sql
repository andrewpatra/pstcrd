-- PSTCRD database + private video storage migration.
-- Safe to run against the existing text-only prototype.

create extension if not exists pgcrypto;

create table if not exists public.recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  consent_status text not null default 'pending'
    check (consent_status in ('pending', 'approved', 'revoked')),
  consent_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.recipients(id) on delete cascade,
  sender_name text not null,
  message_text text not null,
  video_path text,
  video_mime_type text,
  video_size_bytes integer,
  poster_path text,
  poster_mime_type text,
  poster_size_bytes integer,
  status text not null default 'pending_consent'
    check (status in ('uploading', 'pending_consent', 'sent', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz not null default (now() + interval '3 days')
);

-- Existing installations need the new video columns/constraint.
alter table public.messages add column if not exists video_path text;
alter table public.messages add column if not exists video_mime_type text;
alter table public.messages add column if not exists video_size_bytes integer;
alter table public.messages add column if not exists poster_path text;
alter table public.messages add column if not exists poster_mime_type text;
alter table public.messages add column if not exists poster_size_bytes integer;
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('uploading', 'pending_consent', 'sent', 'declined', 'expired'));

create table if not exists public.consent_tokens (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.recipients(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  action text not null check (action in ('accept', 'decline', 'unsubscribe')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz
);

create index if not exists messages_recipient_id_idx on public.messages(recipient_id);
create index if not exists consent_tokens_token_idx on public.consent_tokens(token);

alter table public.recipients enable row level security;
alter table public.messages enable row level security;
alter table public.consent_tokens enable row level security;

-- Private bucket. Files are accessed through signed URLs generated server-side.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  false,
  2097152,
  array['video/mp4', 'video/webm', 'image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['video/mp4', 'video/webm', 'image/jpeg'];

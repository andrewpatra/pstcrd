-- PSTCRD database and private GIF storage for the video postcard prototype.

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
  message_text text not null default '',
  gif_path text,
  gif_mime_type text,
  gif_size_bytes bigint,
  status text not null default 'pending_consent'
    check (status in ('pending_consent', 'sent', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz not null default (now() + interval '3 days')
);

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

-- Private storage bucket for GIF postcards.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('postcards', 'postcards', false, 3000000, array['image/gif'])
on conflict (id) do update
set public = false,
    file_size_limit = 3000000,
    allowed_mime_types = array['image/gif'];

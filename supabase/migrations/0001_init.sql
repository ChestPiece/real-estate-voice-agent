create table clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  slug text unique not null,
  name text not null
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid not null references clients,
  persona_name text not null,
  brokerage_name text not null,
  agent_name text not null,
  voice text not null default 'verse',
  prompt_vars jsonb not null default '{}',
  calling_start text not null default '09:00',
  calling_end text not null default '18:00',
  transfer_number text
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid not null references clients,
  name text,
  phone text not null,
  property text,
  source text not null default 'api',
  qualification jsonb,
  viewing jsonb
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid not null references leads,
  twilio_sid text unique not null,
  status text not null,
  transcript jsonb,
  ended_at timestamptz
);

-- RLS on, no policies: only the service-role key gets in until client logins (Phase 2).
alter table clients enable row level security;
alter table agents enable row level security;
alter table leads enable row level security;
alter table calls enable row level security;

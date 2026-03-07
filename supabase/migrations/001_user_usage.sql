-- User usage and plans for AI Assistant
create table if not exists public.user_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes_used numeric not null default 0,
  sessions_used int not null default 0,
  plan text not null default 'free' check (plan in ('free', 'pack_3', 'pack_10', 'unlimited')),
  sessions_remaining int not null default 0,
  plan_expires_at timestamptz,
  stripe_customer_id text,
  updated_at timestamptz not null default now(),
  unique(user_id)
);

-- RLS: users can only read/update their own row
alter table public.user_usage enable row level security;

create policy "Users can read own usage"
  on public.user_usage for select
  using (auth.uid() = user_id);

create policy "Users can update own usage"
  on public.user_usage for update
  using (auth.uid() = user_id);

create policy "Users can insert own usage"
  on public.user_usage for insert
  with check (auth.uid() = user_id);

-- Index for fast lookup
create index if not exists user_usage_user_id_idx on public.user_usage(user_id);

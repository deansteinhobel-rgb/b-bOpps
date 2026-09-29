-- Client goals (Dean, 2026-09-29): the business number an account is judged on, entered by hand
-- because it lives outside the ad platforms (e.g. DNSFilter's "Activated Free Trials (non PLG)",
-- target 300 a month, tracked weekly). Shown at the top of the Account tab. The client's team reads;
-- admins and GTM leads set the figures. No deletes.
create table public.client_goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  monthly_target numeric(14, 2),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index client_goals_client_idx on public.client_goals (client_id, position);

-- One figure per goal per month: the month-to-date count, updated as the month goes on.
create table public.client_goal_values (
  goal_id uuid not null references public.client_goals (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  value numeric(14, 2) not null check (value >= 0),
  target numeric(14, 2),               -- the target for that month (defaults to the goal's)
  updated_by_profile_id uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (goal_id, month)
);

alter table public.client_goals enable row level security;
alter table public.client_goal_values enable row level security;
create policy "goals: read assigned" on public.client_goals for select to authenticated using (public.can_access_client(client_id));
create policy "goals: admins create" on public.client_goals for insert to authenticated with check (public.is_admin());
create policy "goals: admins update" on public.client_goals for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "goal values: read assigned" on public.client_goal_values for select to authenticated using (public.can_access_client(client_id));
create policy "goal values: admins create" on public.client_goal_values for insert to authenticated with check (public.is_admin());
create policy "goal values: admins update" on public.client_goal_values for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- No delete policies.

-- DNSFilter's goal, with this month's and last month's figures (Dean, 2026-09-29).
with g as (
  insert into public.client_goals (client_id, name, monthly_target)
  select id, 'Activated Free Trials (non PLG)', 300 from public.clients where slug = 'dnsfilter'
  returning id, client_id
)
insert into public.client_goal_values (goal_id, client_id, month, value, target, updated_by_profile_id)
select g.id, g.client_id, v.month::date, v.value, 300, null
from g, (values ('2026-09-01', 243), ('2026-08-01', 189)) as v (month, value);

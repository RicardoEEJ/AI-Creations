create table if not exists public.steady_user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  board_state jsonb not null check (jsonb_typeof(board_state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.steady_user_data enable row level security;

drop policy if exists "Users can read their own Steady board"
  on public.steady_user_data;
create policy "Users can read their own Steady board"
  on public.steady_user_data
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Steady board"
  on public.steady_user_data;
create policy "Users can create their own Steady board"
  on public.steady_user_data
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Steady board"
  on public.steady_user_data;
create policy "Users can update their own Steady board"
  on public.steady_user_data
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.steady_user_data to authenticated;

create or replace function public.set_steady_user_data_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_steady_user_data_updated_at
  on public.steady_user_data;
create trigger set_steady_user_data_updated_at
  before update on public.steady_user_data
  for each row
  execute function public.set_steady_user_data_updated_at();

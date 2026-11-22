-- ============================================================
-- migration_v0981_monitoring.sql — v0.9.81 (R-09 monitoring chyb)
--
-- Tabulka client_errors: appka sem posílá neočekávané JS chyby a selhání
-- databázových volání (RLS 42501, chybějící sloupec…) přes RPC log_client_error.
-- Čte se jen v Supabase Dashboard → Table Editor (service role); žádný
-- uživatel ani admin firmy k ní přes API nemá přístup.
--
-- Soukromí: ukládá se zpráva chyby, zásobník, verze appky, cesta stránky,
-- typ prohlížeče, ID účtu a firmy — ne e-mail ani obsah formulářů.
-- Lhůta: 30 dní (mazání je součástí RPC), login_attempts 90 dní.
--
-- Spusť v Supabase SQL editoru. Idempotentní.
-- ============================================================

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  org_id uuid,
  kind text not null,                 -- js | promise | db
  message text not null,
  stack text,
  app_version text,
  page text,
  user_agent text,
  context jsonb
);
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;     -- jen SECURITY DEFINER funkce

create or replace function log_client_error(
  p_kind text, p_message text, p_stack text, p_app_version text,
  p_page text, p_user_agent text, p_context jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;                                    -- jen přihlášení (anon by tabulku zaplavil)
  end if;

  -- limit 30 záznamů za hodinu na účet
  if (select count(*) from client_errors
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    return;
  end if;

  insert into client_errors (user_id, org_id, kind, message, stack, app_version, page, user_agent, context)
  values (
    v_uid,
    (select org_id from org_members where user_id = v_uid limit 1),
    left(coalesce(nullif(p_kind, ''), 'js'), 20),
    left(coalesce(p_message, ''), 1000),
    left(p_stack, 4000),
    left(p_app_version, 30),
    left(p_page, 200),
    left(p_user_agent, 300),
    p_context
  );

  -- úklid podle lhůt ze zásad ochrany údajů (občas, ať to nezatěžuje každý zápis)
  if random() < 0.02 then
    delete from client_errors where created_at < now() - interval '30 days';
    delete from login_attempts where created_at < now() - interval '90 days';
  end if;
end;
$$;

revoke all on function public.log_client_error(text, text, text, text, text, text, jsonb) from public;
revoke all on function public.log_client_error(text, text, text, text, text, text, jsonb) from anon;
grant execute on function public.log_client_error(text, text, text, text, text, text, jsonb) to authenticated;

-- Jak číst: Supabase Dashboard → Table Editor → client_errors (nejnovější nahoře),
-- nebo v SQL editoru:
--   select created_at, kind, app_version, message, page from client_errors order by created_at desc limit 50;
--   select message, count(*) from client_errors where created_at > now() - interval '7 days' group by 1 order by 2 desc;

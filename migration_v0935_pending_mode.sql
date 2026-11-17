-- ============================================================
-- Směny v0.9.35 — migrace: omezený režim pro čekající na schválení
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- Čekající = řádek v org_members s role = 'employee' a bez employee_id
-- (připojil se kódem firmy, vedoucí ho ještě nepřiřadil k profilu).
-- Dřív is_org_member() vracelo true i pro něj, takže si přes API mohl
-- přečíst jména zaměstnanců, směny, žádosti, pobočky i nastavení firmy.
--
-- 1) is_org_member() nově vrací true jen pro „aktivního" člena:
--    admin / branch_manager, nebo zaměstnanec s propojeným profilem.
--    Všechny policies, které na helper spoléhají (employees, shifts,
--    unavailability, branches, shift_types, org_settings, org_members,
--    organizations, shift_swaps, open_shifts, notifikace…), tím čekajícím
--    automaticky zavřou čtení i zápis.
-- 2) Čekající dál vidí svůj vlastní řádek v org_members a svou firmu
--    (název) — bez toho by appka nevěděla, kam patří.
-- 3) pending_org_snapshot(): jediný zdroj dat pro omezený režim.
--    Vrací rozpis zveřejněného měsíce ANONYMIZOVANĚ: kolegové jako pořadová
--    čísla, pobočky jako písmena (A, B…), typy směn jako A1, A2…,
--    bez volna/dovolených. Skutečná jména neopustí databázi.
--
-- Signatura is_org_member(check_org_id uuid) zůstává beze změny (42P13).
-- ============================================================

-- 1) aktivní člen
create or replace function is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and (role <> 'employee' or employee_id is not null)
  );
$$;

-- 2) vlastní členství a vlastní firma (i pro čekající)
drop policy if exists "members can view own membership" on org_members;
create policy "members can view own membership"
  on org_members for select
  using (user_id = auth.uid());

drop policy if exists "members can view own org" on organizations;
create policy "members can view own org"
  on organizations for select
  using (exists (
    select 1 from org_members m
    where m.org_id = organizations.id and m.user_id = auth.uid()
  ));

-- 3) anonymizovaný rozpis pro omezený režim
create or replace function pending_org_snapshot(p_org_id uuid, p_year int, p_month int)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key  text := p_year::text || '-' || lpad(p_month::text, 2, '0');
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_pub  boolean := false;
  v_months jsonb := '[]'::jsonb;
  v_result json;
begin
  if auth.uid() is null or not exists (
    select 1 from org_members where org_id = p_org_id and user_id = auth.uid()
  ) then
    return json_build_object('error', 'not_member');
  end if;

  select coalesce(s.settings -> 'published_months', '[]'::jsonb)
    into v_months
    from org_settings s where s.org_id = p_org_id;
  v_months := coalesce(v_months, '[]'::jsonb);
  v_pub := v_months ? v_key;

  with bl as (
    select id, code, color,
           chr(64 + least(26, row_number() over (order by sort_order, code))::int) as alias,
           row_number() over (order by sort_order, code) as n
    from branches where org_id = p_org_id
  ),
  st as (
    select t.code, t.color, t.branch_id, bl.alias as balias, bl.n as bn,
           row_number() over (partition by t.branch_id order by t.sort_order, t.code) as k,
           count(*) over (partition by t.branch_id) as cnt
    from shift_types t join bl on bl.id = t.branch_id
    where t.org_id = p_org_id
  ),
  codes as (
    select distinct on (real) real, alias, color, bn from (
      select st.code as real,
             case when st.cnt <= 1 then st.balias else st.balias || st.k end as alias,
             st.color, st.bn
      from st
      union all
      select bl.code, bl.alias, bl.color, bl.n from bl
    ) x
    order by real
  ),
  e as (
    select id, row_number() over (order by sort_order, id) as n
    from employees where org_id = p_org_id
  ),
  sh as (
    select e.n, extract(day from s.shift_date)::int as d, c.alias
    from shifts s
    join e on e.id = s.employee_id
    join codes c on c.real = s.shift_type_code
    where v_pub
      and s.org_id = p_org_id
      and s.shift_date >= v_from and s.shift_date < v_to
      and s.shift_type_code <> 'X'
  )
  select json_build_object(
    'org_name', (select name from organizations where id = p_org_id),
    'published', v_pub,
    'published_months', v_months,
    'branches', (select coalesce(json_agg(json_build_object(
        'id', 'pb' || n, 'code', alias, 'name', 'Pobočka ' || alias, 'color', color) order by n), '[]'::json)
      from bl),
    'shift_types', (select coalesce(json_agg(json_build_object(
        'id', 'pt' || bn || '_' || k, 'code', balias || k, 'label', balias || k,
        'branch_id', 'pb' || bn, 'color', color, 'sort_order', k) order by bn, k), '[]'::json)
      from st where cnt > 1),
    'employee_count', (select count(*) from e),
    'shifts', (select coalesce(json_agg(json_build_array(n, d, alias)), '[]'::json) from sh)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function pending_org_snapshot(uuid, int, int) to authenticated;

-- Hotovo. Ověření: přihlas se účtem, který čeká na schválení — appka ukáže
-- rozpis bez jmen. V adminském účtu se nic nemění.

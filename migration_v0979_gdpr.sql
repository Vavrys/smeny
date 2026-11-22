-- ============================================================
-- migration_v0979_gdpr.sql — v0.9.79 (R-08 GDPR)
--
--  export_my_data()        právo na přístup / přenositelnost: JSON všech dat účtu
--  delete_my_account()     právo na výmaz účtu (zaměstnanec; admin jen bez firmy)
--  delete_organization()   smazání celé firmy (dřív klient mazal po tabulkách a
--                          řádek `organizations` zůstal — tabulka nemá DELETE policy)
--
-- Záznamy o zaměstnanci (řádek `employees`, směny) patří zaměstnavateli —
-- výmaz účtu je neodstraní; ty maže admin (Zaměstnanci → Smazat) nebo se smažou
-- se zrušením firmy.
-- Spusť v Supabase SQL editoru. Idempotentní. Nejdřív na testovací firmě.
-- ============================================================

create or replace function export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_emps uuid[];
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select coalesce(array_agg(employee_id), '{}') into v_emps
    from org_members where user_id = v_uid and employee_id is not null;

  return jsonb_build_object(
    'ok', true,
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at)
                  from auth.users u where u.id = v_uid),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object(
        'organization', o.name, 'role', m.role, 'employee_id', m.employee_id,
        'emp_code', m.emp_code, 'email', m.email, 'created_at', m.created_at))
      from org_members m join organizations o on o.id = m.org_id
      where m.user_id = v_uid), '[]'::jsonb),
    'employee_records', coalesce((select jsonb_agg(to_jsonb(e)) from employees e where e.id = any(v_emps)), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object(
        'date', s.shift_date, 'shift', s.shift_type_code, 'auto', s.is_auto) order by s.shift_date)
      from shifts s where s.employee_id = any(v_emps)), '[]'::jsonb),
    'unavailability', coalesce((select jsonb_agg(u.unavail_date order by u.unavail_date)
      from unavailability u where u.employee_id = any(v_emps)), '[]'::jsonb),
    'leave_requests', coalesce((select jsonb_agg(to_jsonb(l))
      from leave_requests l where l.employee_id = any(v_emps) or l.requested_by = v_uid), '[]'::jsonb),
    'shift_swaps', coalesce((select jsonb_agg(to_jsonb(w))
      from shift_swaps w where w.requester_id = any(v_emps) or w.target_id = any(v_emps)), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at)
      from notifications n where n.user_id = v_uid), '[]'::jsonb),
    'activity_log', coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'message', a.message)
        order by a.created_at)
      from audit_log a where a.user_id = v_uid), '[]'::jsonb)
  );
end;
$$;

create or replace function delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- admin firmy účet nesmaže, dokud firmu nezruší nebo nepředá (firma by osiřela)
  if exists (select 1 from org_members where user_id = v_uid and role = 'admin') then
    return jsonb_build_object('ok', false, 'error', 'admin_has_org');
  end if;

  select email into v_email from auth.users where id = v_uid;

  delete from notifications where user_id = v_uid;
  delete from help_feedback where user_id = v_uid;
  update audit_log set user_id = null, user_name = 'Smazaný uživatel' where user_id = v_uid;
  update leave_requests set requested_by = null where requested_by = v_uid;
  delete from join_code_attempts where user_id = v_uid;
  if v_email is not null then
    delete from login_attempts where lower(email) = lower(v_email);
  end if;
  delete from org_members where user_id = v_uid;
  delete from auth.users where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function delete_organization(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from org_members
    where org_id = p_org_id and user_id = auth.uid() and role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'admin_only');
  end if;

  delete from notifications      where org_id = p_org_id;
  delete from audit_log          where org_id = p_org_id;
  delete from help_feedback      where org_id = p_org_id;
  delete from shifts             where org_id = p_org_id;
  delete from unavailability     where org_id = p_org_id;
  delete from leave_requests     where org_id = p_org_id;
  delete from open_shifts        where org_id = p_org_id;
  delete from shift_swaps        where org_id = p_org_id;
  delete from schedule_templates where org_id = p_org_id;
  delete from support_requests   where org_id = p_org_id;
  delete from shift_types        where org_id = p_org_id;
  delete from branches           where org_id = p_org_id;
  delete from employees          where org_id = p_org_id;
  delete from org_settings       where org_id = p_org_id;
  delete from org_members        where org_id = p_org_id;
  delete from organizations      where id = p_org_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.export_my_data() from public;
revoke all on function public.export_my_data() from anon;
grant execute on function public.export_my_data() to authenticated;
revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
revoke all on function public.delete_organization(uuid) from public;
revoke all on function public.delete_organization(uuid) from anon;
grant execute on function public.delete_organization(uuid) to authenticated;

-- Ověření (testovací firma): Profil → Stáhnout moje data; Profil → Smazat můj účet
-- (zaměstnanec); Nastavení → Organizace → Smazat firmu (řádek organizations zmizí).

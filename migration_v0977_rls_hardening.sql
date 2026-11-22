-- ============================================================
-- migration_v0977_rls_hardening.sql — v0.9.77
-- Zpřísnění RLS podle auditu R-07 (docs/RLS_AUDIT.md, ověřeno živou DB 22. 11. 2026).
--
--  N1  shift_swaps: úpravy jen žadatel / cíl / admin; 'approved' jen přes RPC
--  N2  RPC apply_shift_swap: výměna se zapíše do rozpisu i když ji přijme
--      zaměstnanec (zaměstnanec do `shifts` zapisovat nesmí)
--  N3+N4  RPC regenerate_invite_code: admin změní kód (organizations nemá UPDATE
--      policy); 8 znaků z kryptografického zdroje, expirace 7 dní
--  N4  join_org_by_code: limit 10 neplatných kódů za hodinu na účet
--  N10 employees: zaměstnanec už nemůže měnit celý svůj záznam (jen jméno a
--      poznámku přes RPC update_own_profile)
--  N7  audit_log: user_id musí být volající
--  +   schedule_templates: zápis jen admin
--  +   funkce nejsou volatelné jako anon; is_org_admin dostane search_path
--
-- Spusť v Supabase SQL editoru. Idempotentní. Nejdřív na testovací firmě.
-- Názvy parametrů a návratové typy stávajících funkcí zůstávají (42P13).
-- ============================================================

-- ── pomocná funkce: zaměstnanec volajícího v dané firmě ─────────────────
create or replace function my_employee_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select employee_id from org_members
  where org_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;

-- ── N1: shift_swaps policies ────────────────────────────────────────────
drop policy if exists "shift_swaps_org" on public.shift_swaps;
drop policy if exists "shift_swaps_select" on public.shift_swaps;
drop policy if exists "shift_swaps_insert" on public.shift_swaps;
drop policy if exists "shift_swaps_update" on public.shift_swaps;
drop policy if exists "shift_swaps_delete" on public.shift_swaps;

create policy "shift_swaps_select" on public.shift_swaps
  for select to authenticated
  using (is_org_member(org_id));

create policy "shift_swaps_insert" on public.shift_swaps
  for insert to authenticated
  with check (
    is_org_member(org_id)
    and status = 'pending'
    and (is_org_admin(org_id) or requester_id = my_employee_id(org_id))
  );

-- Zaměstnanec smí svou výměnu přijmout / odmítnout / zrušit, ale ne ji sám
-- „schválit" (approved vzniká jen v RPC apply_shift_swap nebo adminem).
create policy "shift_swaps_update" on public.shift_swaps
  for update to authenticated
  using (
    is_org_admin(org_id)
    or requester_id = my_employee_id(org_id)
    or target_id = my_employee_id(org_id)
    or (is_org_member(org_id) and open_offer and target_id is null and status = 'pending')
  )
  with check (
    is_org_admin(org_id)
    or (
      is_org_member(org_id)
      and status in ('pending', 'accepted', 'rejected', 'cancelled')
      and (requester_id = my_employee_id(org_id) or target_id = my_employee_id(org_id))
    )
  );

create policy "shift_swaps_delete" on public.shift_swaps
  for delete to authenticated
  using (is_org_admin(org_id) or requester_id = my_employee_id(org_id));

-- ── N2: apply_shift_swap ────────────────────────────────────────────────
-- Zapíše schválenou výměnu do rozpisu. Smí:
--   • cílový kolega (nebo ten, kdo přebírá otevřenou nabídku), pokud je
--     režim výměny 'auto' a výměna je 'pending';
--   • admin, pokud je výměna 'accepted' (čeká na schválení).
-- Obě směny mají tentýž den → prohodí se kódy směn (žádný konflikt na
-- unique(employee_id, shift_date)). Jinak se směna žadatele převede na kolegu,
-- jeho případné X se odebere a jednodenní žádost o volno se zruší.
create or replace function apply_shift_swap(p_swap_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sw shift_swaps%rowtype;
  v_my_emp uuid;
  v_member boolean;
  v_admin boolean;
  v_mode text;
  v_target uuid;
  v_req shifts%rowtype;
  v_tgt shifts%rowtype;
  v_x shifts%rowtype;
  v_has_tgt boolean := false;
  v_has_x boolean := false;
  v_leave leave_requests%rowtype;
  v_leave_cancelled boolean := false;
  v_leave_multiday boolean := false;
  v_result text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_sw from shift_swaps where id = p_swap_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select true, employee_id, (role = 'admin')
    into v_member, v_my_emp, v_admin
    from org_members where org_id = v_sw.org_id and user_id = v_uid limit 1;
  if not coalesce(v_member, false) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;

  v_mode := coalesce(v_sw.approval_mode, 'approval');
  v_target := v_sw.target_id;

  if v_sw.status = 'pending' then
    if v_mode <> 'auto' then
      return jsonb_build_object('ok', false, 'error', 'needs_approval');
    end if;
    if v_target is null then
      if v_my_emp is null then
        return jsonb_build_object('ok', false, 'error', 'not_target');
      end if;
      v_target := v_my_emp;               -- otevřená nabídka: přebírá volající
    elsif v_target is distinct from v_my_emp then
      return jsonb_build_object('ok', false, 'error', 'not_target');
    end if;
  elsif v_sw.status = 'accepted' then
    if not coalesce(v_admin, false) then
      return jsonb_build_object('ok', false, 'error', 'admin_only');
    end if;
    if v_target is null then
      return jsonb_build_object('ok', false, 'error', 'no_target');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'already_resolved');
  end if;

  if v_target = v_sw.requester_id then
    return jsonb_build_object('ok', false, 'error', 'same_employee');
  end if;

  select * into v_req from shifts
   where org_id = v_sw.org_id and employee_id = v_sw.requester_id
     and shift_date = v_sw.requester_date and shift_type_code <> 'X';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'requester_shift_missing');
  end if;

  select * into v_tgt from shifts
   where org_id = v_sw.org_id and employee_id = v_target
     and shift_date = v_sw.requester_date and shift_type_code <> 'X';
  v_has_tgt := found;

  select * into v_x from shifts
   where org_id = v_sw.org_id and employee_id = v_target
     and shift_date = v_sw.requester_date and shift_type_code = 'X';
  v_has_x := found;

  if v_has_tgt then
    update shifts set shift_type_code = v_tgt.shift_type_code, is_auto = false where id = v_req.id;
    update shifts set shift_type_code = v_req.shift_type_code, is_auto = false where id = v_tgt.id;
    v_result := 'swapped';
  else
    if v_has_x then
      delete from shifts where id = v_x.id;
    end if;
    update shifts set employee_id = v_target, is_auto = false where id = v_req.id;
    v_result := case when v_has_x then 'moved_x_removed' else 'moved' end;

    if v_has_x and v_x.leave_request_id is not null then
      select * into v_leave from leave_requests where id = v_x.leave_request_id;
      if found and v_leave.date_from = v_leave.date_to and v_leave.status <> 'rejected' then
        update leave_requests
           set status = 'rejected',
               decision_note = 'Zrušeno výměnou směn — zaměstnanec přijal směnu na tento den'
         where id = v_leave.id;
        v_leave_cancelled := true;
      elsif found and v_leave.date_from <> v_leave.date_to then
        v_leave_multiday := true;          -- žádost zůstává, appka jen upozorní
      end if;
    end if;
  end if;

  update shift_swaps set status = 'approved', target_id = v_target where id = v_sw.id;

  return jsonb_build_object('ok', true, 'result', v_result,
                            'leave_cancelled', v_leave_cancelled,
                            'leave_multiday', v_leave_multiday, 'target_id', v_target);
end;
$$;

-- ── N3 + N4: nový pozvánkový kód ────────────────────────────────────────
create or replace function regenerate_invite_code(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 znaků, bez 0/O/1/I
  v_bytes bytea;
  v_code text := '';
  v_expires timestamptz := now() + interval '7 days';
  i int;
begin
  if auth.uid() is null or not exists (
    select 1 from org_members
    where org_id = p_org_id and user_id = auth.uid() and role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'admin_only');
  end if;

  loop
    v_bytes := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from organizations where invite_code = v_code);
  end loop;

  update organizations set invite_code = v_code, invite_expires_at = v_expires where id = p_org_id;
  return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', v_expires);
end;
$$;

-- Limit pokusů o kód firmy: 10 neplatných za hodinu na účet.
create table if not exists public.join_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists join_code_attempts_user_idx on public.join_code_attempts(user_id, created_at desc);
alter table public.join_code_attempts enable row level security;
revoke all on public.join_code_attempts from anon, authenticated;   -- jen SECURITY DEFINER funkce

create or replace function join_org_by_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org organizations%rowtype;
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_emp_code text;
  v_tries int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if (select count(*) from join_code_attempts
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  select * into v_org from organizations
    where invite_code = upper(trim(code))
    limit 1;

  if not found then
    insert into join_code_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_org.invite_expires_at is not null and v_org.invite_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select id into v_existing from org_members
    where org_id = v_org.id and user_id = v_uid
    limit 1;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'org_id', v_org.id, 'already', true);
  end if;

  loop
    v_emp_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
    v_tries := v_tries + 1;
    exit when v_tries > 20 or not exists (
      select 1 from org_members where org_id = v_org.id and emp_code = v_emp_code
    );
  end loop;

  insert into org_members (org_id, user_id, role, emp_code, email)
  values (v_org.id, v_uid, 'employee', v_emp_code, auth.jwt() ->> 'email');

  return jsonb_build_object('ok', true, 'org_id', v_org.id);
end;
$$;

-- ── N10: zaměstnanec mění jen jméno a poznámku ──────────────────────────
drop policy if exists "employees can update own record" on public.employees;

create or replace function update_own_profile(p_name text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if coalesce(trim(p_name), '') = '' or length(p_name) > 100 or length(coalesce(p_notes, '')) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select employee_id into v_emp from org_members
   where user_id = auth.uid() and employee_id is not null
   limit 1;
  if v_emp is null then
    return jsonb_build_object('ok', false, 'error', 'no_employee');
  end if;

  update employees set name = trim(p_name), notes = p_notes where id = v_emp;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── N7: audit_log nelze zfalšovat cizím user_id ─────────────────────────
drop policy if exists "audit_insert_org" on public.audit_log;
create policy "audit_insert_org" on public.audit_log
  for insert to authenticated
  with check (is_org_member(org_id) and (user_id is null or user_id = auth.uid()));

-- ── šablony rozpisu: čtou členové, zapisuje admin ───────────────────────
drop policy if exists "org_access" on public.schedule_templates;
drop policy if exists "templates_select" on public.schedule_templates;
drop policy if exists "templates_admin" on public.schedule_templates;
create policy "templates_select" on public.schedule_templates
  for select to authenticated using (is_org_member(org_id));
create policy "templates_admin" on public.schedule_templates
  for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- ── funkce: žádný anon, jen přihlášení ──────────────────────────────────
alter function public.is_org_admin(uuid) set search_path = public;

do $$
declare
  f text;
begin
  foreach f in array array[
    'claim_invite(text,uuid,uuid)',
    'create_organization(text,text)',
    'join_org_by_code(text)',
    'pending_org_snapshot(uuid,integer,integer)',
    'set_pending_name(text)',
    'org_member_emails(uuid)',
    'is_org_admin(uuid)',
    'is_org_member(uuid)',
    'is_user_org_member(uuid,uuid)',
    'my_employee_id(uuid)',
    'apply_shift_swap(uuid)',
    'regenerate_invite_code(uuid)',
    'update_own_profile(text,text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Ověření: v appce Nastavení → Organizace → „Zkontrolovat databázi“, potom
-- tools/rls_audit.sql (anon_exec musí být false u všech funkcí výše).
-- Po spuštění jednou obnov pozvánkový kód (starý je 6znakový a bez expirace).

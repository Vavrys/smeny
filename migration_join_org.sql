-- ============================================================
-- Směny v0.9.4 — migrace: RPC pro připojení k firmě přes kód
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- HOTFIX (chicken-and-egg RLS): joinOrgByCode v appce dělal přímý
-- SELECT na organizations a přímý INSERT do org_members. Nový uživatel
-- bez členství ale nemá přes RLS na organizations žádné SELECT právo
-- (policy "members can view their own org" vyžaduje is_org_member) ani
-- právo insertovat do org_members (policy "admins can manage org
-- members" vyžaduje is_org_admin) → 0 řádků → falešná hláška „Kód
-- firmy nebyl nalezen". Řešení stejné jako u create_organization a
-- claim_invite: SECURITY DEFINER funkce, která RLS obejde záměrně
-- a sama si pohlídá autorizační logiku.
-- ============================================================

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

  select * into v_org from organizations
    where invite_code = upper(trim(code))
    limit 1;

  if not found then
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

  -- Vygeneruj unikátní 7znakový emp_code v rámci orgu (v SQL, ne v JS — ať to nejde podvrhnout)
  loop
    v_emp_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
    v_tries := v_tries + 1;
    exit when v_tries > 20 or not exists (
      select 1 from org_members where org_id = v_org.id and emp_code = v_emp_code
    );
  end loop;

  insert into org_members (org_id, user_id, role, emp_code)
  values (v_org.id, v_uid, 'employee', v_emp_code);

  return jsonb_build_object('ok', true, 'org_id', v_org.id);
end;
$$;

grant execute on function join_org_by_code(text) to authenticated;

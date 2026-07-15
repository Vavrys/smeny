-- ============================================================
-- Směny v0.9.5 — migrace: čekárna po připojení kódem firmy
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- B2/B5: admin musí v Zaměstnancích vidět, kdo čeká na přiřazení — jméno,
-- e-mail a jeho emp_code. org_members.email byl dřív nikde nenaplňovaný
-- sloupec (join_org_by_code ho nesetoval); pending_name je nový sloupec
-- pro jméno, které si čekající uživatel sám zadá.
-- ============================================================

ALTER TABLE org_members ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE org_members ADD COLUMN IF NOT EXISTS pending_name text;

-- join_org_by_code (viz migration_join_org.sql) teď navíc uloží e-mail
-- z auth.users, ať admin vidí, kdo čeká, i bez ručního zadávání jména.
create or replace function join_org_by_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org organizations%rowtype;
  v_uid uuid := auth.uid();
  v_email text;
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

  select email into v_email from auth.users where id = v_uid;

  -- Vygeneruj unikátní 7znakový emp_code v rámci orgu (v SQL, ne v JS — ať to nejde podvrhnout)
  loop
    v_emp_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
    v_tries := v_tries + 1;
    exit when v_tries > 20 or not exists (
      select 1 from org_members where org_id = v_org.id and emp_code = v_emp_code
    );
  end loop;

  insert into org_members (org_id, user_id, role, emp_code, email)
  values (v_org.id, v_uid, 'employee', v_emp_code, v_email);

  return jsonb_build_object('ok', true, 'org_id', v_org.id);
end;
$$;

grant execute on function join_org_by_code(text) to authenticated;

-- Uživatel čekající na přiřazení si sám uloží jméno, ať ho admin pozná v
-- seznamu čekajících. org_members RLS dovolí update řádku jen adminovi
-- ("admins can manage org members"), takže obyčejný uživatel nemůže psát
-- přímo — proto SECURITY DEFINER funkce, která zapíše jen jeho vlastní
-- pending_name a nic jiného (žádné riziko přepsání role/employee_id).
create or replace function set_pending_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update org_members
  set pending_name = nullif(trim(p_name), '')
  where user_id = auth.uid();
end;
$$;

grant execute on function set_pending_name(text) to authenticated;

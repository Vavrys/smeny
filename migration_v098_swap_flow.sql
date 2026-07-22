-- ============================================================
-- Směny v0.9.8 — migrace: flow výměn směn + e-mail při registraci
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- 1) notifications.ref_id — swap notifikace nese ID řádku shift_swaps,
--    aby klik na notifikaci otevřel přímo reakční modal / přehled žádostí.
--    (Ověřeno sondou 2026-07-22: sloupec v živé DB chyběl — 42703.)
-- 2) join_org_by_code — dřív NEUKLÁDAL e-mail účtu do org_members.email
--    (sloupec existuje, ale insert ho nevyplňoval → admin v Zaměstnancích
--    viděl „—"). Doplněno server-side z auth.jwt() ->> 'email'.
--    CREATE OR REPLACE je tu bezpečný: funkce pochází z migration_join_org.sql
--    a název parametru (code) i návratový typ zůstávají stejné — žádný 42P13.
-- 3) Jednorázový backfill e-mailů stávajících členů z auth.users
--    (pokrývá i účty vzniklé přes pozvánkový odkaz / claim_invite).
-- ============================================================

alter table public.notifications add column if not exists ref_id uuid;

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

  -- v0.9.8: e-mail účtu server-side z JWT — dřív se nevyplňoval vůbec
  insert into org_members (org_id, user_id, role, emp_code, email)
  values (v_org.id, v_uid, 'employee', v_emp_code, auth.jwt() ->> 'email');

  return jsonb_build_object('ok', true, 'org_id', v_org.id);
end;
$$;

grant execute on function join_org_by_code(text) to authenticated;

-- Backfill: stávající členové bez e-mailu (jednorázově, opakování neškodí)
update org_members m
set email = u.email
from auth.users u
where m.user_id = u.id
  and (m.email is null or m.email = '');

-- Hotovo. Ověření: Nastavení → Organizace → „Zkontrolovat databázi"
-- (notifications musí být zeleně vč. ref_id); v Zaměstnancích se u propojených
-- účtů ukazuje e-mail.

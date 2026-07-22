-- ============================================================
-- Směny v0.9.8 — migrace: e-maily účtů pro admina (org_member_emails)
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- Admin potřebuje v Zaměstnancích vidět, pod jakým e-mailem je účet
-- propojený (vazba employees.id → org_members.employee_id → auth.users.email).
-- auth.users z klienta číst nejde (a org_members.email je jen snapshot,
-- který plní až join_org_by_code od v0.9.5 — starší účty ho mají NULL).
-- Proto SECURITY DEFINER RPC: vrátí [{member_id, employee_id, email, role}]
-- pro VŠECHNY členy dané organizace, ale jen adminovi té organizace.
--
-- Autorizace: členství + role admin se ověřuje přímým dotazem na
-- org_members (SECURITY DEFINER stejně RLS obchází; potřebujeme rovnou
-- celý řádek kvůli roli, takže helper is_org_member by byl dotaz navíc).
-- Ne-admin dostane chybu, ne tiše prázdný výsledek — tiché polykání
-- chyb je v projektu zakázané.
-- ============================================================

drop function if exists org_member_emails(uuid);

create function org_member_emails(p_org_id uuid)
returns table(member_id uuid, employee_id uuid, email text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'org_member_emails: nepřihlášený uživatel';
  end if;

  if not exists (
    select 1 from org_members a
    where a.org_id = p_org_id
      and a.user_id = auth.uid()
      and a.role = 'admin'
  ) then
    raise exception 'org_member_emails: jen pro adminy organizace';
  end if;

  -- left join: člen bez auth účtu (nemělo by nastat) nesmí zmizet ze seznamu
  return query
    select m.id, m.employee_id, u.email::text, m.role::text
    from org_members m
    left join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id;
end;
$$;

revoke all on function org_member_emails(uuid) from public;
revoke all on function org_member_emails(uuid) from anon;
grant execute on function org_member_emails(uuid) to authenticated;

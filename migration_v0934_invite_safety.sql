-- ============================================================
-- Směny v0.9.34 — migrace: pojistky proti přepsání adminova účtu
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- Co se stalo (17. 11. 2026): admin otevřel pozvánkový odkaz pro nového
-- zaměstnance, zadal do registrace SVŮJ e-mail a claim_invite mu přepsalo
-- org_members.employee_id na nového zaměstnance (ON CONFLICT … DO UPDATE).
-- Následně si v přístupu toho zaměstnance změnil roli na „zaměstnanec" —
-- a tím odebral admina sám sobě. Navíc create_organization nehlídala, že
-- uživatel už firmu má, takže vznikaly duplicitní prázdné firmy.
--
-- 1) claim_invite: bere uživatele z auth.uid() (ne z parametru od klienta),
--    nikdy nepřepíše existující propojení a odmítne admina/manažera.
-- 2) create_organization: odmítne uživatele, který už je členem firmy.
-- 3) trigger: poslední admin organizace nejde degradovat.
--
-- Názvy parametrů a návratové typy zůstávají BEZE ZMĚNY (jinak 42P13).
-- ============================================================

create or replace function claim_invite(p_token text, p_emp_id uuid, p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_emp employees%rowtype;
  v_member org_members%rowtype;
  v_emp_code text;
  v_clean_notes text;
begin
  if v_uid is null then
    return json_build_object('error', 'Nejsi přihlášen');
  end if;

  -- p_user_id zůstává kvůli kompatibilitě podpisu, ale musí být volající.
  -- Dřív se mu věřilo naslepo: kdo znal token, mohl propojit libovolný účet.
  if p_user_id is not null and p_user_id <> v_uid then
    return json_build_object('error', 'Pozvánku lze uplatnit jen pod vlastním účtem');
  end if;

  select * into v_emp from employees where id = p_emp_id;
  if not found then
    return json_build_object('error', 'Zaměstnanec nenalezen');
  end if;

  if coalesce(p_token, '') = ''
     or position('[invite:' || p_token || ']' in coalesce(v_emp.notes, '')) = 0 then
    return json_build_object('error', 'Pozvánka je neplatná nebo expirovala');
  end if;

  -- Zaměstnanec už má jiný účet → nepřepisovat
  if exists (
    select 1 from org_members
    where employee_id = v_emp.id and user_id <> v_uid
  ) then
    return json_build_object('error', 'Tento zaměstnanec je už propojen s jiným účtem');
  end if;

  select * into v_member from org_members
    where org_id = v_emp.org_id and user_id = v_uid;

  if found then
    -- Admin / manažer pozvánku uplatnit nemůže (přesně tohle přepsalo admina)
    if v_member.role <> 'employee' then
      return json_build_object('error',
        'Jsi přihlášený jako vedoucí této firmy. Pozvánku otevři v jiném prohlížeči nebo v anonymním okně a zaregistruj se e-mailem zaměstnance.');
    end if;
    if v_member.employee_id is not null and v_member.employee_id <> v_emp.id then
      return json_build_object('error', 'Tvůj účet je už propojen s jiným zaměstnancem');
    end if;
    update org_members set employee_id = v_emp.id where id = v_member.id;
  else
    v_emp_code := upper(substring(md5(random()::text || v_uid::text) from 1 for 7));
    insert into org_members (org_id, user_id, role, employee_id, emp_code, email)
    values (v_emp.org_id, v_uid, 'employee', v_emp.id, v_emp_code,
            (select email from auth.users where id = v_uid));
  end if;

  -- Zneplatni token
  v_clean_notes := regexp_replace(v_emp.notes, '\[invite:[a-z0-9]+\]', '', 'g');
  update employees set notes = trim(v_clean_notes) where id = p_emp_id;

  return json_build_object('success', true, 'org_id', v_emp.org_id);
end;
$function$;

grant execute on function claim_invite(text, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
create or replace function create_organization(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Nejsi přihlášen';
  end if;

  -- Jeden účet = jedna firma. Dřív šlo založit libovolně mnoho prázdných firem
  -- a appka pak načítala náhodnou z nich.
  if exists (select 1 from org_members where user_id = auth.uid()) then
    raise exception 'Tvůj účet už patří do firmy, novou firmu nelze založit.';
  end if;

  insert into organizations (name, slug) values (org_name, org_slug) returning id into new_org_id;
  insert into org_settings (org_id) values (new_org_id);
  insert into org_members (org_id, user_id, role) values (new_org_id, auth.uid(), 'admin');
  return new_org_id;
end;
$function$;

grant execute on function create_organization(text, text) to authenticated;

-- ------------------------------------------------------------
-- Poslední admin organizace nesmí přijít o roli (UPDATE role).
-- Mazání členství záměrně nehlídáme: smazání organizace/uživatele kaskádou
-- by jinak padalo.
create or replace function guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if OLD.role = 'admin' and NEW.role is distinct from 'admin' then
    if not exists (
      select 1 from org_members
      where org_id = OLD.org_id and role = 'admin' and id <> OLD.id
    ) then
      raise exception 'V organizaci musí zůstat alespoň jeden admin.';
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_guard_last_admin on org_members;
create trigger trg_guard_last_admin
  before update of role on org_members
  for each row execute function guard_last_admin();

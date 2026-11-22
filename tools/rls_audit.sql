-- ============================================================
-- tools/rls_audit.sql — READ-ONLY diagnostika RLS (R-07)
-- Spusť v Supabase SQL editoru po částech (každý blok zvlášť) a pošli
-- výsledky. Nic nemění, jen čte katalog. Slouží k ověření ŽIVÉ databáze,
-- protože repo obsahuje jen část policies (základní schema.sql je mimo repo).
-- ============================================================

-- 1) Tabulky v public: je zapnuté RLS? (rls_enabled musí být true všude)
select c.relname as tabulka, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- 2) Všechny policies (jméno, příkaz, role, podmínky)
select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies where schemaname = 'public'
order by tablename, cmd, policyname;

-- 3) Tabulky s RLS, které nemají žádnou policy (= nikdo nic nevidí) a naopak
--    tabulky BEZ RLS (= vidí každý s GRANTem)
select c.relname as tabulka,
       c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as pocet_policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
order by pocet_policies, c.relname;

-- 4) GRANTy pro anon (nepřihlášený) — měly by být prázdné kromě login_attempts INSERT
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' and grantee='anon'
order by table_name, privilege_type;

-- 5) Funkce v public: SECURITY DEFINER, search_path, kdo smí volat
select p.proname as funkce,
       pg_get_function_identity_arguments(p.oid) as argumenty,
       p.prosecdef as security_definer,
       p.proconfig as nastaveni,           -- musí obsahovat search_path=public
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f'
order by p.prosecdef desc, p.proname;

-- 6) Definice is_org_admin / is_org_member (kdo je „admin" — i branch_manager?)
select proname, pg_get_functiondef(oid) from pg_proc
where proname in ('is_org_admin','is_org_member','is_user_org_member') and pronamespace='public'::regnamespace;

-- 7) CHECK constraint na org_members.role (repo schema: jen admin/employee,
--    appka používá i branch_manager)
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.org_members'::regclass and contype='c';

-- 8) Pozvánkové kódy: délka, expirace (NULL = nikdy neexpiruje)
select length(invite_code) as delka, (invite_expires_at is null) as bez_expirace, count(*)
from organizations group by 1,2;

-- 9) Test izolace (spusť jako přihlášený uživatel firmy A přes appku/REST,
--    ne v SQL editoru, který běží jako postgres a RLS obchází):
--    GET /rest/v1/employees?org_id=eq.<UUID firmy B>  → musí vrátit []
--    GET /rest/v1/shifts?org_id=eq.<UUID firmy B>     → musí vrátit []
--    POST /rest/v1/shifts s org_id firmy B            → musí vrátit 401/403

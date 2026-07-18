-- ============================================================
-- migration_v096_integrity.sql — v0.9.6
-- Datová integrita: C1 prevence duplicit (unique constrainty),
-- C2 kaskády při mazání (ON DELETE pravidla), login_attempts.
-- Spusť v Supabase SQL editoru. Idempotentní — lze pouštět opakovaně.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. login_attempts — kód (logFailedLogin) do ní zapisoval od v0.7.x,
--    ale tabulka nikdy neexistovala (insert tiše padal). Záměrně bez
--    SELECT policy: čtení jen přes service role / dashboard.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "login_attempts_insert" ON public.login_attempts;
CREATE POLICY "login_attempts_insert" ON public.login_attempts
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 2. C1 — DEDUPLIKACE + UNIQUE CONSTRAINTY
--    (duplicitní Linda/Vojtěch byl symptom chybějících pojistek)
-- ────────────────────────────────────────────────────────────

-- 2a. Duplicitní členství (org_id, user_id): nech řádek s employee_id,
--     jinak deterministicky ten s menším id.
DELETE FROM public.org_members om
USING public.org_members om2
WHERE om.org_id = om2.org_id
  AND om.user_id = om2.user_id
  AND om.user_id IS NOT NULL
  AND om.id <> om2.id
  AND (
       (om.employee_id IS NULL AND om2.employee_id IS NOT NULL)
    OR (((om.employee_id IS NULL) = (om2.employee_id IS NULL)) AND om.id > om2.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_user_uniq
  ON public.org_members(org_id, user_id) WHERE user_id IS NOT NULL;

-- 2b. Jeden zaměstnanec = max jeden propojený účet. Duplicitní vazba
--     zdvojovala osobu všude, kde se seznam skládá přes org_members.
UPDATE public.org_members om SET employee_id = NULL
WHERE om.employee_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.org_members om2
    WHERE om2.employee_id = om.employee_id AND om2.id < om.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS org_members_employee_uniq
  ON public.org_members(employee_id) WHERE employee_id IS NOT NULL;

-- 2c. Směny: jeden člověk max jedna směna denně. Constraint by měl
--     existovat už z dřívějška (upserty s onConflict na něm stojí) —
--     IF NOT EXISTS ho doplní jen tam, kde chybí. Duplicity napřed pryč:
--     přednost má ruční směna, pak deterministicky menší id.
DELETE FROM public.shifts s
USING public.shifts s2
WHERE s.employee_id = s2.employee_id
  AND s.shift_date = s2.shift_date
  AND s.id <> s2.id
  AND (
       (COALESCE(s.is_auto,false) AND NOT COALESCE(s2.is_auto,false))
    OR (COALESCE(s.is_auto,false) = COALESCE(s2.is_auto,false) AND s.id > s2.id)
  );

DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS shifts_emp_date_uniq
      ON public.shifts(employee_id, shift_date);
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'shifts: zbyly duplicitní směny — vyřeš ručně a spusť migraci znovu';
  END;
END $$;

-- 2d. Volno X: jeden záznam na člověka a den.
DELETE FROM public.unavailability u
USING public.unavailability u2
WHERE u.employee_id = u2.employee_id
  AND u.unavail_date = u2.unavail_date
  AND u.id <> u2.id
  AND u.id > u2.id;

DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS unavailability_emp_date_uniq
      ON public.unavailability(employee_id, unavail_date);
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'unavailability: zbyly duplicitní záznamy — vyřeš ručně a spusť migraci znovu';
  END;
END $$;

-- 2e. Kódy poboček a typů směn: duplicitní kód nelze bezpečně smazat
--     automaticky (směny na kódy odkazují textem) — když index nejde
--     vytvořit, jen to oznam a duplicity vyřeš ručně.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS branches_org_code_uniq
      ON public.branches(org_id, code);
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'branches: duplicitní kódy poboček — vyřeš ručně a spusť migraci znovu';
  END;
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS shift_types_branch_code_uniq
      ON public.shift_types(branch_id, code);
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'shift_types: duplicitní kódy typů směn — vyřeš ručně a spusť migraci znovu';
  END;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. C2 — KASKÁDY PŘI MAZÁNÍ
--    Smazání zaměstnance / pobočky / organizace nesmí nechat osiřelé
--    směny, žádosti, členství ani notifikace. Pro každý sloupec:
--    (a) ukliď existující sirotky, (b) zahoď stávající FK na sloupci,
--    (c) založ FK s požadovaným ON DELETE pravidlem.
--    Tabulky/sloupce, které v DB (zatím) nejsou, se přeskočí.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  fk_name TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- závislosti na employees
      ('shifts',             'employee_id',      'employees',      'CASCADE'),
      ('unavailability',     'employee_id',      'employees',      'CASCADE'),
      ('leave_requests',     'employee_id',      'employees',      'CASCADE'),
      ('shift_swaps',        'requester_id',     'employees',      'CASCADE'),
      ('shift_swaps',        'target_id',        'employees',      'SET NULL'),
      ('org_members',        'employee_id',      'employees',      'SET NULL'),
      ('open_shifts',        'claimed_by',       'employees',      'SET NULL'),
      -- závislosti na leave_requests / branches
      ('shifts',             'leave_request_id', 'leave_requests', 'SET NULL'),
      ('shift_types',        'branch_id',        'branches',       'CASCADE'),
      -- vše s org_id patří organizaci → smazání organizace čistí kompletně
      ('employees',          'org_id', 'organizations', 'CASCADE'),
      ('branches',           'org_id', 'organizations', 'CASCADE'),
      ('shift_types',        'org_id', 'organizations', 'CASCADE'),
      ('shifts',             'org_id', 'organizations', 'CASCADE'),
      ('unavailability',     'org_id', 'organizations', 'CASCADE'),
      ('org_settings',       'org_id', 'organizations', 'CASCADE'),
      ('org_members',        'org_id', 'organizations', 'CASCADE'),
      ('notifications',      'org_id', 'organizations', 'CASCADE'),
      ('audit_log',          'org_id', 'organizations', 'CASCADE'),
      ('leave_requests',     'org_id', 'organizations', 'CASCADE'),
      ('schedule_templates', 'org_id', 'organizations', 'CASCADE'),
      ('open_shifts',        'org_id', 'organizations', 'CASCADE'),
      ('shift_swaps',        'org_id', 'organizations', 'CASCADE'),
      ('help_feedback',      'org_id', 'organizations', 'CASCADE'),
      ('support_requests',   'org_id', 'organizations', 'CASCADE')
    ) AS t(child_t, child_c, parent_t, del_rule)
  LOOP
    -- přeskoč tabulky/sloupce, které v této DB nejsou
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.child_t AND column_name = r.child_c
    ) THEN
      CONTINUE;
    END IF;

    -- (a) sirotci: CASCADE sloupce smaž, SET NULL sloupce odpoj
    IF r.del_rule = 'CASCADE' THEN
      EXECUTE format(
        'DELETE FROM public.%I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = c.%I)',
        r.child_t, r.child_c, r.parent_t, r.child_c);
    ELSE
      EXECUTE format(
        'UPDATE public.%I c SET %I = NULL WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = c.%I)',
        r.child_t, r.child_c, r.child_c, r.parent_t, r.child_c);
    END IF;

    -- (b) zahoď všechny stávající FK vedené přes tento sloupec
    FOR fk_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f' AND nsp.nspname = 'public' AND rel.relname = r.child_t
        AND (
          SELECT array_agg(att.attname)
          FROM unnest(con.conkey) k
          JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k
        ) = ARRAY[r.child_c]::name[]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.child_t, fk_name);
    END LOOP;

    -- (c) založ FK s požadovaným ON DELETE
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE %s',
      r.child_t, r.child_t || '_' || r.child_c || '_fk096', r.child_c, r.parent_t, r.del_rule);
  END LOOP;
END $$;

-- Hotovo. Ověření: v appce Nastavení → Organizace → „Zkontrolovat databázi".

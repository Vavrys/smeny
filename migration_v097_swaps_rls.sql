-- ============================================================
-- migration_v097_swaps_rls.sql — v0.9.7
-- Výměny směn a otevřené směny: GRANT + RLS policies.
--
-- Diagnóza: shift_swaps a open_shifts v DB existují, ale roli
-- authenticated chybí GRANT (diagnostika „Stav databáze" u nich
-- hlásila odepřené čtení; anon sonda vrací 42501 s hintem GRANT).
-- Každý insert/select tak padal na 42501 „permission denied" a starý
-- catch to maskoval jako „tabulka neexistuje".
--
-- Policies vedou přes SECURITY DEFINER helper is_org_member(uuid)
-- (existuje ve schema.sql) — plain sub-select na org_members uvnitř
-- policy je pro zaměstnance pod org_members RLS nespolehlivý (lekce
-- z v0.9.1 u notifikací).
--
-- Spusť v Supabase SQL editoru. Idempotentní.
-- ============================================================

-- Tabulky mohou, ale nemusí existovat (starší instalace) — založ je,
-- ať má migrace vždy na čem stavět. Struktura = to, co appka používá.
CREATE TABLE IF NOT EXISTS public.open_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_type_code TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  claimed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shift_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  target_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  requester_date DATE NOT NULL,
  requester_code TEXT NOT NULL,
  target_date DATE,
  target_code TEXT,
  open_offer BOOLEAN DEFAULT FALSE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GRANT — bez něj RLS vůbec nedostane šanci (42501 přijde dřív)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_shifts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_swaps TO authenticated;

ALTER TABLE public.open_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_swaps ENABLE ROW LEVEL SECURITY;

-- Staré/ruční policies pryč (jakkoli se jmenovaly v komentářovém SQL)
DROP POLICY IF EXISTS "org_access" ON public.open_shifts;
DROP POLICY IF EXISTS "org_access" ON public.shift_swaps;
DROP POLICY IF EXISTS "open_shifts_org" ON public.open_shifts;
DROP POLICY IF EXISTS "shift_swaps_org" ON public.shift_swaps;

-- Členové organizace vidí a spravují záznamy své organizace.
-- (Jemnější dělení admin/zaměstnanec appka nevyžaduje — nároky a schvalování
-- řídí UI; případné zpřísnění je snadné doplnit později.)
CREATE POLICY "open_shifts_org" ON public.open_shifts
  FOR ALL TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY "shift_swaps_org" ON public.shift_swaps
  FOR ALL TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

-- Hotovo. Ověření: Nastavení → Organizace → „Zkontrolovat databázi"
-- (shift_swaps a open_shifts musí být zeleně), pak nabídka výměny v modalu.

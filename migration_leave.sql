-- ============================================================
-- Směny v0.8.0 — migrace: systém dovolených (leave_requests)
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. LEAVE_REQUESTS — žádosti o dovolenou / volno
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid REFERENCES employees(id) ON DELETE CASCADE, -- null = admin bez zaměstnaneckého záznamu
  date_from       date NOT NULL,
  date_to         date NOT NULL,
  shift_reduction integer NOT NULL DEFAULT 0,  -- o kolik směn snížit min/cíl/max v dotčeném měsíci
  note            text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decision_note   text,                        -- poznámka admina při zamítnutí/zrušení
  requested_by    uuid,                        -- auth.users.id žadatele
  decided_by      uuid,                        -- auth.users.id rozhodujícího admina
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (date_from <= date_to),
  CHECK (shift_reduction >= 0)
);

CREATE INDEX IF NOT EXISTS leave_requests_org_idx
  ON leave_requests (org_id, status, date_from);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- Zaměstnanec vidí své žádosti (svého zaměstnaneckého záznamu nebo jím podané);
-- admin vidí všechny žádosti své organizace.
-- POZOR: employees.user_id NEEXISTUJE — vazba auth uživatele na zaměstnance
-- vede přes org_members.employee_id.
DROP POLICY IF EXISTS "leave_select" ON leave_requests;
CREATE POLICY "leave_select" ON leave_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR employee_id IN (SELECT employee_id FROM org_members WHERE user_id = auth.uid() AND employee_id IS NOT NULL)
    OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Zaměstnanec vkládá jen žádosti sám za sebe (za svůj employees záznam),
-- admin může vložit žádost za kohokoli ve své organizaci.
DROP POLICY IF EXISTS "leave_insert" ON leave_requests;
CREATE POLICY "leave_insert" ON leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      employee_id IN (SELECT employee_id FROM org_members WHERE user_id = auth.uid() AND employee_id IS NOT NULL)
      OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin')
    )
  );

-- Rozhodovat (schválit/zamítnout/zrušit) smí jen admin organizace.
DROP POLICY IF EXISTS "leave_update_admin" ON leave_requests;
CREATE POLICY "leave_update_admin" ON leave_requests
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin'));

-- POZOR: bez GRANTů padá "permission denied for table leave_requests"
GRANT SELECT, INSERT, UPDATE ON leave_requests TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 2. SHIFTS.LEAVE_REQUEST_ID — příznak dovolenkových X dnů
--    X dny schválené dovolené se vkládají do shifts s tímto odkazem:
--    jdou vizuálně odlišit, zaměstnanec je nesmí smazat a při zrušení
--    žádosti se mažou právě podle tohoto sloupce.
-- ────────────────────────────────────────────────────────────
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS leave_request_id uuid REFERENCES leave_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shifts_leave_request_idx
  ON shifts (leave_request_id) WHERE leave_request_id IS NOT NULL;

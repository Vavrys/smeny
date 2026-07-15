-- ============================================================
-- Směny v0.9.5 — migrace: schválení se změnou + mazání historie žádostí
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- C2/C3: když admin při schvalování žádosti upraví datum/snížení směn,
-- potřebujeme vidět, co si zaměstnanec původně žádal — proto orig_*
-- sloupce (vyplní se jen při skutečné změně, jinak zůstanou NULL).
-- C4: promazání historie zamítnutých/zrušených žádostí potřebuje DELETE,
-- který leave_requests dosud vůbec nemělo (jen SELECT/INSERT/UPDATE).
-- ============================================================

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS orig_date_from date;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS orig_date_to date;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS orig_shift_reduction integer;

-- Smazat historii smí jen admin své organizace, a jen záznamy, které už
-- nejsou aktivní (rejected pokrývá zamítnuté i zrušené — cancelLeave
-- taky nastavuje status 'rejected'). Pending/approved se takhle smazat nedají.
DROP POLICY IF EXISTS "leave_delete_admin_closed" ON leave_requests;
CREATE POLICY "leave_delete_admin_closed" ON leave_requests
  FOR DELETE TO authenticated
  USING (
    status = 'rejected'
    AND org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- POZOR: bez GRANTů padá "permission denied for table leave_requests" (viz migration_leave.sql)
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests TO authenticated;

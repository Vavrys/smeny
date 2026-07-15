-- ============================================================
-- Směny v0.9.3 — migrace: úprava vlastní čekající žádosti o volno
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- Dosud směl leave_requests UPDATE jen admin (policy "leave_update_admin"
-- z migration_leave.sql). Tlačítko „Upravit" u čekající žádosti (v0.9.3)
-- ale má mít i autor — tato policy mu povolí upravit VLASTNÍ žádost,
-- dokud je pending. WITH CHECK drží status = 'pending', takže si
-- zaměstnanec nemůže žádost sám schválit ani ji přepsat na cizí.
-- ============================================================

DROP POLICY IF EXISTS "leave_update_requester_pending" ON leave_requests;
CREATE POLICY "leave_update_requester_pending" ON leave_requests
  FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      requested_by = auth.uid()
      OR employee_id IN (SELECT employee_id FROM org_members WHERE user_id = auth.uid() AND employee_id IS NOT NULL)
    )
  )
  WITH CHECK (
    status = 'pending'
    AND org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      requested_by = auth.uid()
      OR employee_id IN (SELECT employee_id FROM org_members WHERE user_id = auth.uid() AND employee_id IS NOT NULL)
    )
  );

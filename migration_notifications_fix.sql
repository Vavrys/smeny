-- ============================================================
-- Směny v0.9.1 — oprava RLS pro notifikace mezi uživateli
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
--
-- Problém: zaměstnanec (např. Linda) nemohl vložit notifikaci adminovi —
-- INSERT policy tiše padala, protože kontrola příjemce četla org_members
-- pod RLS volajícího (zaměstnanec vidí jen svůj vlastní řádek, takže
-- ověření „příjemce je člen mé organizace" pro cizí user_id selhalo).
--
-- Řešení: SECURITY DEFINER helpery obcházejí RLS na org_members jen pro
-- tyto dvě úzké kontroly členství. INSERT pak smí každý přihlášený člen
-- organizace, ale výhradně pro příjemce ze stejné organizace.
-- SELECT/UPDATE zůstávají jen na vlastní notifikace (beze změny).
-- ============================================================

-- Helper: je přihlášený uživatel členem organizace?
CREATE OR REPLACE FUNCTION is_org_member(check_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = check_org AND user_id = auth.uid()
  );
$$;

-- Helper: je daný uživatel (příjemce notifikace) členem organizace?
-- SECURITY DEFINER je nutný — bez něj by sub-select v policy běžel pod RLS
-- volajícího a zaměstnanec by „neviděl" adminův řádek v org_members.
CREATE OR REPLACE FUNCTION is_user_org_member(check_org uuid, check_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = check_org AND user_id = check_user
  );
$$;

GRANT EXECUTE ON FUNCTION is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_user_org_member(uuid, uuid) TO authenticated;

-- INSERT: člen organizace smí vložit notifikaci kterémukoli členovi TÉŽE
-- organizace (zaměstnanec → admin: žádost o volno; admin → zaměstnanec:
-- publikování, rozhodnutí o žádosti; testovací notifikace sám sobě).
DROP POLICY IF EXISTS "notif_insert_org" ON notifications;
CREATE POLICY "notif_insert_org" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    is_org_member(org_id)
    AND is_user_org_member(org_id, user_id)
  );

-- SELECT: jen vlastní notifikace (beze změny — znovu vytvořeno idempotentně)
DROP POLICY IF EXISTS "notif_select_own" ON notifications;
CREATE POLICY "notif_select_own" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- UPDATE: jen vlastní notifikace, příjemce nelze přepsat (beze změny)
DROP POLICY IF EXISTS "notif_update_own" ON notifications;
CREATE POLICY "notif_update_own" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- POZOR: bez GRANTů padá "permission denied for table notifications"
GRANT SELECT, INSERT, UPDATE ON notifications TO authenticated;

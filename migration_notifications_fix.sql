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
-- Řešení: existující helper is_org_member (schema.sql) + nový SECURITY
-- DEFINER helper is_user_org_member pro kontrolu příjemce — obchází RLS na
-- org_members jen pro tuto úzkou kontrolu členství. INSERT pak smí každý
-- přihlášený člen organizace, ale výhradně pro příjemce ze stejné organizace.
-- SELECT/UPDATE zůstávají jen na vlastní notifikace (beze změny).
-- ============================================================

-- Helper is_org_member(uuid) v DB UŽ EXISTUJE (schema.sql ř. 150, parametr
-- check_org_id) — migrace ho NESMÍ předefinovávat (CREATE OR REPLACE s jiným
-- názvem parametru padá na 42P13). Policies ho volají tak, jak je.

-- Helper: je daný uživatel (příjemce notifikace) členem organizace?
-- SECURITY DEFINER je nutný — bez něj by sub-select v policy běžel pod RLS
-- volajícího a zaměstnanec by „neviděl" adminův řádek v org_members.
-- DROP předem = plná idempotence i po dřívějším částečně proběhlém běhu;
-- policy, která na helperu závisí, musí spadnout DŘÍV, jinak DROP FUNCTION
-- při opakovaném běhu selže na závislosti.
DROP POLICY IF EXISTS "notif_insert_org" ON notifications;
DROP FUNCTION IF EXISTS is_user_org_member(uuid, uuid);
CREATE FUNCTION is_user_org_member(check_org_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = check_org_id AND user_id = check_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION is_user_org_member(uuid, uuid) TO authenticated;

-- INSERT: člen organizace smí vložit notifikaci kterémukoli členovi TÉŽE
-- organizace (zaměstnanec → admin: žádost o volno; admin → zaměstnanec:
-- publikování, rozhodnutí o žádosti; testovací notifikace sám sobě).
-- (DROP POLICY proběhl výše, před DROP FUNCTION.)
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

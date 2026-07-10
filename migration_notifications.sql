-- ============================================================
-- Směny v0.7.9 — migrace: notifikace, zpětná vazba nápovědy, historie změn
-- Spusť v Supabase SQL editoru (Dashboard → SQL Editor → New query → Run).
-- Skript je idempotentní — lze spustit opakovaně bez chyb.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. NOTIFICATIONS — in-app notifikace (zvoneček)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,                  -- příjemce (auth.users.id)
  type       text NOT NULL DEFAULT 'info',   -- publish | publish_admin | test | leave_* …
  title      text,
  body       text,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Starší instalace mohly mít tabulku s jiným tvarem — doplň chybějící sloupce.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message text;  -- legacy, appka čte jako fallback
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type text DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id, org_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Uživatel čte jen své notifikace
DROP POLICY IF EXISTS "notif_select_own" ON notifications;
CREATE POLICY "notif_select_own" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Uživatel označuje jen své (přečteno) — nesmí měnit příjemce ani obsah jiných
DROP POLICY IF EXISTS "notif_update_own" ON notifications;
CREATE POLICY "notif_update_own" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Insert: kdokoli přihlášený v rámci SVÉ organizace (publikování, testy, žádosti)
DROP POLICY IF EXISTS "notif_insert_org" ON notifications;
CREATE POLICY "notif_insert_org" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- POZOR: bez GRANTů padá "permission denied for table notifications"
GRANT SELECT, INSERT, UPDATE ON notifications TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 2. HELP_FEEDBACK — 👍/👎 z chatbota nápovědy
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS help_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid,                          -- kdo hodnotil (auth.users.id)
  question   text,                          -- otázka / článek nápovědy
  article    text,                          -- kategorie › článek (breadcrumb)
  verdict    text NOT NULL CHECK (verdict IN ('up','down')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS help_feedback_org_idx
  ON help_feedback (org_id, created_at DESC);

ALTER TABLE help_feedback ENABLE ROW LEVEL SECURITY;

-- Insert: přihlášený uživatel v rámci své organizace
DROP POLICY IF EXISTS "helpfb_insert_org" ON help_feedback;
CREATE POLICY "helpfb_insert_org" ON help_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- Select: pouze admini organizace (přehled zpětné vazby v Nastavení)
DROP POLICY IF EXISTS "helpfb_select_admin" ON help_feedback;
CREATE POLICY "helpfb_select_admin" ON help_feedback
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin')
  );

GRANT SELECT, INSERT ON help_feedback TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. AUDIT_LOG — historie změn (stránkování, filtry, fulltext v appce)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid,                          -- kdo akci provedl
  user_name  text,                          -- zobrazované jméno v době akce
  message    text NOT NULL,                 -- popis akce
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_name text;

CREATE INDEX IF NOT EXISTS audit_log_org_idx
  ON audit_log (org_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Insert: členové organizace (přihlášení, publikace, generování, změny nastavení…)
DROP POLICY IF EXISTS "audit_insert_org" ON audit_log;
CREATE POLICY "audit_insert_org" ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- Select: pouze admini organizace (Historie změn je v admin nastavení)
DROP POLICY IF EXISTS "audit_select_admin" ON audit_log;
CREATE POLICY "audit_select_admin" ON audit_log
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin')
  );

GRANT SELECT, INSERT ON audit_log TO authenticated;

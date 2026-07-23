# Směny — pokyny pro práci s kódem

## Verzování (release checklist)

Při zvednutí verze appky VŽDY změň obě místa:
1. `index.html` — konstanta `APP_VERSION` (sekce „APP VERSION" na začátku hlavního scriptu; badge `#app-version-label` v hlavičce se z ní plní sám — text ve spanu ručně nepřepisuj).
2. `sw.js` — konstanta `VERSION` (řídí název cache; bez bumpu zůstanou klienti na staré cache/buildu).

## Migrace databáze (Supabase)

**Po pullu vždy zkontroluj, že jsou všechny migrace spuštěné v Supabase SQL editoru.**
Rychlá kontrola přímo v appce: Nastavení → Organizace → „Zkontrolovat databázi" (admin;
zeleně/červeně ukáže chybějící tabulky/sloupce a kterou migraci spustit).

Seznam migračních souborů v repu (pořadí = doporučené pořadí spuštění):
1. `migration_notifications.sql` — notifications, audit_log, help_feedback
2. `migration_notifications_fix.sql` — SECURITY DEFINER helper pro notif RLS
3. `migration_leave.sql` — leave_requests (žádosti o volno)
4. `migration_leave_edit.sql` — RLS: úprava vlastní pending žádosti
5. `migration_leave_changes.sql` — orig_* sloupce, DELETE policy pro rejected
6. `migration_join_org.sql` — RPC join_org_by_code (registrace kódem firmy)
7. `migration_waiting_room.sql` — čekárna, RPC set_pending_name
8. `migration_v096_integrity.sql` — login_attempts, unique constrainty (duplicity), ON DELETE kaskády
9. `migration_v097_swaps_rls.sql` — shift_swaps + open_shifts: GRANT pro authenticated + RLS policies přes is_org_member (bez toho 42501 na každý insert/select)
10. `migration_member_emails.sql` — SECURITY DEFINER RPC org_member_emails(p_org_id): e-maily účtů z auth.users pro adminy (Zaměstnanci — propojené účty + čekárna)
11. `migration_v098_swap_flow.sql` — notifications.ref_id (klikací swap notifikace), join_org_by_code ukládá email z JWT, backfill org_members.email z auth.users
12. `migration_v099_swap_mode.sql` — shift_swaps.approval_mode: režim schvalování se „zmrazí" na řádek výměny při vytvoření nabídky (respondToSwap ho čte odtud, ne z orgSettings přijímajícího)

Nová migrace = nový soubor `migration_*.sql` + výjimka v `.gitignore` (je to whitelist!)
+ řádek do tohoto seznamu + případně do `EXPECTED_DB_SCHEMA` v index.html (diagnostika).
Pozor: nikdy `CREATE OR REPLACE` na funkce z původního schema.sql (42P13 při jiném
názvu parametru) a DROP závislých policies PŘED `DROP FUNCTION`.

## Práce s DB v kódu

Všechna Supabase volání vedou (postupně) přes centrální vrstvu v index.html:
`dbRun` / `dbInsert` / `dbUpdate` / `dbUpsert` / `dbDelete` / `dbRpc` (sekce „A2 v0.9.6").
Loguje chyby s kontextem a přes `{ action: 'Popis akce' }` zobrazí uživateli toast.
Zákaz `.catch(()=>{})` a ignorování `{ error }` — Supabase JS nevyhazuje, chyby
chodí v návratové hodnotě. Prázdné/chybové stavy panelů: `uiEmptyState()` / `uiErrorState()`.

## Ikony

Aplikace má centrální registr ikon `DEFAULT_ICONS`/`ICONS` v `index.html` (sekce `ICON REGISTRY`). Žádné emoji se nesmí používat natvrdo přímo v kódu.

Při přidání nové záložky, tlačítka nebo jiného klikatelného prvku VŽDY:
1. Přidej nový klíč do objektu `DEFAULT_ICONS`.
2. Použij `ICONS.klic` v JS (template literal), nebo `<span data-icon="klic">emoji</span>` ve statickém HTML — nikdy emoji přímo.
3. Spusť `validateIconConsistency()` (v konzoli prohlížeče) pro ověření, že stejné prvky používají stejnou ikonu.

Uživatel může ikony přepsat v Nastavení → záložka „🎨 Ikony" — uloží se do `localStorage` a aplikují se přes `applyIcons()`.

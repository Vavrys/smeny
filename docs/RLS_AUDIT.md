# Audit RLS izolace mezi firmami (R-07) — statická část

Stav: 22. 11. 2026, main 0.9.75. Prošly se `migration_*.sql` v repu a základní
`schema.sql` / `schema_part2.sql` / `schema_part3.sql` z projektu. **Živá databáze
ověřena nebyla** — repo neobsahuje všechny policies (např. aktualizace `organizations`,
role `branch_manager`). Druhá část auditu = spustit `tools/rls_audit.sql` a porovnat.

## Co je v pořádku

- Všechny tabulky z `schema.sql` mají RLS a policies přes `is_org_member(org_id)` /
  `is_org_admin(org_id)`; zápis směn, zaměstnanců, poboček a nastavení jen admin.
- SECURITY DEFINER funkce z migrací mají `set search_path = public`, hlídají
  `auth.uid()`, a `org_member_emails` ještě ověřuje roli admina.
- `claim_invite` už nevěří `p_user_id`, `create_organization` = jeden účet, jedna firma.
- Omezený režim čekajících (`is_org_member` jen pro aktivní členy, anonymní snapshot).
- Notifikace: vkládat lze jen členu téže firmy, číst jen vlastní.

## Nálezy (seřazeno podle závažnosti)

### N1 — `shift_swaps` a `open_shifts`: jakýkoli člen smí vše (střední)
`FOR ALL ... USING (is_org_member(org_id))` (migration_v097). Kterýkoli zaměstnanec
firmy může cizí výměnu přepsat na `approved`, smazat ji nebo změnit `target_id`.
Izolace MEZI firmami drží, uvnitř firmy ne. Návrh: UPDATE/DELETE jen žadatel,
cíl (jen `status`), nebo admin; INSERT jen s `requester_id` = vlastní zaměstnanec.

### N2 — Výměna v auto režimu zapisuje do `shifts` jako zaměstnanec (vysoká, k ověření)
`respondToSwap` → `applySwapToSchedule` dělá `update/delete shifts` v session
zaměstnance. Podle `schema.sql` smí `shifts` zapisovat jen admin. Supabase při RLS
odepření UPDATE/DELETE nevrací chybu, jen 0 řádků → appka může hlásit
„Směny vyměněny a uloženy do rozpisu", ale rozpis se nezměnil. Ověřit na živé
DB (blok 2 v `rls_audit.sql`: policies na `shifts`) a na testovací firmě.
Návrh podle výsledku: SECURITY DEFINER RPC `apply_swap(p_swap_id)`, které výměnu
ověří (stav, firma, režim) a zapíše atomicky; nebo `dbUpdate` začne kontrolovat počet
změněných řádků.

### N3 — Obnovení pozvánkového kódu bez policy na `organizations` (střední, k ověření)
`schema.sql` má pro `organizations` jen SELECT policy. `regenerateInviteCode()` dělá
`update` a hlásí „Nový kód vygenerován", i když RLS změnu odepřela (0 řádků bez chyby).
Pokud živá DB policy nemá, admin kód nikdy nezmění a nevidí chybu.

### N4 — Pozvánkový kód: slabý a bez limitu pokusů (nízká až střední)
Kód: `Math.random().toString(36).slice(2,8)` = max 6 znaků (~2 mld. variant, ne
kryptografický generátor), `invite_expires_at` může být NULL = nikdy. `join_org_by_code`
nemá limit pokusů. Dopad je omezený (nový člen je v omezeném režimu čekajících a vidí
jen anonymní rozpis), ale zakládá členství v cizí firmě. Návrh: generovat v DB
(`gen_random_bytes`, 8+ znaků), povinná expirace, počítadlo neúspěšných pokusů na uživatele.

### N5 — `employees.notes` čitelné všem členům firmy (střední, GDPR)
Poznámky o zaměstnancích (a tokeny pozvánek `[invite:…]`) čte přes REST API každý
propojený zaměstnanec, ne jen admin. Návrh: soukromé poznámky a tokeny do samostatné
tabulky jen pro admina, nebo view bez `notes` pro nevedoucí.

### N6 — `org_members` čitelné všem členům: e-maily kolegů (nízká, GDPR)
Policy „members can view org members" + sloupec `email` (v0.9.8) = každý zaměstnanec
vidí e-maily a `emp_code` všech kolegů. Návrh: sloupec `email` jen adminovi (view/RPC).

### N7 — `audit_log` lze zfalšovat (nízká)
INSERT kontroluje jen členství v `org_id`; `user_id` a `user_name` může zaměstnanec
zapsat libovolné. Návrh: `WITH CHECK (user_id = auth.uid())`. Policy navíc používá
sub-select na `org_members` místo `is_org_member` (čekající ji obejdou).

### N8 — `login_attempts`: INSERT pro anon bez limitu (nízká)
`WITH CHECK (true)` pro `anon` = kdokoli může tabulku zaplavit. Nic z ní appka nečte
(žádný lockout). Návrh: nechat, nebo omezit na `authenticated` / limit na edge funkci.

### N9 — Role `branch_manager` mimo repo (k ověření)
`CHECK` na `org_members.role` v `schema.sql` dovoluje jen `admin`/`employee`;
`is_org_admin` zná jen `admin`. Appka používá i `branch_manager`. Co smí manažer
zapisovat na úrovni DB, v repu není — ověřit blokem 6 a 7.

## Další krok

1. Spustit `tools/rls_audit.sql` (bloky 1–8) v Supabase a poslat výsledky.
2. Podle nich napsat `migration_v0977_rls_hardening.sql` (N1, N3, N5–N7, případně N2/N4)
   a test: dva testovací účty ve dvou firmách, REST dotazy z bloku 9.
3. Migraci pustit nejdřív na testovací firmě, až potom na ostré.

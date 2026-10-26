# Směny — pokyny pro práci s kódem

## Projekt

Česká multi-tenant SaaS aplikace pro plánování směn (pohostinství, více poboček).
Frontend: jeden soubor `index.html` (vanilla JS, bez service workeru — `sw.js` je
jen odinstalační pojistka, viz níž). Backend: Supabase (Postgres, RLS, SECURITY
DEFINER RPC). Deploy: Cloudflare Pages z GitHubu (`main` = produkce, ostatní větve
= preview), build command `node build-stamp.js` (viz níž). Vlastník a jediný
reviewer: Vavrys. UI i komunikace česky.

## Editace souborů

Skriptované úpravy `index.html` zachovávají kódování UTF-8 a existující konce
řádků (soubor je CRLF). Po každém hromadném nahrazení ověř, že proběhlo právě
jednou — ne vícekrát, ne nikde.

## Verzování (release checklist)

Verzi měň na JEDINÉM místě: `index.html` — konstanta `APP_VERSION` (sekce „APP VERSION"
na začátku hlavního scriptu). Badge `#app-version-label` v hlavičce i patička
`#app-build-label` dole se z ní plní samy — texty ručně nepřepisuj.

`sw.js` už se nebumpuje: od v0.9.29 je z něj kill-switch bez cache (viz níž).

## Service worker / cache (v0.9.29)

Appka BĚŽÍ BEZ SERVICE WORKERU. Offline režim nepotřebuje (interní nástroj na
Cloudflare Pages) a cache-first shell uživatelům — hlavně na mobilu — zamrzával
na staré verzi; z cache se servíroval i `index.html`, takže ani oprava v kódu
se k nim nedostala.

- `sw.js` zůstává nasazený jako **kill-switch**: nainstaluje se, smaže všechny
  cache, odregistruje se a přenačte otevřená okna. **Nemazat ze serveru** — je to
  jediná cesta, jak odinstalovat SW u zaseknutých klientů (prohlížeč si ho stáhne
  při update checku).
- `index.html` SW **neregistruje**; `killServiceWorkers()` naopak uklidí staré
  registrace a `smeny-*` cache u klientů, kteří už čerstvý build mají.
- Nový SW nepřidávej. Pokud by offline režim byl někdy potřeba, řeš ho
  network-first i pro shell, nikdy ne cache-first.

## Build stamp (viditelná verze)

`build-stamp.js` nahradí v `index.html` placeholder `__BUILD_SHA__` git hashem
z `CF_PAGES_COMMIT_SHA` (fallback `git rev-parse HEAD`). Na Cloudflare Pages nastav
**Build command: `node build-stamp.js`**, output directory kořen repa. Bez build
kroku appka funguje dál, patička jen ukáže samotné číslo verze.
Skript spouštěj jen na CI — lokálně by stamp zapsal do repa.

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

Operace často selhávají potichu (chybějící RLS policy, GRANT, nebo sloupec) —
každé nové volání ověř proti aktuálnímu schématu (seznam migrací výše), ne jen
proti tomu, co appka předpokládá.

Onboarding řeší cyklickou závislost RLS (nový uživatel potřebuje vidět
organizaci, do které se ale bez členství nedostane) přes SECURITY DEFINER RPC:
`join_org_by_code`, `claim_invite`, `create_organization`. Neměň Supabase URL
ani klíče v kódu.

## Ikony

Aplikace má centrální registr ikon `DEFAULT_ICONS`/`ICONS` v `index.html` (sekce `ICON REGISTRY`). Žádné emoji se nesmí používat natvrdo přímo v kódu.

Při přidání nové záložky, tlačítka nebo jiného klikatelného prvku VŽDY:
1. Přidej nový klíč do objektu `DEFAULT_ICONS`.
2. Použij `ICONS.klic` v JS (template literal), nebo `<span data-icon="klic">emoji</span>` ve statickém HTML — nikdy emoji přímo.
3. Spusť `validateIconConsistency()` (v konzoli prohlížeče) pro ověření, že stejné prvky používají stejnou ikonu.

Uživatel může ikony přepsat v Nastavení → záložka „🎨 Ikony" — uloží se do `localStorage` a aplikují se přes `applyIcons()`.

## Git a PR

- Nikdy necommituj přímo do `main`. Před prací `git pull --rebase`.
- Jedno issue = jedna větev = jeden PR. Nemíchej nesouvisející změny.
- Větve automatizace: `claude/<číslo-issue>-auto`.
- Neměň `.github/workflows/`, `CLAUDE.md` ani `build-stamp.js`, pokud to issue výslovně nežádá.
- Neměň text verze v `#app-version-label` (verzování dělá Vavrys, viz výše).
- Popis PR (česky): `Closes #N`, **Co a proč**, **Jak otestovat** (max 5 kroků, ≤3 min,
  na preview URL, v testovací organizaci, ne v ostré), **Rizika**, **Migrace DB: ano/ne**.

## Testy (musí projít před PR)

- `node tests/schedule_harness.js`: algoritmus + mutační testy víkendových párů.
- `node tools/check_syntax.js`: syntaxe všech inline skriptů.
- `cd tools && npx playwright test`: smoke test načtení stránky (desktop + mobil).
- `cd tools && npm test` spustí harness i syntax check najednou.

Když měníš logiku, přidej/uprav test. Test nikdy neoslabuj, aby prošel.

## Doménová pravidla (nepřepisovat bez výslovného zadání)

- Pobočky: Majestic (M1–M4), Ungelt (U), Karolína (K), Plaza (P1/P2).
- Majestic: minimum 3 lidi, ne všechny 4 podtypy. Podtypy se plní v pořadí: M3 jen s M2,
  M4 jen s M3. O víkendu je ideál 4.
- Volné víkendy se měří jako páry So+Ne (`collectWeekendPairs`). `collectWeekendBlocks`
  slouží jen plánovací logice (obsazování pá–ne bloku). Nezaměňovat.
- Strop kvality rozpisu je empiricky ~91–92 % (stejně jako ručně). Další optimalizace
  má malý přínos.
- Nesplněné minimum u zaměstnance s úzkými oprávněními (např. jen Karolína) může být
  strukturálně neřešitelné. Není to bug algoritmu.
- Váhy `candidateScore` (W_MIN, W_WEEKEND, W_RECENT, W_TARGET, W_SCARCE) neměň bez zadání.

## UI

- Sémantické barvy (zelená/oranžová/červená stavů) se nikdy nemění s tématem ani dark
  mode. Měnit se smí jen akcentové barvy tématu.
- Nové knihovny jen přes CDN s pevnou verzí (jako `@supabase/supabase-js`, `xlsx`,
  `@floating-ui/*`). Žádný build krok pro runtime.
- Mobil je primární zařízení zaměstnanců: každá UI změna musí fungovat na 390 px šířky.

## Komunikace

Česky, věcně, bez omáčky. Když je zadání v rozporu s kódem nebo s pravidly výše,
nezačínej hádat. Popiš rozpor a navrhni varianty A/B.

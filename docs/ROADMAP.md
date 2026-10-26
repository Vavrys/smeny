# Roadmapa Směny

Pořadí = priorita. Vavrys mění pořadí přesunem řádků. Týdenní přehled z horních položek, které ještě nemají issue, zakládá issues (název začíná `[R-xx]`).

- [R-00] Banner „Je k dispozici nová verze“: aplikace otevřená dlouho (iOS z plochy) se dotazuje na `version.json` z `build-stamp.js` při návratu do appky a každých 10 min. Při změně buildu nabídne Obnovit, bez automatického reloadu. Bez service workeru.
- [R-01] Ověřit a dořešit zbylé chyby výměn směn: `swap_approval_mode` respektován i v session zaměstnance; výměna na den s X (dovolená) nesmí potichu selhat.
- [R-02] Evidence odpracovaných hodin za měsíc + export CSV/Excel pro účetní (bez mzdové logiky).
- [R-03] Nástěnka oznámení s potvrzením přečtení.
- [R-04] Dashboard: dnešní obsazení poboček, čekající žádosti, mezery v rozpisu.
- [R-05] Export rozpisu do Excelu.
- [R-06] Onboarding nové firmy end-to-end (registrace → pobočky → zaměstnanci → první rozpis).
- [R-07] Audit RLS izolace mezi organizacemi. (db)
- [R-08] GDPR: export a smazání dat zaměstnance, stránka se zásadami zpracování.
- [R-09] Monitoring chyb v produkci.
- [R-10] Otevřené směny (zaměstnanci se hlásí na volné sloty).
- [R-11] Týdenní vzory obsazení na pobočku.
- [R-12] Predikce mzdových nákladů.
- [R-13] Přístup pro účetní (read-only role).
- [R-14] Předplatné a platby.

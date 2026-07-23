-- migration_v099_swap_mode.sql
-- v0.9.9: režim schvalování výměny se ukládá přímo na řádek shift_swaps
-- v okamžiku vytvoření nabídky (submitShiftSwap). respondToSwap totiž běží
-- v session cílového kolegy, kde org nastavení nemusí být načtené — tichý
-- fallback na 'approval' dřív auto režim úplně vyřadil. Režim z řádku je
-- deterministický (platí ten z okamžiku nabídky) a nezávislý na tom, čí
-- session výměnu zpracovává.
-- Hodnoty: 'approval' (schvaluje vedoucí, výchozí) | 'auto' (zapíše se hned).

ALTER TABLE shift_swaps ADD COLUMN IF NOT EXISTS approval_mode TEXT DEFAULT 'approval';

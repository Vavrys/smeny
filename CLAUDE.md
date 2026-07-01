# Směny — pokyny pro práci s kódem

## Ikony

Aplikace má centrální registr ikon `DEFAULT_ICONS`/`ICONS` v `index.html` (sekce `ICON REGISTRY`). Žádné emoji se nesmí používat natvrdo přímo v kódu.

Při přidání nové záložky, tlačítka nebo jiného klikatelného prvku VŽDY:
1. Přidej nový klíč do objektu `DEFAULT_ICONS`.
2. Použij `ICONS.klic` v JS (template literal), nebo `<span data-icon="klic">emoji</span>` ve statickém HTML — nikdy emoji přímo.
3. Spusť `validateIconConsistency()` (v konzoli prohlížeče) pro ověření, že stejné prvky používají stejnou ikonu.

Uživatel může ikony přepsat v Nastavení → záložka „🎨 Ikony" — uloží se do `localStorage` a aplikují se přes `applyIcons()`.

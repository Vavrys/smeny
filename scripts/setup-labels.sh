#!/usr/bin/env bash
set -euo pipefail
L() { gh label create "$1" --color "$2" --description "$3" --force; }
# stav
L triage          ededed "Nové, čeká na triáž"
L needs-decision  d93f0b "Čeká na odpověď Vavryse (A/B/C)"
L needs-approval  fbca04 "Specifikace hotová, Vavrys přidá ready"
L ready           0e8a16 "Smí se implementovat"
L in-progress     1d76db "Agent pracuje / PR otevřen"
L blocked         b60205 "Zablokováno, viz komentář"
# typ
L bug     d73a4a "Chyba"
L feature a2eeef "Nová funkce"
L infra   5319e7 "Infrastruktura / CI"
# oblast
L algo c5def5 "Plánovací algoritmus (implementuje Opus)"
L db   0052cc "Změna schématu/RLS/RPC (zatím jen ručně)"
L ui   bfdadc "Uživatelské rozhraní"
# priorita, velikost
L p1 b60205 "Rozbité pro uživatele / blokuje provoz"
L p2 fbca04 "Normální"
L p3 c2e0c6 "Vylepšení"
L size-S ffffff "Malé"
L size-M cccccc "Střední"
L size-L 888888 "Velké — rozdělit"
L digest 000000 "Týdenní přehled"

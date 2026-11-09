# Plany

Dokumenty projektowe: zakres punktów, decyzje i ich uzasadnienie. Bieżący stan prac jest w [../STATUS.md](../STATUS.md), znane braki w [../LUKI.md](../LUKI.md), opis działania w [../DOKUMENTACJA.md](../DOKUMENTACJA.md).

| Dokument | Stan | Zakres |
|---|---|---|
| [PLAN-rozbudowy.md](PLAN-rozbudowy.md) | wdrożony (R0–R11 w 1.0.0, R12 niewydany) | od prototypu 0.1.0 do panelu, który zastępuje web GUI legacy; sekcja „Jak pracować” – wzór dla kolejnych planów i automatu `scripts/plan.sh` |
| [PLAN-makieta.md](PLAN-makieta.md) | wdrożony (M0–M9, niewydany) | panel na wzór artefaktu „Makieta UI VizRS Live”: ekran po ekranie to, co ma pokrycie w danych (M0–M9) |
| [PLAN-mcr.md](PLAN-mcr.md) | projekt (2026-11-09) | braki wobec web GUI legacy (K1–K3), panel kanału na wzór Viz Channel Branding (K4–K12: kontrola ramówki, mozaika, import ramówki, warstwy, TAKE/OUT, as-run, zdarzenia wtórne, alarmy), legacy czy Next – opcje i zalecenie (§6, N0) |

**Plany panelu – jeden dokument** (decyzja użytkownika 2026-11-09): [PLAN-mcr.md](PLAN-mcr.md). Nowe punkty i analizy dopisuj tam (tabela z kolumnami „Punkt | Zakres | Wymaga | Stan”, opis punktu tak, żeby dało się go zrobić w świeżej sesji); nowych plików `PLAN-*.md` nie zakładaj. PLAN-rozbudowy i PLAN-makieta to archiwum zakończonych planów. Automat: `PLAN_FILE=docs/plany/PLAN-mcr.md scripts/plan.sh run`.

## Poza repozytorium

| Dokument | Zakres |
|---|---|
| [PLAN-vizrs-live.md](../../../VizRS%20CG%20System/docs/plany/PLAN-vizrs-live.md) (VizRS CG System) | VizRS Live w rodzinie VizRS: założenia, decyzje, powiązanie z grafiką VizRS i VizRS CG Playout |

# Plany

Dokumenty projektowe: zakres punktów, decyzje i ich uzasadnienie. Bieżący stan prac jest w [../STATUS.md](../STATUS.md), znane braki w [../LUKI.md](../LUKI.md), opis działania w [../DOKUMENTACJA.md](../DOKUMENTACJA.md).

| Dokument | Stan | Zakres |
|---|---|---|
| [PLAN-rozbudowy.md](PLAN-rozbudowy.md) | wdrożony (R0–R11 w 1.0.0, R12 niewydany) | od prototypu 0.1.0 do panelu, który zastępuje web GUI legacy; sekcja „Jak pracować” – wzór dla kolejnych planów i automatu `scripts/plan.sh` |
| [PLAN-makieta.md](PLAN-makieta.md) | w toku (M0–M7) | panel na wzór artefaktu „Makieta UI VizRS Live”: ekran po ekranie to, co ma pokrycie w danych (M0–M9) |

Nowy plan: plik `PLAN-<temat>.md` w tym katalogu (punkty opisane tak, żeby każdy dało się zrobić w świeżej sesji, tabela z kolumnami „Wymaga” i „Stan”) + wiersz w tej tabeli. Automat: `PLAN_FILE=docs/plany/PLAN-<temat>.md scripts/plan.sh run`.

## Poza repozytorium

| Dokument | Zakres |
|---|---|
| [PLAN-vizrs-live.md](../../../VizRS%20CG%20System/docs/plany/PLAN-vizrs-live.md) (VizRS CG System) | VizRS Live w rodzinie VizRS: założenia, decyzje, powiązanie z grafiką VizRS i VizRS CG Playout |

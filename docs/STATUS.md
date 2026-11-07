# STATUS – stan prac

> Aktualizuj w tym samym commicie, który zmienia stan. Plan: [plany/PLAN-rozbudowy.md](plany/PLAN-rozbudowy.md), znane braki: [LUKI.md](LUKI.md), opis działania: [DOKUMENTACJA.md](DOKUMENTACJA.md).
>
> **Ostatnia aktualizacja:** 2026-11-07

## Bieżący etap

**Wydanie 1.1.0** (2026-11-07) z ErsatzTV legacy **v26.12.0** (sprawdzone też z v26.11.6). Plan rozbudowy R0–R12 zrobiony w całości; zawartość wydań: [CHANGELOG.md](../CHANGELOG.md). W 1.1.0 względem 1.0.0: VizRS Live Panel z CG Playout `/live` wchłonięty, a w CG Playout usunięty (zostaje tylko API `/api/live/*`) – Sloty na żywo jako stanowisko MCR, Audycje LIVE, studio i nazwa stanowiska w pasku górnym (R12). Podgląd strumienia kanału w panelu (okno podglądu, własny odtwarzacz MSE równany do zegara anteny, pośrednik `/api/stream/…`).

**Grafika i sloty na żywo** – przez **VizRS CG Playout** (`../VizRS CG Playout`): reguły grafiki (`/api/live/graphics`), stan wejść, przejęcie kanału, audycje LIVE. Logika zostaje w CG Playout; panel woła jego API przez pośrednika `/api/cg/…`.

## Zrobione (wg planu)

| Punkt | Zakres | Gdzie |
|---|---|---|
| R0 | fundament UI: moduły, formularz z metadanych, wspólne edytory | `server/web/{core,form,parts}.js` |
| R1–R2 | harmonogramy z pozycjami; playouty wszystkich rodzajów, harmonogramy zastępcze | `views/harmonogramy.js`, `views/playouty.js` |
| R3–R4 | biblioteki lokalne, skan, przeglądarka, kosz; kolekcje (4 rodzaje) i playlisty | `views/media.js`, `views/listy.js`, `views/playlisty.js` |
| R5 | profile kodowania, znaki wodne (wgrywanie obrazu – jedyny nowy endpoint mostu), wypełniacze, logo kanału | `views/{profile,znaki,wypelniacze}.js`, `bridge/` `/upload` |
| R6 | bloki, szablony dnia, deco, kalendarz tygodnia playoutu blokowego | `views/{bloki,deco,kalendarz}.js`, `when.js` |
| R7 | ustawienia legacy, logi, konserwacja, test odtwarzania | `views/system.js` |
| R8 | Jellyfin, Emby, Plex (PIN), strumienie zdalne; sekrety tylko do zapisu | `views/zrodla.js`, `mask_secrets` |
| R9 | grafika VizRS i sloty na żywo (pośrednik CG Playout) | `views/grafika.js`, `/api/cg/…` |
| R10 | web GUI legacy zamknięte za proxy Caddy, lista pokrycia, legacy v26.12.0, CI | `docker/proxy.Caddyfile`, `.github/workflows/` |
| R11 | wydanie 1.0: instrukcja operatora, runbook, obrazy ghcr, przegląd bezpieczeństwa | `docs/INSTRUKCJA.md`, `docs/RUNBOOK.md`, `release.yml` |
| R12 | Sloty na żywo (MCR), Audycje LIVE, operator i studio w pasku górnym | `views/live.js`, `app.js` |

## Następne zadanie

[PLAN-makieta.md](plany/PLAN-makieta.md) – panel na wzór makiety UI, następny punkt **M9** (Ustawienia i Diagnostyka: panele obok siebie, „Stan” stosu na górze, logi ze źródłem). Poza planem: z [LUKI.md](LUKI.md) pozycja o najwyższym priorytecie (G1 → G2 → G3). Większa praca = nowy plan w [plany/](plany/README.md) (wzór: „Jak pracować” w PLAN-rozbudowy).

## Kroki ręczne (czekają na użytkownika)

Sesje automatu niczego nie publikują i nie ruszają produkcji; to zostało do zrobienia ręcznie:

- `git push origin main`, potem `git tag v1.1.0 && git push origin v1.1.0` (tag v1.0.0 nie był wypchnięty – wystarczy v1.1.0) – uruchamia `release.yml` (DOKUMENTACJA §9); po pierwszej publikacji pakiety ghcr ustawić jako publiczne.
- CI (`ci.yml`, `legacy-latest.yml`) zacznie działać po wypchnięciu `.github/workflows/` i włączeniu Actions w repozytorium (DOKUMENTACJA §8).
- Lokalna produkcja (stos `virtrs` CG Playout) przełączona 2026-11-07 na VizRS Live nakładką `compose.cg-playout.yml` (RUNBOOK §2a): legacy v26.11.6 → v26.12.0 z mostem (migracja bazy; kopia w `~/vizrs-kopie/`), proxy na 8409, panel na 8090, CG Playout z live API. Do sprawdzenia: tunery i odtwarzacze, które korzystały z innych ścieżek niż `/iptv/*` (`curl -I`, DOKUMENTACJA §8).
- Produkcja (stos `virtrs`) po poprawce integracji z VizRS (Trio, podgląd `/output`): przebudować obraz panelu (`vizrs-live:local`), w `.env` CG Playout usunąć `VIZRS_LIVE_VIZRS_URL=http://127.0.0.1:8789` (nakładka ustawi `:8789` = host panelu, token wyjścia i anteny kanałów), `docker compose up -d live`; sprawdzić ramkę w Grafice kanału i „Trio ↗”.
- Produkcja (stos `virtrs`) – legacy zawsze najnowsze: kopia `ersatztv-config` (RUNBOOK §2a pkt 2), w `.env` CG Playout usunąć `LIVE_LEGACY_IMAGE=vizrs-live-legacy:local-26.12.0` (nakładka zbuduje `vizrs-live-legacy:local` na `ghcr.io/ersatztv/legacy:latest`), `docker compose up -d ersatztv`; Diagnostyka: wersja legacy, `commandsMissing = []`.
- Przed wdrożeniem z grafiką: `panel_token` w CG Playout, `VIZRS_LIVE_CG_URL`/`VIZRS_LIVE_CG_TOKEN` w panelu, Sloty na żywo z prawdziwym sygnałem z OBS (LUKI #3).

## Blokery / uwagi

- e2e wymaga Playwright (`PLAYWRIGHT_DIR` albo `tests/local.env`) i Dockera (stos testowy).
- Prawdziwe usługi (`tests/real.sh`) sprawdza się ręcznie; przed `tests/stack.sh test` zawsze `tests/real.sh down` (inaczej liczby pozycji w e2e się nie zgadzają).

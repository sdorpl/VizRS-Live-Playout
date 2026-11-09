# STATUS – stan prac

> Aktualizuj w tym samym commicie, który zmienia stan. Plan: [plany/PLAN-rozbudowy.md](plany/PLAN-rozbudowy.md), znane braki: [LUKI.md](LUKI.md), opis działania: [DOKUMENTACJA.md](DOKUMENTACJA.md).
>
> **Ostatnia aktualizacja:** 2026-11-09

## Bieżący etap

**Wydanie 1.2.3** (2026-11-08) na najnowszym ErsatzTV legacy (sprawdzone z v26.12.0 i v26.11.6). Zrobione w całości: plan rozbudowy R0–R12 i plan makiety M0–M9; zawartość wydań: [CHANGELOG.md](../CHANGELOG.md). W 1.2.1 względem 1.1.0 (1.2.0 – tag bez publikacji): panel na wzór makiety UI (liczniki w menu, wybór kanału, Na antenie z ramką VizRS, EPG, kafle mediów, kolekcje, playouty, siatka tygodnia bloków, reguły grafiki i wejścia studia w tabelach, Ustawienia w panelach, „Stan” stosu), limit logowań na adres klienta, poprawiona integracja z VizRS (Trio, `/output`), legacy zawsze najnowsze, działające workflow wydań (amd64 + arm64), akceleracja Intel/AMD/NVIDIA sprawdzana w obrazie legacy przed publikacją.

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

Plan [PLAN-makieta.md](plany/PLAN-makieta.md) zrobiony w całości (M0–M9). Nowy plan: [PLAN-mcr.md](plany/PLAN-mcr.md) (2026-11-09) – braki wobec web GUI legacy i panel kanału na wzór Viz Channel Branding; następne zadanie: **K1** (numeracja kanałów naraz). Punkty K7–K11 wymagają zmian w API VizRS CG Playout. Do decyzji użytkownika: **N0** – legacy czy Next (PLAN-mcr §6; zalecenie: zostać na legacy, przygotować hybrydę). Poza planem: [LUKI.md](LUKI.md) G1 → G2 → G3.

## Kroki ręczne (czekają na użytkownika)

Sesje automatu niczego nie publikują i nie ruszają produkcji; to zostało do zrobienia ręcznie:

- Wydanie 1.2.3: tag `v1.2.3` wypchnięty 2026-11-08 (razem z VizRS CG Playout v2.12.0 – wejścia studia z panelu; s1 przez stack-refresh); pakiety ghcr publiczne.
- Lokalna produkcja (stos `virtrs` CG Playout) przełączona 2026-11-07 na VizRS Live nakładką `compose.cg-playout.yml` (RUNBOOK §2a): legacy v26.11.6 → v26.12.0 z mostem (migracja bazy; kopia w `~/vizrs-kopie/`), proxy na 8409, panel na 8090, CG Playout z live API. Do sprawdzenia: tunery i odtwarzacze, które korzystały z innych ścieżek niż `/iptv/*` (`curl -I`, DOKUMENTACJA §8).
- Produkcja (stos `virtrs`) po poprawce integracji z VizRS (Trio, podgląd `/output`): przebudować obraz panelu (`vizrs-live:local`), w `.env` CG Playout usunąć `VIZRS_LIVE_VIZRS_URL=http://127.0.0.1:8789` (nakładka ustawi `:8789` = host panelu, token wyjścia i anteny kanałów), `docker compose up -d live`; sprawdzić ramkę w Grafice kanału i „Trio ↗”.
- ~~Produkcja (stos `virtrs`) – legacy zawsze najnowsze~~ – zrobione 2026-11-07 21:15: kopia `~/vizrs-kopie/etv-config-2026-11-07-2114-przed-legacy-latest.tgz` i `.env`, `LIVE_LEGACY_IMAGE` usunięte z `.env` CG Playout, `ersatztv` na `vizrs-live-legacy:local` (najnowsze legacy = v26.12.0, most 1.2.0, `commandsMissing = []`, NVIDIA przez CDI, `tests/hwaccel.sh` zielony).
- Przed wdrożeniem z grafiką: `panel_token` w CG Playout, `VIZRS_LIVE_CG_URL`/`VIZRS_LIVE_CG_TOKEN` w panelu, Sloty na żywo z prawdziwym sygnałem z OBS (LUKI #3).

## Blokery / uwagi

- e2e wymaga Playwright (`PLAYWRIGHT_DIR` albo `tests/local.env`) i Dockera (stos testowy).
- Prawdziwe usługi (`tests/real.sh`) sprawdza się ręcznie; przed `tests/stack.sh test` zawsze `tests/real.sh down` (inaczej liczby pozycji w e2e się nie zgadzają).

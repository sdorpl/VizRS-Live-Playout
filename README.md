# VizRS Live – panel kanału nad ErsatzTV legacy

Część rodziny **VizRS**. Polski panel do prowadzenia kanałów telewizyjnych **ErsatzTV**: kanały, ramówka, playouty, EPG, diagnostyka – bez używania web GUI ErsatzTV legacy. Logika (baza, skaner, planowanie, nadawanie przez ErsatzTV Next) zostaje w legacy; VizRS Live ją pokazuje i nią steruje.

> **Stan: 0.3.0.** Działa end-to-end na ErsatzTV legacy v26.11.6: pełna edycja kanałów, harmonogramów (ramówka klasyczna z pozycjami), playoutów (wszystkie rodzaje, harmonogramy zastępcze), bibliotek i mediów (przeglądarka, kosz), kolekcji (zwykłe, inteligentne, wielo-, powtórki), playlist z podglądem, profili kodowania, znaków wodnych, wypełniaczy i logo kanału; podgląd ramówki i EPG, diagnostyka, konsola komend. Bloki, szablony, deco i grafika na razie tylko czytają dane z legacy; kolejne etapy: [docs/PLAN-rozbudowy.md](docs/PLAN-rozbudowy.md). Plan: [PLAN-vizrs-live.md](../VizRS%20CG%20System/docs/plany/PLAN-vizrs-live.md) w VizRS CG System.

## Jak to działa

```
 przeglądarka ──► vizrs-live (Rust, :8090) ──► ErsatzTV legacy (:8409)
                  UI panelu + pośrednik         └─ VizRS Bridge (C#, w procesie legacy)
                                                    └─ komendy legacy (MediatR) ──► baza, playout, Next
```

- **VizRS Bridge** (`bridge/`, C#, ~500 linii): wtyczka ładowana do niezmienionego legacy przez `DOTNET_STARTUP_HOOKS` i `ASPNETCORE_HOSTINGSTARTUPASSEMBLIES`. Jeden ogólny dyspozytor: `POST /vizrs-bridge/command/{Nazwa}` wywołuje tę samą komendę legacy, której używa jego UI. Dozwolone komendy wymienia **biała lista** [`bridge/commands.txt`](bridge/commands.txt) – nowa funkcja panelu to zwykle nowy wiersz, bez zmiany kodu C#.
- **vizrs-live** (`server/`, Rust bez zależności): podaje UI panelu i przekazuje komendy do mostu. Token mostu nie trafia do przeglądarki.
- **UI** (`server/web/`, czysty JS bez bibliotek): ekrany na wzór web GUI legacy, po polsku, w stylu VizRS.

## Uruchomienie (Docker)

```bash
cp .env.example .env          # ustaw VIZRS_BRIDGE_TOKEN i VIZRS_LIVE_TOKEN
docker compose up -d --build
```

Panel: `http://<serwer>:8090/` (logowanie tokenem `VIZRS_LIVE_TOKEN`). Widzowie: `http://<serwer>:8409/iptv/channels.m3u`.

Szczegóły, opcje, bezpieczeństwo i ograniczenia: [docs/DOKUMENTACJA.md](docs/DOKUMENTACJA.md). Dalsze prace: [docs/PLAN-rozbudowy.md](docs/PLAN-rozbudowy.md) (R0–R11, jeden punkt na sesję).

## Praca nad kodem

```bash
tests/stack.sh up          # stos testowy na 18409/18090 (nie rusza produkcji) + smoke mostu
tests/stack.sh seed        # wideo testowe i kanał INFO24 z ramówką – wyłącznie przez panel
PLAYWRIGHT_DIR=… node tests/e2e.cjs     # e2e panelu
tests/stack.sh down
```

## Licencja

MIT. ErsatzTV legacy (zlib) i ErsatzTV Next (MIT) to osobne projekty; VizRS Live ich nie zmienia ani nie rozpowszechnia ich kodu – obraz `vizrs-live-legacy` dokłada tylko plik `VizRS.Bridge.dll` do oficjalnego obrazu.

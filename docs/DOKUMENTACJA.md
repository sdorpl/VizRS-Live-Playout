# VizRS Live – dokumentacja

Wersja 0.1.0 (prototyp), sprawdzona z ErsatzTV legacy **v26.11.6** (obraz `ghcr.io/ersatztv/legacy`, silnik Next).

## 1. Składniki

| Składnik | Gdzie | Rola |
|---|---|---|
| VizRS Bridge | `bridge/` (C#, .NET 10) | most REST w procesie ErsatzTV legacy: ogólny dyspozytor komend z białą listą |
| vizrs-live | `server/` (Rust, bez zależności) | serwer panelu: UI, logowanie, pośrednik do mostu |
| UI panelu | `server/web/` (JS, bez bibliotek) | ekrany na wzór web GUI legacy, po polsku; wbudowane w binarkę (`include_str!`) |
| obraz legacy z mostem | `docker/legacy-bridge.Dockerfile` | `FROM ghcr.io/ersatztv/legacy` + `VizRS.Bridge.dll` + `commands.txt` + 2 zmienne środowiskowe |
| obraz panelu | `docker/live.Dockerfile` | statyczna binarka musl w `scratch` |

## 2. Most (VizRS Bridge)

### Wpięcie bez zmiany legacy

- `DOTNET_STARTUP_HOOKS=/vizrs-bridge/VizRS.Bridge.dll` – hak startowy .NET; rejestruje rozwiązywanie zestawu `VizRS.Bridge` (nie ma go w `ErsatzTV.deps.json`).
- `ASPNETCORE_HOSTINGSTARTUPASSEMBLIES=VizRS.Bridge` – ASP.NET Core ładuje `BridgeHostingStartup`, który dokłada oprogramowanie pośrednie na początek potoku legacy (`IStartupFilter`).
- Most kompiluje się tylko przeciw ASP.NET Core i `MediatR.dll` **z obrazu legacy** (wersja zawsze zgodna). Komendy legacy wyszukuje w czasie działania (refleksja po `ErsatzTV.Application`), więc nie wiąże się z ich wersją przy kompilacji.

### API (`/vizrs-bridge/…`, nagłówek `X-VizRS-Token`)

| Metoda i ścieżka | Odpowiedź |
|---|---|
| `GET /health` | `{"ok":true,"result":{"bridge","legacy","commandsAllowed","commandsMissing","commandsKnown"}}` |
| `GET /commands` | dozwolone komendy: nazwa, `query`/`command`, parametry (nazwa, typ, opcjonalny, wartości wyliczeń) |
| `POST /command/{Nazwa}` | argumenty = obiekt JSON z polami komendy (nazwy jak w legacy, wielkość liter dowolna, wyliczenia tekstem) |

Wynik `POST /command`:

- `{"ok":true,"result":…}` – sukces (`Either`/`Option` legacy rozpakowane, `Unit` = `null`);
- `{"ok":false,"error":"…"}` (HTTP 200) – legacy odrzucił komendę, komunikat legacy (np. „Channel number must be unique”);
- `{"ok":true,"queued":"IBackgroundServiceRequest"}` (HTTP 202) – zadanie w tle (np. `BuildPlayout`) wysłane do kolejki legacy, jak robi to jego UI;
- `{"ok":true,"result":null,"warning":"…"}` – komenda wykonana, ale wyniku legacy nie da się odczytać (§5);
- 400 złe argumenty (nazwa pola, typ), 401 zły token, 403 komenda spoza białej listy, 413 > 1 MB, 500 wyjątek legacy, 503 most wyłączony.

Dopasowanie argumentów: konstruktor z największą liczbą podanych pól; brakujące pola = wartości domyślne (`""` dla tekstu, pusta lista dla list, `null` dla typów opcjonalnych); pola spoza konstruktora ustawiane przez właściwości; nieznane pole = 400.

### Konfiguracja mostu

| Zmienna | Znaczenie |
|---|---|
| `VIZRS_BRIDGE_TOKEN` | wymagany, min. 16 znaków; bez niego most odpowiada 503 i nic nie wykonuje |
| `VIZRS_BRIDGE_COMMANDS` | ścieżka białej listy (domyślnie `commands.txt` obok DLL) |

Biała lista: jedna nazwa komendy w wierszu, `#` – komentarz. Nazwy nieznane w danej wersji legacy pokazuje `GET /health` (`commandsMissing`) – to pierwszy sygnał zmiany w nowym wydaniu legacy.

## 3. Panel (vizrs-live)

### Opcje

| Opcja | Zmienna | Domyślnie |
|---|---|---|
| `--bind` | `VIZRS_LIVE_BIND` | `127.0.0.1` (w obrazie `0.0.0.0`) |
| `--port` | `VIZRS_LIVE_PORT` | `8090` |
| `--bridge` | `VIZRS_LIVE_BRIDGE` | `http://127.0.0.1:8409` |
| `--bridge-token` | `VIZRS_LIVE_BRIDGE_TOKEN` | wymagany (= `VIZRS_BRIDGE_TOKEN`) |
| `--token` | `VIZRS_LIVE_TOKEN` | brak; **wymagany**, gdy panel nasłuchuje poza 127.0.0.1 |
| `--stream-url` | `VIZRS_LIVE_STREAM_URL` | brak; adres legacy dla widzów (odnośniki „Strumień”, M3U, XMLTV) |
| `--vizrs-url` | `VIZRS_LIVE_VIZRS_URL` | brak; VizRS CG System (podgląd `/output`, odnośnik do Trio) |
| `--web KATALOG` | – | UI z dysku zamiast wbudowanego |
| `--healthcheck`, `--version`, `--help` | – | |

### API panelu

| Ścieżka | Opis |
|---|---|
| `GET /health` | `{"ok":true}`, bez logowania (HEALTHCHECK) |
| `POST /api/login` | treść = token panelu; ustawia ciasteczko `vizrs_live` (HttpOnly, SameSite=Strict, 30 dni) |
| `POST /api/logout` | usuwa ciasteczko |
| `GET /api/status` | wersje, adresy, stan mostu (`bridge`, `bridgeError`) |
| `GET /api/commands` | lista z mostu |
| `POST /api/cmd/{Nazwa}` | komenda przez most (nazwa: litery i cyfry) |

Każdy `POST` wymaga nagłówka `X-VizRS-Live: 1` (obce strony nie mogą go wysłać bez CORS – ochrona przed CSRF). Gdy ustawiony jest token panelu, `/api/*` wymaga ciasteczka albo `Authorization: Bearer`. Odpowiedzi mają CSP bez skryptów i stylów inline, `X-Frame-Options: DENY`.

## 4. Ekrany

| Ekran | Komendy legacy | Prototyp 0.1 |
|---|---|---|
| Na antenie | `GetAllChannels`, `GetPagedPlayouts`, `GetFuturePlayoutItemsById`, `BuildPlayout` | teraz / następnie z postępem, przebudowa i reset playoutu, najbliższe pozycje, podgląd VizRS `/output` |
| Przewodnik EPG | `GetPagedPlayouts`, `GetFuturePlayoutItemsById` | oś 4 h dla wszystkich kanałów |
| Kanały | `GetAllChannels`, `CreateChannel`, `UpdateChannel`, `DeleteChannel` (+ profile, znaki, wypełniacze do list wyboru) | **pełna edycja** |
| Playouty | `GetPagedPlayouts`, `GetFuturePlayoutItemsById`, `BuildPlayout` | lista, pozycje, przebudowa |
| Profile kodowania, Znaki wodne, Biblioteki, Kolekcje, Playlisty, Wypełniacze, Harmonogramy, Bloki i szablony, Deco, Grafika kanału | `GetAll…` | odczyt |
| Sloty na żywo | – | następny etap (VizRS CG Playout) |
| Ustawienia | – | konfiguracja panelu i stan mostu |
| Diagnostyka | `GetAllHealthCheckResults` + wszystkie z listy | kontrole legacy, konsola komend |

Na białej liście są też komendy bez ekranu, używane przez `tests/stack.sh seed` i dostępne w konsoli: `CreateLocalLibrary`, `QueueLibraryScanByLibraryId`, `CreateSmartCollection`, `CreateProgramSchedule`, `ReplaceProgramScheduleItems`, `CreateClassicPlayout`.

## 5. Znane ograniczenia (legacy v26.11.6)

- `AddProgramScheduleItem` zapisuje pozycję, ale legacy rzuca wyjątek przy budowaniu odpowiedzi (`Mapper.ProjectToViewModel`, niezaładowane znaki wodne pozycji). Nie ma jej na białej liście; panel używa `ReplaceProgramScheduleItems`, jak UI legacy.
- `ReplaceProgramScheduleItems` zwraca leniwą projekcję, której nie da się zserializować – most zgłasza sukces z ostrzeżeniem (`warning`).
- Część wyników legacy to encje bazy (np. `BuildStatus` w `GetPagedPlayouts`) – most serializuje je z pominięciem cykli; mogą być duże.
- Web GUI legacy dalej działa na porcie 8409 (ten sam port co strumienie). Żeby operatorzy go nie używali, wystaw na zewnątrz tylko `/iptv/*` (np. przez odwrotne proxy) – w prototypie tego nie wymuszamy.
- Logowanie do Plex (przepływ w przeglądarce) – nie sprawdzone.

## 6. Aktualizacja legacy

1. Zbuduj obraz z nową wersją: `--build-arg LEGACY_IMAGE=ghcr.io/ersatztv/legacy:<wersja>`.
2. `tests/stack.sh up` – smoke mostu; `GET /vizrs-bridge/health` → `commandsMissing` musi być puste.
3. `node tests/e2e.cjs` – e2e panelu.
4. Dopiero potem zmień `LEGACY_IMAGE` w `.env` produkcji.

## 7. Testy

| Test | Polecenie |
|---|---|
| serwer (Rust) | `cd server && cargo clippy --all-targets -- -D warnings && cargo test` |
| most + panel (smoke) | `tests/stack.sh up` |
| ramówka przez panel | `tests/stack.sh seed` |
| e2e UI | `PLAYWRIGHT_DIR=… node tests/e2e.cjs` |

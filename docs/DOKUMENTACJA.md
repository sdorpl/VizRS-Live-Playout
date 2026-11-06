# VizRS Live – dokumentacja

Wersja 0.2.0, sprawdzona z ErsatzTV legacy **v26.11.6** (obraz `ghcr.io/ersatztv/legacy`, silnik Next).

## 1. Składniki

| Składnik | Gdzie | Rola |
|---|---|---|
| VizRS Bridge | `bridge/` (C#, .NET 10) | most REST w procesie ErsatzTV legacy: ogólny dyspozytor komend z białą listą |
| vizrs-live | `server/` (Rust, bez zależności) | serwer panelu: UI, logowanie, pośrednik do mostu |
| UI panelu | `server/web/` (moduły ES, bez bibliotek) | ekrany na wzór web GUI legacy, po polsku; wbudowane w binarkę (`include_str!`), budowa w §3 „UI” |
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

Dopasowanie argumentów: konstruktor z największą liczbą podanych pól; brakujące pola = wartości domyślne (`""` dla tekstu, pusta lista dla list, `null` dla typów opcjonalnych); pola spoza konstruktora ustawiane przez właściwości; nieznane pole = 400. To dotyczy tylko pól samej komendy: **typy zagnieżdżone** (np. pozycje `ReplaceProgramScheduleItem` w `Items`) wczytuje zwykły deserializator JSON – brakująca lista daje tam `null` i wyjątek legacy, więc panel wysyła je z kompletem pól. `GET /commands` nie opisuje pól typów zagnieżdżonych (ani ich wyliczeń).

Wyniki: typy abstrakcyjne z przestrzeni `ErsatzTV.*` (np. `ProgramScheduleItemViewModel`, którego podtypy `One`/`Multiple`/`Duration`/`Flood` mają własne pola) serializowane są po typie rzeczywistym (`RuntimeTypeConverterFactory`), żeby nie gubić pól podtypów.

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

### UI (`server/web/`)

| Plik | Zawartość |
|---|---|
| `app.js` | wejście: stan mostu w pasku górnym, licznik playoutów z błędem budowy (`GetPlayoutWarningsCount`, co 15 s; odnośnik do Playoutów), metadane komend (`GET /api/commands`), start routera |
| `core.js` | DOM (`h`, `table`, `panel`…), `api`/`cmd`/`argsFor`, toast, dialog, router (`VIEWS`, `route`), etykiety `PL`, kontrola białej listy (`missing`, `missingNote`, `needs`) |
| `form.js` | **formularz z metadanych**: rodzaj kontrolki z typu parametru komendy (tekst, liczba, tak/nie, wyliczenie z wartościami z mostu, `TimeSpan` gg:mm:ss, data/godzina, wybór id z listy, lista id); opis pola daje etykietę PL, sekcję, podpowiedź (tekst albo funkcja wartości), pole warunkowe (`show`; ukryta grupa ukrywa swoje pola), kontrolkę własną (`render`); `read()` zbiera wartości i opisuje złe pole |
| `parts.js` | `crudView` – ekran „lista + edytor” (+ Nowy, Zapisz, Usuń z potwierdzeniem, Kopiuj; `createCmd` – komenda zakładania zależna od danych); `listView` – lista tylko do odczytu; `itemsEditor` – lista pozycji (w górę/w dół, dodaj, usuń, edycja wiersza w panelu bocznym); `contentPicker` – wybór treści |
| `views/*.js` | ekrany, po jednym pliku na grupę menu (`antena`, `kanaly`, `media` – biblioteki, przeglądarka, kosz, `listy`, `ramowka`, `grafika`, `system`), duże ekrany we własnym pliku (`harmonogramy`, `playouty`); każdy dopisuje się do `VIEWS` |

Nowy plik w `server/web/` trzeba dopisać do `STATIC` w `server/src/main.rs`; test `module_imports_resolve` pilnuje, że każdy `import` wskazuje plik ze `STATIC`.

**Brakujące komendy.** Ekran (albo rodzaj treści w wyborze treści) sprawdza, czy jego komendy są w `GET /api/commands`; jeśli nie – pokazuje „ta funkcja wymaga komendy X na białej liście mostu” zamiast pustego ekranu albo błędu 403.

**Wybór treści** (`contentPicker`) daje pola treści pozycji legacy (`CollectionType` + `CollectionId` / `SmartCollectionId` / `MultiCollectionId` / `PlaylistId` / `MediaItemId` / `RerunCollectionId` albo `SearchTitle` + `SearchQuery`). Wyszukiwanie: `SearchCollections`, `SearchSmartCollections`, `SearchMultiCollections`, `SearchTelevisionShows`, `SearchTelevisionSeasons`, `SearchArtists` (legacy szuka `LIKE %tekst%`, najwyżej 10 wyników; pusty tekst = pierwsze 10), playlisty przez `GetAllPlaylistGroups` + `GetPlaylistsByPlaylistGroupId` (filtr po nazwie w przeglądarce). Powtórki wymagają `SearchRerunCollections` (dojdzie w R4).

## 4. Ekrany

| Ekran | Komendy legacy | Prototyp 0.1 |
|---|---|---|
| Na antenie | `GetAllChannels`, `GetPagedPlayouts`, `GetFuturePlayoutItemsById`, `BuildPlayout` | teraz / następnie z postępem, przebudowa i reset playoutu, najbliższe pozycje, podgląd VizRS `/output` |
| Przewodnik EPG | `GetPagedPlayouts`, `GetFuturePlayoutItemsById` | oś 4 h dla wszystkich kanałów |
| Kanały | `GetAllChannels`, `CreateChannel`, `UpdateChannel`, `DeleteChannel` (+ profile, znaki, wypełniacze do list wyboru) | **pełna edycja** (wzorzec „lista + edytor”, formularz z metadanych; „Kanał lustrzany” tylko dla źródła Mirror) |
| Harmonogramy | `GetAllProgramSchedules`, `CreateProgramSchedule`, `UpdateProgramSchedule`, `CopyProgramSchedule`, `DeleteProgramSchedule`, `GetProgramScheduleItems`, `ReplaceProgramScheduleItems` (+ wypełniacze, znaki wodne, elementy graficzne, kody języków, playouty do list) | **pełna edycja**: ustawienia i pozycje (edytor pozycji: start, treść, kolejność, maraton, tryb, wypełniacze, znaki i grafika, audio/napisy), kopiowanie, usuwanie (z ostrzeżeniem o playoutach); jeden „Zapisz” zapisuje ustawienia, potem pozycje |
| Playouty | `GetPagedPlayouts`, `CreateClassicPlayout`, `CreateBlockPlayout`, `CreateSequentialPlayout`, `CreateScriptedPlayout`, `CreateExternalJsonPlayout`, `UpdatePlayout`, `UpdateSequentialPlayout`, `UpdateScriptedPlayout`, `UpdateExternalJsonPlayout`, `DeletePlayout`, `BuildPlayout`, `ResetAllPlayouts`, `ErasePlayoutItems`, `ErasePlayoutHistory`, `CheckForOverlappingPlayoutItems`, `GetPlayoutAlternateSchedules`, `ReplacePlayoutAlternateScheduleItems`, `GetFuturePlayoutItemsById` (+ kanały, harmonogramy; `GetPlayoutWarningsCount` w pasku górnym) | **pełna obsługa**: zakładanie wszystkich rodzajów (tylko kanały bez playoutu), harmonogram główny, ścieżka pliku/skryptu, codzienna przebudowa, **harmonogramy zastępcze** (dni tygodnia/miesiąca, miesiące, zakres dat, kolejność), stan ostatniej budowy, przebudowa / od nowa / wyczyszczenie pozycji i historii / sprawdzenie nakładania, „Resetuj wszystkie”, usuwanie z potwierdzeniem, najbliższe pozycje |
| Biblioteki | `GetAllLocalLibraries`, `CountMediaItemsByLibrary`, `GetLocalLibraryPaths`, `CountMediaItemsByLibraryPath`, `CreateLocalLibrary`, `UpdateLocalLibrary`, `MoveLocalLibraryPath`, `DeleteLocalLibrary`, `QueueLibraryScanByLibraryId` | **pełna obsługa bibliotek lokalnych**: rodzaj, nazwa, ścieżki w kontenerze legacy (dodaj / usuń z potwierdzeniem / przenieś do innej biblioteki tego rodzaju), liczba pozycji (biblioteka i ścieżka), „Skanuj teraz” (też od razu po założeniu), usuwanie z potwierdzeniem |
| Przeglądarka | `QuerySearchIndexAllItems`, `QuerySearchIndex{OtherVideos,Movies,Shows,Seasons,Episodes,MusicVideos,Artists,Songs,Images,RemoteStreams}`, `GetMediaItemInfo` | zakładki rodzajów z liczbą pozycji, wyszukiwarka (składnia legacy, podpowiedź pól), stronicowanie po 50, karta pozycji (stan, czas, obraz, strumienie, rozdziały) |
| Kosz | `QuerySearchIndex…` (`state:FileNotFound`), `DeleteItemsFromDatabase`, `EmptyTrash` | pozycje bez pliku ze wszystkich rodzajów, usuwanie zaznaczonych z bazy, „Opróżnij kosz” – z potwierdzeniem |
| Profile kodowania, Znaki wodne, Kolekcje, Playlisty, Wypełniacze, Bloki i szablony, Deco, Grafika kanału | `GetAll…` | odczyt |
| Sloty na żywo | – | następny etap (VizRS CG Playout) |
| Ustawienia | – | konfiguracja panelu i stan mostu |
| Diagnostyka | `GetAllHealthCheckResults` + wszystkie z listy, zapytania wyboru treści | kontrole legacy, konsola komend, wybór treści (pola treści pozycji do konsoli) |

Na białej liście są też komendy bez ekranu, używane przez `tests/stack.sh seed` i testy oraz dostępne w konsoli: `CreateLocalLibrary`, `QueueLibraryScanByLibraryId`, `CreateSmartCollection`, `GetProgramScheduleById`, `GetPlayoutIdByChannelNumber`.

**Harmonogramy – szczegóły.** Listy wyboru pozycji (start, tryb, kolejność, maraton, reszta czasu…) są w `views/harmonogramy.js`, bo most nie opisuje wyliczeń typu zagnieżdżonego; ograniczenia jak w `ScheduleItemsEditor.razor` legacy: kolejność zależna od rodzaju treści, „wypełniaj grupami” tylko dla kilku/czasu i kolekcji, przy tasowaniu pozycji bez stałej godziny i trybu „wypełnij” (sprawdzane też przed zapisem). Wypełniacze w polach pozycji filtrowane po rodzaju (`FillerKind`). Pozycje wysyłane z `Index` = 1, 2, … w kolejności z tabeli; `GetProgramScheduleItems` nie zwraca ich posortowanych – panel sortuje po `Index`. Walidację robi legacy przy `ReplaceProgramScheduleItems` (np. „Tail Filler is required with tail mode Filler”, „A collection must not use multiple playback orders”) – komunikat zostaje po angielsku, z polskim wstępem; ustawienia harmonogramu są wtedy już zapisane, pozycje nie. Kolumna „Kanały”, uwaga w edytorze i potwierdzenie usunięcia: playouty klasyczne z `ScheduleName` = nazwa harmonogramu (nazwy są w legacy unikalne).

**Playouty – szczegóły.** Zakładanie: rodzaj → komenda `Create<Rodzaj>Playout` (legacy od razu buduje playout od nowa w tle). Klasyczny wymaga harmonogramu z pozycjami; sekwencyjny (YAML), skryptowy i zewnętrzny JSON – ścieżki pliku **w kontenerze legacy**, który musi już istnieć (legacy sprawdza; dla skryptu pierwsze słowo polecenia, reszta to argumenty). Blokowy startuje pusty – szablony dni i deco przypisze ekran Bloki (R6). Edycja: „Codziennie od nowa o” (`UpdatePlayout`, puste = wyłączone; legacy co dzień o tej godzinie robi `BuildPlayout` Reset), ścieżka pliku (`Update<Rodzaj>Playout`, tylko gdy zmieniona). **Harmonogramy zastępcze** (tylko klasyczny i nie w trybie „na żądanie”, jak w legacy): `GetPlayoutAlternateSchedules` zwraca też harmonogram główny jako ostatnią pozycję (`Id` = −1, najwyższy `Index`), a `ReplacePlayoutAlternateScheduleItems` zapisuje pozycję o najwyższym `Index` jako harmonogram główny – panel pokazuje go jako osobne pole „Harmonogram główny”, a przy zapisie dokleja na koniec listy. Legacy wybiera dla dnia pierwszą pasującą pozycję (wg kolejności); pusta lista dni/miesięcy nigdy nie pasuje, więc panel jej nie przyjmuje. Zapis tylko przy zmianie; legacy sam odświeża playout, gdy zmienia się harmonogram któregoś z już zbudowanych dni. Przebudowa: klasyczny – „Przebuduj” (Refresh) i „Od nowa” (Reset), pozostałe tylko „Od nowa” (jak w legacy). Konserwacja: „Wyczyść pozycje” (`ErasePlayoutItems`, blokowy/sekwencyjny/skryptowy – przyszłe pozycje, historia do teraz zostaje), „Wyczyść pozycje i historię” (`ErasePlayoutHistory`, wszystkie poza JSON), „Sprawdź nakładanie pozycji” (`CheckForOverlappingPlayoutItems` – zadanie w tle, wynik tylko w logach legacy). Licznik w pasku górnym: liczba playoutów, których ostatnia budowa się nie udała; komunikat błędu legacy jest w edytorze playoutu. `GetBlockPlayoutHistory` (historia bloków playoutu blokowego) dojdzie z ekranem Bloki (R6).

**Pliki YAML, skrypty i JSON – decyzja (R2, 2026-11-06): panel ich nie edytuje.** Operator kładzie pliki na wolumen konfiguracji legacy (`ETV_CONFIG` → `/config` w kontenerze; proponowany katalog `/config/schedules/`, skrypty `/config/scripts/`) i wpisuje w panelu ścieżkę w kontenerze. Zapis plików z panelu wymagałby nowego kodu C# w moście (zapis pliku w kontenerze legacy – poza ogólnym dyspozytorem) albo wspólnego wolumenu z panelem; oba rozwiązania otwierają zapis plików przez sieć, a edytor YAML bez bibliotek nie daje walidacji. Wracamy do tego, jeśli R9 (elementy graficzne legacy w YAML) będzie potrzebować zapisu plików – wtedy jeden ogólny endpoint mostu ograniczony do jednego katalogu (np. `/config/vizrs/`), z limitem rozmiaru, wspólny dla playoutów i grafiki.

**Media – szczegóły.** Ścieżki bibliotek to ścieżki **w kontenerze legacy** (np. `/config/media/…` na wolumenie konfiguracji albo zamontowany katalog) – panel to mówi przy polu i wymaga ścieżki bezwzględnej. Edycja biblioteki to jeden `UpdateLocalLibrary` z całą listą ścieżek (`Id` 0 = nowa); usunięta ścieżka znika z legacy razem ze swoimi pozycjami (pliki zostają), dlatego ✕ przy ścieżce z pozycjami pyta o potwierdzenie. Rodzaju biblioteki legacy nie pozwala zmienić. Przeniesienie ścieżki (`MoveLocalLibraryPath`) działa od razu, tylko między bibliotekami tego samego rodzaju. Postępu skanu legacy nie udostępnia zapytaniem (idzie zdarzeniami Blazora) – po „Skanuj teraz” panel przez pół minuty odświeża liczby pozycji. Wyszukiwarka dokleja `type:<rodzaj> AND (…)` jak legacy; liczby na zakładkach z `QuerySearchIndexAllItems` (pusty tekst = `*`). Kosz to wyszukiwanie `state:FileNotFound` (jak ekran Trash legacy). `RemoveMediaItems` (w planie R3) jest wewnętrzną komendą indeksu wyszukiwania – nie ma jej na białej liście; `UpdateLocalLibraryPath` to typ ścieżki w `UpdateLocalLibrary`, nie komenda. Czas wyświetlania folderów obrazów (`GetImageFolders`, `UpdateImageFolderDuration`) i skan pojedynczego serialu (`QueueShowScanByLibraryId`) są na liście, UI – razem z kolekcjami (R4). Dodawanie zaznaczonych pozycji do kolekcji/playlisty dojdzie w R4.

## 5. Znane ograniczenia (legacy v26.11.6)

- `AddProgramScheduleItem` zapisuje pozycję, ale legacy rzuca wyjątek przy budowaniu odpowiedzi (`Mapper.ProjectToViewModel`, niezaładowane znaki wodne pozycji). Nie ma jej na białej liście; panel używa `ReplaceProgramScheduleItems`, jak UI legacy.
- `ReplaceProgramScheduleItems` zwraca leniwą projekcję, której nie da się zserializować – most zgłasza sukces z ostrzeżeniem (`warning`); panel traktuje to jako sukces i przeładowuje pozycje.
- `DeleteProgramSchedule` usuwa kaskadowo playouty, które używają harmonogramu (klucz obcy `OnDelete(Cascade)` w legacy) – panel wymienia te kanały w potwierdzeniu usunięcia.
- `ReplacePlayoutAlternateScheduleItems` z pustą listą legacy odrzuca („must not be empty”) – panel zawsze wysyła co najmniej harmonogram główny.
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
| ramówka przez panel | `tests/stack.sh seed` (drugi raz nic nie dubluje; od zera: `tests/stack.sh reset`) |
| e2e UI | `tests/stack.sh test` (Playwright: `PLAYWRIGHT_DIR` albo `tests/local.env`) |
| **bramka przed commitem** | `tests/gate.sh` – wszystko powyżej po kolei |

Plan rozbudowy realizuje automat `scripts/plan.sh` (opis w `docs/PLAN-rozbudowy.md`, „Jak pracować”).

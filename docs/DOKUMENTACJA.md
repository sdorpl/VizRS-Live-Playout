# VizRS Live – dokumentacja

Wersja 1.0.0, sprawdzona z ErsatzTV legacy **v26.11.6** i **v26.12.0** (obraz `ghcr.io/ersatztv/legacy`, silnik Next; wydanie przypięte do **v26.12.0**; aktualizacja – §6).

Instrukcja operatora: [INSTRUKCJA.md](INSTRUKCJA.md). Wdrożenie, kopie, aktualizacja, odtworzenie: [RUNBOOK.md](RUNBOOK.md).

## 1. Składniki

| Składnik | Gdzie | Rola |
|---|---|---|
| VizRS Bridge | `bridge/` (C#, .NET 10) | most REST w procesie ErsatzTV legacy: ogólny dyspozytor komend z białą listą |
| vizrs-live | `server/` (Rust, bez zależności) | serwer panelu: UI, logowanie, pośrednik do mostu |
| UI panelu | `server/web/` (moduły ES, bez bibliotek) | ekrany na wzór web GUI legacy, po polsku; wbudowane w binarkę (`include_str!`), budowa w §3 „UI” |
| obraz legacy z mostem | `docker/legacy-bridge.Dockerfile` | `FROM ghcr.io/ersatztv/legacy` + `VizRS.Bridge.dll` + `commands.txt` + 2 zmienne środowiskowe |
| obraz panelu | `docker/live.Dockerfile` | statyczna binarka musl w `scratch` |
| proxy dla widzów | `docker/proxy.Caddyfile` (obraz `caddy`, usługa `proxy` w `compose.yml`) | na zewnątrz tylko strumienie, M3U/XMLTV, obrazy i HDHomeRun; web GUI legacy i most – 403 (§8) |
| CI | `.github/workflows/ci.yml`, `legacy-latest.yml`, `release.yml` | bramka na GitHub Actions; co tydzień najnowsze legacy (§7); wydanie obrazów po tagu `v*` (§9) |

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
| `POST /upload/{Logo\|Watermark}` | treść = bajty obrazu, `Content-Type` = typ obrazu → `SaveArtworkToDisk` → `{"ok":true,"result":"<nazwa pliku>"}` |

Wynik `POST /command`:

- `{"ok":true,"result":…}` – sukces (`Either`/`Option` legacy rozpakowane, `Unit` = `null`);
- `{"ok":false,"error":"…"}` (HTTP 200) – legacy odrzucił komendę, komunikat legacy (np. „Channel number must be unique”);
- `{"ok":true,"queued":"IBackgroundServiceRequest"}` (HTTP 202) – zadanie w tle (np. `BuildPlayout`) wysłane do kolejki legacy, jak robi to jego UI;
- `{"ok":true,"result":null,"warning":"…"}` – komenda wykonana, ale wyniku legacy nie da się odczytać (§5);
- 400 złe argumenty (nazwa pola, typ), 401 zły token, 403 komenda spoza białej listy, 413 > 1 MB, 500 wyjątek legacy, 503 most wyłączony.

**Wgrywanie obrazów – jedyny wyjątek od ogólnego dyspozytora (R5).** `SaveArtworkToDisk` przyjmuje `Stream`, więc nie przejdzie przez JSON. `POST /upload/{Rodzaj}` przyjmuje tylko rodzaje `Logo` i `Watermark`, tylko `image/png`, `image/jpeg`, `image/gif`, `image/webp` (typ z nagłówka musi zgadzać się z sygnaturą pliku; SVG odrzucony – może nieść skrypt), do 10 MB; działa tylko, gdy `SaveArtworkToDisk` jest na białej liście (inaczej 403). Odpowiedzi: 400 zły rodzaj, 413 za duży, 415 zły typ albo treść. Legacy zapisuje plik w pamięci obrazów pod skrótem SHA (`/config/cache/artwork/…`) i zwraca ten skrót: dla znaku wodnego to `Image.Path` (obraz pod `/artwork/watermarks/{skrót}`), dla logo kanału panel zapisuje `Logo.Path` = `iptv/logos/{skrót}` – tak jak Channel Editor legacy.

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
| `--cg-url` | `VIZRS_LIVE_CG_URL` | brak; VizRS CG Playout (sidecar `cg`, np. `http://cg:7700`) – Grafika kanału i Sloty na żywo; tylko `http://` w sieci wewnętrznej |
| `--cg-token` | `VIZRS_LIVE_CG_TOKEN` | wymagany przy `--cg-url`; = `panel_token` (`VIZRS_PANEL_TOKEN`) CG Playout; zostaje w serwerze |
| `--web KATALOG` | – | UI z dysku zamiast wbudowanego |
| `--healthcheck`, `--version`, `--help` | – | |

### API panelu

| Ścieżka | Opis |
|---|---|
| `GET /health` | `{"ok":true}`, bez logowania (HEALTHCHECK) |
| `POST /api/login` | treść = token panelu; ustawia ciasteczko `vizrs_live` (HttpOnly, SameSite=Strict, 30 dni) |
| `POST /api/logout` | usuwa ciasteczko |
| `GET /api/status` | wersje, adresy, stan mostu (`bridge`, `bridgeError`) |
| `GET /api/exposure` | (R10) kody HTTP ścieżek `/`, `/channels`, `/vizrs-bridge/health`, `/iptv/channels.m3u` pod adresem dla widzów (`--stream-url`), sprawdzane z serwera panelu: `{"url","error","probes":[{"path","status"}]}` |
| `GET /api/commands` | lista z mostu |
| `POST /api/cmd/{Nazwa}` | komenda przez most (nazwa: litery i cyfry) |
| `GET\|POST\|PUT\|DELETE /api/cg/…` | pośrednik do VizRS CG Playout (R9), biała lista niżej; odpowiedź `{"ok":true,"result":<JSON CG>}`, odrzucenie przez CG (4xx) = `{"ok":false,"error":"CG Playout odrzucił: …"}`, brak `--cg-url` = 409 |
| `POST /api/upload/{Logo\|Watermark}` | obraz do legacy przez most (`/vizrs-bridge/upload/…`); serwer sprawdza rodzaj, typ i sygnaturę pliku; limit treści 10 MB tylko dla tej ścieżki (pozostałe żądania: 1 MB) |

**Sekrety tylko do zapisu (R8).** W każdej odpowiedzi `/api/cmd/*` serwer panelu zamienia tekstowe wartości pól, których nazwa kończy się na `apikey`, `token`, `password` albo `secret` (bez względu na wielkość liter), na `"********"` (pusty tekst zostaje pusty) – `mask_secrets` w `server/src/main.rs`. Dotyczy to też konsoli komend w Diagnostyce. Komend, które zwracają sekret w innym kształcie (`Get{Jellyfin,Emby,Plex}ConnectionParameters` – gotowy nagłówek autoryzacji), nie ma na białej liście.

**Pośrednik CG Playout (R9).** Ścieżki panelu → CG Playout: `GET health` → `/health`; `GET ingest/{kanał}` → `/ingest/state?channel=`; `GET pages/{kanał}` → `/etv/pages?channel=`; `GET live/state`, `GET|POST live/shows`, `POST live/shows/scan`, `PUT|DELETE live/shows/{id}`, `PUT live/channels/{kanał}` (`anytime`), `POST live/channels/{kanał}/{hold|release|rebuild}` → `/api/live/…`. Segmenty: litery, cyfry, `-._` (bez `..`). Serwer wysyła `Authorization: Bearer <cg-token>` i `X-Operator: VizRS Live` (dziennik operacji CG Playout), bez `Origin` – CG Playout przyjmuje zmiany od klienta bez `Origin` (sprawdzenie `same_site` w `src/panel.rs` CG). Ustawień panelu CG (`PUT /api/live/settings`: biblioteka Remote Streams, publiczny adres ErsatzTV) pośrednik nie przepuszcza – ustawia się je raz w `/live` CG Playout. Do odpowiedzi stosowane jest to samo maskowanie sekretów co dla komend.

Każde żądanie zmieniające (`POST`, `PUT`, `DELETE`) wymaga nagłówka `X-VizRS-Live: 1` (obce strony nie mogą go wysłać bez CORS – ochrona przed CSRF). Gdy ustawiony jest token panelu, `/api/*` wymaga ciasteczka albo `Authorization: Bearer`. **Każda** odpowiedź (też API i UI z `--web`) ma CSP (`http::CSP`: bez skryptów i stylów inline, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. Logowanie: najwyżej 10 nieudanych prób na minutę (licznik wspólny dla wszystkich klientów), potem 429 do końca okna – także dla dobrego tokenu; każda nieudana próba czeka 400 ms i trafia do dziennika (`login: zły token`). Ciasteczko dostaje `Secure`, gdy panel stoi za proxy TLS (`X-Forwarded-Proto: https`).

### UI (`server/web/`)

| Plik | Zawartość |
|---|---|
| `app.js` | wejście: stan mostu w pasku górnym, licznik playoutów z błędem budowy (`GetPlayoutWarningsCount`, co 15 s; odnośnik do Playoutów), metadane komend (`GET /api/commands`), start routera |
| `core.js` | DOM (`h`, `table`, `panel`…), `api`/`cmd`/`argsFor`, `upload` (obraz do legacy), `legacyUrl` (adres pliku legacy przez `--stream-url`), toast, dialog, router (`VIEWS`, `route`), etykiety `PL`, kontrola białej listy (`missing`, `missingNote`, `needs`) |
| `form.js` | **formularz z metadanych**: rodzaj kontrolki z typu parametru komendy (tekst, liczba, tak/nie, wyliczenie z wartościami z mostu, `TimeSpan` gg:mm:ss, data/godzina, wybór id z listy, lista id); opis pola daje etykietę PL, sekcję, podpowiedź (tekst albo funkcja wartości), pole warunkowe (`show`; ukryta grupa ukrywa swoje pola), kontrolkę własną (`render`); `read()` zbiera wartości i opisuje złe pole |
| `parts.js` | `crudView` – ekran „lista + edytor” (+ Nowy, Zapisz, Usuń z potwierdzeniem, Kopiuj; `createCmd` – komenda zakładania zależna od danych); `listView` – lista tylko do odczytu; `itemsEditor` – lista pozycji (w górę/w dół, dodaj, usuń, edycja wiersza w panelu bocznym); `contentPicker` – wybór treści; `groupActions` – „+ Grupa” / „Usuń grupę…”; `dayBar` – oś doby 24 h z segmentami |
| `when.js` | „kiedy obowiązuje”: dni tygodnia, dni miesiąca, miesiące, zakres dat (`whenEditor`), dopasowanie dnia jak w legacy (`matchesDate`, `pickFor`) – wspólne dla harmonogramów zastępczych i kalendarza playoutu blokowego |
| `views/*.js` | ekrany, po jednym pliku na grupę menu (`antena`, `kanaly`, `media` – biblioteki, przeglądarka, kosz, `zrodla` – Jellyfin, Emby, Plex, strumienie zdalne, `listy`, `grafika`, `system`), duże ekrany we własnym pliku (`harmonogramy`, `playouty`, `kalendarz` – kalendarz tygodnia playoutu blokowego, `bloki` – bloki i szablony dnia, `deco` – deco i szablony deco, `profile`, `znaki` – też pole obrazu `imageField` dla logo kanału, `wypelniacze`); każdy dopisuje się do `VIEWS` |

Nowy plik w `server/web/` trzeba dopisać do `STATIC` w `server/src/main.rs`; test `module_imports_resolve` pilnuje, że każdy `import` wskazuje plik ze `STATIC`.

**Brakujące komendy.** Ekran (albo rodzaj treści w wyborze treści) sprawdza, czy jego komendy są w `GET /api/commands`; jeśli nie – pokazuje „ta funkcja wymaga komendy X na białej liście mostu” zamiast pustego ekranu albo błędu 403.

**Wybór treści** (`contentPicker`) daje pola treści pozycji legacy (`CollectionType` + `CollectionId` / `SmartCollectionId` / `MultiCollectionId` / `PlaylistId` / `MediaItemId` / `RerunCollectionId` albo `SearchTitle` + `SearchQuery`). Wyszukiwanie: `SearchCollections`, `SearchSmartCollections`, `SearchMultiCollections`, `SearchTelevisionShows`, `SearchTelevisionSeasons`, `SearchArtists` (legacy szuka `LIKE %tekst%`, najwyżej 10 wyników; pusty tekst = pierwsze 10), playlisty przez `GetAllPlaylistGroups` + `GetPlaylistsByPlaylistGroupId` (filtr po nazwie w przeglądarce). Powtórki wymagają `SearchRerunCollections` (dojdzie w R4).

## 4. Ekrany

| Ekran | Komendy legacy | Prototyp 0.1 |
|---|---|---|
| Na antenie | `GetAllChannels`, `GetPagedPlayouts`, `GetFuturePlayoutItemsById`, `BuildPlayout` | teraz / następnie z postępem, przebudowa i reset playoutu, najbliższe pozycje, podgląd VizRS `/output` |
| Przewodnik EPG | `GetPagedPlayouts`, `GetFuturePlayoutItemsById` | oś 4 h dla wszystkich kanałów |
| Kanały | `GetAllChannels`, `CreateChannel`, `UpdateChannel`, `DeleteChannel`, `SaveArtworkToDisk` (logo, przez `/api/upload/Logo`) (+ profile, znaki, wypełniacze do list wyboru) | **pełna edycja** (wzorzec „lista + edytor”, formularz z metadanych; „Kanał lustrzany” tylko dla źródła Mirror); logo: wgrany obraz albo adres URL, z podglądem |
| Profile kodowania | `GetAllFFmpegProfiles`, `NewFFmpegProfile`, `CreateFFmpegProfile`, `UpdateFFmpegProfile`, `CopyFFmpegProfile`, `DeleteFFmpegProfile`, `GetAllResolutions`, `GetSupportedHardwareAccelerationKinds` (+ kanały) | **pełna edycja**: rozdzielczość, obraz, akceleracja z informacją o sprzęcie, dźwięk z normalizacją głośności (−23 LUFS), nowy z wartościami domyślnymi legacy, kopiuj, usuń (z listą kanałów) |
| Znaki wodne | `GetAllWatermarks`, `CreateWatermark`, `UpdateWatermark`, `CopyWatermark`, `DeleteWatermark`, `SaveArtworkToDisk` (przez `/api/upload/Watermark`) (+ kanały) | **pełna edycja**: wgrany obraz albo logo kanału, tryb (stały, przerywany, wyrażenie krycia), 9 położeń, rozmiar, marginesy, krycie, warstwa; podgląd na makiecie kadru 16:9; miniatury na liście |
| Wypełniacze | `GetAllFillerPresets`, `CreateFillerPreset`, `UpdateFillerPreset`, `DeleteFillerPreset` (+ kolekcje do nazw treści) | **pełna edycja**: miejsce, tryb (czas, liczba, losowa liczba, dopełnienie do pełnych minut), treść (wybór treści), znaki wodne, wyrażenie przerw, rozdziały |
| Harmonogramy | `GetAllProgramSchedules`, `CreateProgramSchedule`, `UpdateProgramSchedule`, `CopyProgramSchedule`, `DeleteProgramSchedule`, `GetProgramScheduleItems`, `ReplaceProgramScheduleItems` (+ wypełniacze, znaki wodne, elementy graficzne, kody języków, playouty do list) | **pełna edycja**: ustawienia i pozycje (edytor pozycji: start, treść, kolejność, maraton, tryb, wypełniacze, znaki i grafika, audio/napisy), kopiowanie, usuwanie (z ostrzeżeniem o playoutach); jeden „Zapisz” zapisuje ustawienia, potem pozycje |
| Playouty | `GetPagedPlayouts`, `CreateClassicPlayout`, `CreateBlockPlayout`, `CreateSequentialPlayout`, `CreateScriptedPlayout`, `CreateExternalJsonPlayout`, `UpdatePlayout`, `UpdateSequentialPlayout`, `UpdateScriptedPlayout`, `UpdateExternalJsonPlayout`, `DeletePlayout`, `BuildPlayout`, `ResetAllPlayouts`, `ErasePlayoutItems`, `ErasePlayoutHistory`, `CheckForOverlappingPlayoutItems`, `GetPlayoutAlternateSchedules`, `ReplacePlayoutAlternateScheduleItems`, `GetFuturePlayoutItemsById`; blokowy: `GetPlayoutTemplates`, `ReplacePlayoutTemplateItems`, `GetDecoByPlayoutId`, `UpdateDefaultDeco` (+ szablony, bloki, deco do kalendarza) (+ kanały, harmonogramy; `GetPlayoutWarningsCount` w pasku górnym) | **pełna obsługa**: zakładanie wszystkich rodzajów (tylko kanały bez playoutu), harmonogram główny, ścieżka pliku/skryptu, codzienna przebudowa, **harmonogramy zastępcze** (dni tygodnia/miesiąca, miesiące, zakres dat, kolejność), **kalendarz tygodnia playoutu blokowego** (szablony dni z szablonem deco, deco domyślne, podgląd tygodnia na osiach doby), stan ostatniej budowy, przebudowa / od nowa / wyczyszczenie pozycji i historii / sprawdzenie nakładania, „Resetuj wszystkie”, usuwanie z potwierdzeniem, najbliższe pozycje |
| Biblioteki | `GetAllLocalLibraries`, `CountMediaItemsByLibrary`, `GetLocalLibraryPaths`, `CountMediaItemsByLibraryPath`, `CreateLocalLibrary`, `UpdateLocalLibrary`, `MoveLocalLibraryPath`, `DeleteLocalLibrary`, `QueueLibraryScanByLibraryId` | **pełna obsługa bibliotek lokalnych**: rodzaj, nazwa, ścieżki w kontenerze legacy (dodaj / usuń z potwierdzeniem / przenieś do innej biblioteki tego rodzaju), liczba pozycji (biblioteka i ścieżka), „Skanuj teraz” (też od razu po założeniu), usuwanie z potwierdzeniem |
| Źródła zewnętrzne | Jellyfin / Emby (`K` = `Jellyfin` albo `Emby`): `GetAllKMediaSources`, `GetKSecrets`, `SaveKSecrets`, `DisconnectK`, `SynchronizeKMediaSources`, `SynchronizeKLibraries`, `GetKLibrariesBySourceId`, `UpdateKLibraryPreferences`, `SynchronizeKLibraryByIdIfNeeded`, `ForceSynchronizeKLibraryById`, `SynchronizeKCollections`, `GetKPathReplacementsBySourceId`, `UpdateKPathReplacements`; Plex: `GetAllPlexMediaSources`, `StartPlexPinFlow`, `SignOutOfPlex`, `DeletePlexMediaSource`, `SynchronizePlexMediaSources`, `SynchronizePlexLibraries`, `GetPlexLibrariesBySourceId`, `UpdatePlexLibraryPreferences`, `SynchronizePlexLibraryByIdIfNeeded`, `ForceSynchronizePlexLibraryById`, `SynchronizePlexNetworks`, `SynchronizePlexCollections`, `GetPlexPathReplacementsBySourceId`, `UpdatePlexPathReplacements`; strumienie: `GetAllLocalLibraries` | zakładki **Jellyfin**, **Emby** (adres i klucz API – klucz tylko do zapisu, połącz / połącz ponownie, rozłącz z potwierdzeniem), **Plex** (logowanie kodem PIN na stronie Plex, inne konto, wyloguj, usuń serwer); dla każdego serwera: **biblioteki** do synchronizacji (zapis wyboru, synchronizacja biblioteki, odświeżenie listy, synchronizacja kolekcji) i **zamiany ścieżek**; **strumienie zdalne** – opis pliku .yml i biblioteki tego rodzaju |
| Przeglądarka | `QuerySearchIndexAllItems`, `QuerySearchIndex{OtherVideos,Movies,Shows,Seasons,Episodes,MusicVideos,Artists,Songs,Images,RemoteStreams}`, `GetMediaItemInfo`, `AddItemsToCollection`, `AddItemsToPlaylist` | zakładki rodzajów z liczbą pozycji, wyszukiwarka (składnia legacy, podpowiedź pól), stronicowanie po 50, karta pozycji (stan, czas, obraz, strumienie, rozdziały), **„Dodaj zaznaczone do…”** kolekcji zwykłej albo playlisty |
| Kosz | `QuerySearchIndex…` (`state:FileNotFound`), `DeleteItemsFromDatabase`, `EmptyTrash` | pozycje bez pliku ze wszystkich rodzajów, usuwanie zaznaczonych z bazy, „Opróżnij kosz” – z potwierdzeniem |
| Kolekcje | zwykłe: `GetAllCollections`, `GetCollectionCards`, `CreateCollection`, `UpdateCollection`, `DeleteCollection`, `RemoveItemsFromCollection`; inteligentne: `GetAllSmartCollections`, `CreateSmartCollection`, `UpdateSmartCollection`, `DeleteSmartCollection`, `QuerySearchIndexAllItems`; wielokolekcje: `GetAllMultiCollections`, `GetMultiCollectionById`, `CreateMultiCollection`, `UpdateMultiCollection`, `DeleteMultiCollection`; powtórki: `GetPagedRerunCollections`, `GetRerunCollectionById`, `CreateRerunCollection`, `UpdateRerunCollection`, `DeleteRerunCollection` | **pełna edycja** w czterech zakładkach: zwykła z listą pozycji i usuwaniem zaznaczonych; inteligentna z zapytaniem i liczbą wyników („Sprawdź zapytanie”); wielokolekcja ze składnikami (zwykłe/inteligentne, „jako grupa”); powtórki (treść, kolejność premier i powtórek) |
| Playlisty | `GetAllPlaylistGroups`, `GetPlaylistsByPlaylistGroupId`, `GetPlaylistItems`, `CreatePlaylistGroup`, `DeletePlaylistGroup`, `CreatePlaylist`, `DeletePlaylist`, `ReplacePlaylistItems`, `PreviewPlaylistPlayout` | **pełna edycja**: grupy (załóż, usuń), playlisty w grupach, edytor pozycji (treść przez wybór treści, kolejność, ile / wszystkie, EPG; przesuwanie, kopiowanie), pojedyncze pliki z Przeglądarki, **podgląd playoutu** |
| Bloki i szablony | bloki: `GetAllBlocks`, `GetAllBlockGroups`, `CreateBlockGroup`, `DeleteBlockGroup`, `CreateBlock`, `CopyBlock`, `DeleteBlock`, `GetBlockItems`, `ReplaceBlockItems`, `PreviewBlockPlayout`; szablony dnia: `GetAllTemplates`, `GetAllTemplateGroups`, `CreateTemplateGroup`, `DeleteTemplateGroup`, `CreateTemplate`, `CopyTemplate`, `DeleteTemplate`, `GetTemplateItems`, `ReplaceTemplateItems` (+ znaki wodne, elementy graficzne) | **pełna edycja** w dwóch zakładkach: bloki w grupach (nazwa, długość co 5 min, koniec bloku, pozycje: treść, kolejność, EPG, znaki wodne, grafika; kopiuj; **podgląd wypełnienia bloku**); szablony dnia w grupach (bloki o godzinach startu na **osi doby**, nakładanie na czerwono; kopiuj) |
| Wystrój (deco) | deco: `GetAllDecoGroups`, `GetDecosByDecoGroupId`, `GetDecoById`, `CreateDecoGroup`, `DeleteDecoGroup`, `CreateDeco`, `UpdateDeco`, `DeleteDeco`; szablony deco: `GetAllDecoTemplateGroups`, `GetDecoTemplatesByDecoTemplateGroupId`, `CreateDecoTemplateGroup`, `DeleteDecoTemplateGroup`, `CreateDecoTemplate`, `DeleteDecoTemplate`, `GetDecoTemplateItems`, `ReplaceDecoTemplateItems` | **pełna edycja** w dwóch zakładkach: deco (znak wodny i grafika: dziedzicz / wyłącz / zastąp / scal, „także w wypełniaczu”; przerwy: playlista na starcie bloku; wypełniacz domyślny z przycinaniem; martwe powietrze); szablony deco (deco w przedziałach godzin na osi doby) |
| Grafika kanału | `GetAllGraphicsElements`, `RefreshGraphicsElements`; CG Playout: `/health`, `/etv/pages` | stan VizRS CG Playout (sesje elementu VizRS, nakładka ffmpeg, live ingest, przechwytywanie grafiki per kanał), **strony VizRS kanału**, podgląd anteny VizRS `/output` (`--vizrs-url`), elementy graficzne legacy i „Wczytaj pliki elementów”; reguły grafiki – opis, bez edycji (niżej) |
| Sloty na żywo | CG Playout: `/api/live/state`, `/api/live/shows`, `/api/live/channels/…` | karta kanału: **sygnał studia** (kodek, dźwięk, czas), NA ANTENIE / WSTRZYMANY / RAMÓWKA, bieżąca pozycja, najbliższa audycja LIVE; **■ ZDEJMIJ** (z potwierdzeniem) / **▶ WPUŚĆ**, „studio także poza audycjami”, przebudowa ramówki; **audycje LIVE** (nowa, zmiana, usunięcie z potwierdzeniem, skan biblioteki) ze stanem kolekcji w legacy i najbliższą emisją; zdarzenia; odświeżanie co 5 s |
| Ustawienia | `GetFFmpegSettings`, `UpdateFFmpegSettings`, `GetMpegTsScripts`, `GetPlayoutSettings`, `UpdatePlayoutSettings`, `GetXmltvSettings`, `UpdateXmltvSettings`, `GetLibraryRefreshInterval`, `UpdateLibraryRefreshInterval`, `GetHDHRTunerCount`, `UpdateHDHRTunerCount`, `GetHDHRUUID`, `GetLoggingSettings`, `UpdateLoggingSettings`, `GetUiSettings`, `UpdateUiSettings` (+ profile, znaki wodne, wypełniacze do list) | **pełna edycja ustawień legacy** w zakładkach jak Settings legacy: FFmpeg i strumienie, playouty, XMLTV, skaner i HDHomeRun, poziomy logów, web GUI legacy; zakładka „Panel i most” – konfiguracja panelu i stan mostu |
| Logi | `GetRecentLogEntries` | najnowsze wpisy logu legacy: próg poziomu, wyszukiwanie w treści, stronicowanie po 200, odświeżanie co 5 s |
| Diagnostyka | `GetAllHealthCheckResults` (też z `Refresh`), `GetTroubleshootingInfo`, `RefreshFFmpegCapabilities`, `EmptyTrash`, `DeleteOrphanedArtwork`, `DeleteOrphanedSubtitles`, `ReleaseMemory`, `GetAllChannels` + wszystkie z listy, zapytania wyboru treści | kontrole legacy („Sprawdź ponownie”), wersje i sprzęt (legacy, ffmpeg, procesor, karty grafiki), konserwacja z potwierdzeniami, test odtwarzania (odnośniki do strumienia HLS/TS kanału), konsola komend, wybór treści; **web GUI legacy dla widzów** (R10: wynik `/api/exposure` – zamknięte / widoczne / nie sprawdzono) i **pokrycie web GUI legacy** (lista kontrolna §8 z odnośnikami do ekranów) |

Na białej liście są też komendy bez ekranu, używane przez `tests/stack.sh seed` i testy oraz dostępne w konsoli: `CreateLocalLibrary`, `QueueLibraryScanByLibraryId`, `GetProgramScheduleById`, `GetPlayoutIdByChannelNumber`.

**Harmonogramy – szczegóły.** Listy wyboru pozycji (start, tryb, kolejność, maraton, reszta czasu…) są w `views/harmonogramy.js`, bo most nie opisuje wyliczeń typu zagnieżdżonego; ograniczenia jak w `ScheduleItemsEditor.razor` legacy: kolejność zależna od rodzaju treści, „wypełniaj grupami” tylko dla kilku/czasu i kolekcji, przy tasowaniu pozycji bez stałej godziny i trybu „wypełnij” (sprawdzane też przed zapisem). Wypełniacze w polach pozycji filtrowane po rodzaju (`FillerKind`). Pozycje wysyłane z `Index` = 1, 2, … w kolejności z tabeli; `GetProgramScheduleItems` nie zwraca ich posortowanych – panel sortuje po `Index`. Walidację robi legacy przy `ReplaceProgramScheduleItems` (np. „Tail Filler is required with tail mode Filler”, „A collection must not use multiple playback orders”) – komunikat zostaje po angielsku, z polskim wstępem; ustawienia harmonogramu są wtedy już zapisane, pozycje nie. Kolumna „Kanały”, uwaga w edytorze i potwierdzenie usunięcia: playouty klasyczne z `ScheduleName` = nazwa harmonogramu (nazwy są w legacy unikalne).

**Playouty – szczegóły.** Zakładanie: rodzaj → komenda `Create<Rodzaj>Playout` (legacy od razu buduje playout od nowa w tle). Klasyczny wymaga harmonogramu z pozycjami; sekwencyjny (YAML), skryptowy i zewnętrzny JSON – ścieżki pliku **w kontenerze legacy**, który musi już istnieć (legacy sprawdza; dla skryptu pierwsze słowo polecenia, reszta to argumenty). Blokowy startuje pusty – szablony dni i deco przypisuje się w jego kalendarzu tygodnia (niżej). Edycja: „Codziennie od nowa o” (`UpdatePlayout`, puste = wyłączone; legacy co dzień o tej godzinie robi `BuildPlayout` Reset), ścieżka pliku (`Update<Rodzaj>Playout`, tylko gdy zmieniona). **Harmonogramy zastępcze** (tylko klasyczny i nie w trybie „na żądanie”, jak w legacy): `GetPlayoutAlternateSchedules` zwraca też harmonogram główny jako ostatnią pozycję (`Id` = −1, najwyższy `Index`), a `ReplacePlayoutAlternateScheduleItems` zapisuje pozycję o najwyższym `Index` jako harmonogram główny – panel pokazuje go jako osobne pole „Harmonogram główny”, a przy zapisie dokleja na koniec listy. Legacy wybiera dla dnia pierwszą pasującą pozycję (wg kolejności); pusta lista dni/miesięcy nigdy nie pasuje, więc panel jej nie przyjmuje. Zapis tylko przy zmianie; legacy sam odświeża playout, gdy zmienia się harmonogram któregoś z już zbudowanych dni. Przebudowa: klasyczny i blokowy – „Przebuduj” (Refresh) i „Od nowa” (Reset), pozostałe tylko „Od nowa”. Konserwacja: „Wyczyść pozycje” (`ErasePlayoutItems`, blokowy/sekwencyjny/skryptowy – przyszłe pozycje, historia do teraz zostaje), „Wyczyść pozycje i historię” (`ErasePlayoutHistory`, wszystkie poza JSON), „Sprawdź nakładanie pozycji” (`CheckForOverlappingPlayoutItems` – zadanie w tle, wynik tylko w logach legacy). Licznik w pasku górnym: liczba playoutów, których ostatnia budowa się nie udała; komunikat błędu legacy jest w edytorze playoutu. `GetBlockPlayoutHistory` (podgląd historii bloku w edytorze playoutu blokowego legacy) – pominięte świadomie: historię czyści „Wyczyść pozycje i historię”.

**Bloki, szablony, deco i kalendarz tygodnia – szczegóły (R6).** Legacy nie ma `UpdateBlock` ani `UpdateTemplate`: nazwę, długość (wielokrotność 5 min, do 24 h – legacy sprawdza) i „koniec bloku” zapisuje `ReplaceBlockItems` razem z pozycjami, nazwę szablonu dnia – `ReplaceTemplateItems`. Nowy blok: `CreateBlock` (nazwa, grupa), zaraz potem `ReplaceBlockItems` z długością. Pozycje bloku jak w Block Editor legacy: kolekcja, serial, sezon, inteligentna, wyszukiwanie; kolejności zależne od rodzaju (z „losową rotacją”). Podgląd bloku (`PreviewBlockPlayout`) liczy się z pozycji wysłanych w komendzie – działa bez zapisu. Szablon dnia: pozycje to blok + godzina startu (`TimeSpan`); legacy odrzuca nakładające się bloki – panel zaznacza je wcześniej na czerwono na osi doby. Godziny szablonów i deco są w **strefie czasowej kontenera legacy** (`TimeZoneInfo.Local`; obraz testowy działa w UTC) – ustaw `TZ` kontenera legacy na strefę kanału. Deco: tryby jak w Deco Editor legacy (scal tylko dla znaku wodnego i grafiki; „także w wypełniaczu” tylko przy „zastąp”); treść przerw – tylko playlisty na starcie bloku (web GUI legacy 26.11 blokuje inne rodzaje i miejsca); wypełniacz domyślny i martwe powietrze – kolekcja, serial, sezon, artysta, wielokolekcja, inteligentna. Treść ustawiona przy innym trybie niż „zastąp” zostaje w legacy bez zmian. Szablon deco: deco od–do (koniec wcześniejszy niż start = przez północ). Kalendarz playoutu blokowego: `ReplacePlayoutTemplateItems` (pozycje `Id` 0 = nowe, `Index` wg tabeli) i `UpdateDefaultDeco`, zapis razem z playoutem, tylko przy zmianie; legacy wybiera szablon dnia tak jak harmonogram zastępczy (pierwsza pasująca pozycja), a podgląd tygodnia liczy to samo w przeglądarce (`when.js`). **Zmiany wchodzą na antenę dopiero po przebudowie** (legacy jej nie zleca) – panel o tym przypomina.

**Ustawienia, logi, konserwacja – szczegóły (R7).** Każda sekcja ustawień to para `Get…`/`Update…`; `Update…Settings` przyjmuje cały obiekt sekcji (np. `{"XmltvSettings": {...}}`), więc panel wysyła to, co przeczytał, z polami formularza na wierzchu. Most nie opisuje wyliczeń w obiektach zagnieżdżonych – listy wyboru (poziomy logów, strefa XMLTV, format HLS Direct) są w `views/system.js`. Skaner i HDHomeRun to osobne komendy (`UpdateLibraryRefreshInterval`, `UpdateHDHRTunerCount`), wysyłane tylko przy zmianie. Zakresy pól sprawdza panel tak jak web GUI legacy (dni playoutu i XMLTV ≥ 1, limit skryptu ≥ 10 s, segmenter bezczynny ≥ 30 s, segmenty na start ≥ 1, skan co 0–999999 godz., tunery ≥ 1). Poziomy logów działają od razu, bez restartu legacy. Logi: `GetRecentLogEntries` czyta najnowszy plik logu legacy (od najnowszych) i filtruje tylko tekstem (poziom albo treść); próg poziomu panel nakłada na pobraną stronę 200 wpisów. Konserwacja: zadania idą do kolejki w tle legacy (`queued`) – wynik i błędy tylko w logach. Test odtwarzania: odnośniki `--stream-url` + `/iptv/channel/{numer}.m3u8|.ts` (bez odtwarzacza w panelu – brak bibliotek z CDN). „Odśwież możliwości ffmpeg” (`RefreshFFmpegCapabilities`) – legacy ponownie sprawdza ffmpeg i akcelerację sprzętową. `GetTroubleshootingInfo` zwraca też zmienne środowiska kontenera i pełne profile – panel pokazuje tylko wersje i sprzęt.

**Źródła zewnętrzne – szczegóły i decyzje (R8, 2026-11-07).** Jellyfin i Emby mają w legacy po jednym serwerze (adres + klucz API w magazynie sekretów legacy). `Save{K}Secrets` najpierw łączy się z serwerem (`/System/Info`), a dopiero potem zapisuje i w tle pobiera listę bibliotek – błąd połączenia wraca do panelu (toast), nic nie jest zapisane. **Klucz API jest tylko do zapisu** (decyzja zachowawcza): serwer panelu go maskuje (§3), więc panel nie umie wysłać „starego” klucza – każda zmiana adresu wymaga ponownego wpisania klucza (tak samo jest bezpieczniej niż w web GUI legacy, które pokazuje klucz). „Rozłącz” (`Disconnect{K}`) usuwa serwer, biblioteki, pozycje i klucz – z potwierdzeniem. Biblioteki: legacy pobiera tylko zaznaczone („synchronizuj”); po zapisie wyboru panel – jak Libraries Editor legacy – od razu zleca synchronizację nowo włączonych (`Synchronize{K}Libraries` + `…LibraryByIdIfNeeded`). „Synchronizuj” przy bibliotece = `Synchronize{K}Libraries` + `ForceSynchronize{K}LibraryById` bez głębokiego skanu (dla Plex też `SynchronizePlexNetworks`), jak ekran Libraries legacy; głęboki skan pominięty (rzadko potrzebny, długo trwa). Wszystkie synchronizacje idą do kolejki skanera legacy (`queued`) – postęp i błędy w Logach. Web GUI legacy przed zleceniem bierze blokadę biblioteki w procesie (`IEntityLocker`, poza MediatR); panel jej nie bierze – drugie zlecenie tej samej biblioteki trafia po prostu do kolejki. Zamiany ścieżek (ścieżka na serwerze mediów → ścieżka w kontenerze legacy) zapisuje jeden `Update{K}PathReplacements` z całą listą (`Id` 0 = nowa). **Plex**: `StartPlexPinFlow` zwraca adres `https://app.plex.tv/auth#…` i sam kolejkuje `TryCompletePlexPinFlow` (legacy przez 2 minuty sprawdza PIN i po zalogowaniu dopisuje serwery konta) – panel otwiera ten adres w nowej karcie, pokazuje go też jako odnośnik (gdy przeglądarka zablokuje okno) i przez ~2 minuty odświeża listę serwerów. Token Plex zostaje w legacy. Czy konto jest zalogowane, legacy mówi tylko przez magazyn sekretów (poza MediatR) – panel pokazuje „Wyloguj” tylko, gdy są serwery. `TryCompletePlexPinFlow` (wewnętrzny PIN) nie jest na białej liście. **Strumienie zdalne** to w legacy pliki `.yml` (`url` albo `script`, `title`, `duration`, `is_live`, `fallback_query`…) w bibliotece lokalnej rodzaju „strumienie zdalne” – obsługują je już Biblioteki i Przeglądarka (R3); zgodnie z decyzją R2 panel nie zapisuje tych plików (krok ręczny: plik na wolumen `/config`, potem „Skanuj teraz”). Testy: e2e łączy legacy z atrapą serwera Jellyfin (mały serwer HTTP w `tests/e2e.cjs`, port 18096, legacy widzi go przez bramę sieci Dockera; inny adres: `E2E_FAKE_HOST`), Plex – adres PIN podstawiony w przeglądarce (bez plex.tv). Na prawdziwym Jellyfin/Emby/Plex nie sprawdzone (krok ręczny przed wdrożeniem: połączyć, zaznaczyć bibliotekę, sprawdzić pozycje w Przeglądarce).

**Grafika VizRS i sloty na żywo – szczegóły i decyzje (R9, 2026-11-07).** Panel rozmawia z VizRS CG Playout wyłącznie przez jego API (decyzja planu R9), przez pośrednika w serwerze (`/api/cg/…`, §3) – adres i token CG nie trafiają do przeglądarki. Spis API CG Playout, z którego panel korzysta: `/health`, `/etv/pages`, `/ingest/state` (pośrednik gotowy, UI używa stanu z `/api/live/state`, który zawiera to samo per kanał) i API Live Panelu CG (`/api/live/*`, wymaga `panel_token` w CG Playout). Decyzje: (1) **Reguły grafiki** (`on_clip`, `on_end`/`end_seconds`, `on_ad`/`ad_match`, `shows`, `channels` – kiedy która strona VizRS wchodzi, z polami `{title}`, `{next_title}`…) CG Playout trzyma w swoim `config.json` i **nie ma API do ich odczytu ani zapisu** – panel ich nie edytuje i nie obchodzi tego przez pliki (decyzja R9); ekran pokazuje, gdzie są. **Krok ręczny poza tym repo:** dopisać w VizRS CG Playout `GET/PUT /api/live/graphics` (reguły globalne i per kanał, walidacja jak przy starcie, zapis do pliku z zachowaniem reszty konfiguracji, przeładowanie bez restartu) – jako punkt planu CG Playout; potem edytor reguł w tym ekranie + wiersz w białej liście `cg_path`. Sesja R9 nie zmieniała repozytorium CG Playout (sesja automatu bez zmian w innych repo). (2) **Audycje na żywo jako pozycje ramówki**: CG Playout zakłada plik Remote Stream i Smart Collection `LIVE · tytuł` w legacy; pozycję harmonogramu (start Fixed, Strict, Smart Collection, One) operator dodaje w panelu w Harmonogramach (R1) – panel tego nie automatyzuje, bo CG zmienia legacy przez własne API, a zapis harmonogramu z dwóch miejsc groziłby nadpisaniem. (3) **Elementy graficzne legacy** (pliki YAML) – tylko lista i `RefreshGraphicsElements` (legacy ponownie czyta katalog elementów); element VizRS (`vizrs.yml`) zakłada CG Playout przy synchronizacji, więc zapis plików z panelu nie był potrzebny i ogólnego endpointu zapisu w moście nie dodano (decyzja R2 bez zmian). (4) **Podgląd `/output`** – jak na Antenie: ramka z `--vizrs-url` (adres VizRS widoczny dla przeglądarki operatora); CG Playout nie podaje swojego `output_url` przez API. Ustawienia Live Panelu CG (biblioteka Remote Streams, publiczny adres legacy) – raz w `/live` CG Playout, poza pośrednikiem. Testy: atrapa CG Playout w `tests/e2e.cjs` (127.0.0.1:18700; panel testowy startuje z `--cg-url`); na prawdziwym CG Playout nie sprawdzone – krok ręczny przed wdrożeniem: ustawić `panel_token` w CG i `VIZRS_LIVE_CG_URL`/`VIZRS_LIVE_CG_TOKEN` w panelu, otworzyć Grafikę kanału (stan „połączony”, strony VizRS) i Sloty na żywo (sygnał z OBS, ZDEJMIJ/WPUŚĆ, audycja LIVE).

**Pliki YAML, skrypty i JSON – decyzja (R2, 2026-11-06): panel ich nie edytuje.** Operator kładzie pliki na wolumen konfiguracji legacy (`ETV_CONFIG` → `/config` w kontenerze; proponowany katalog `/config/schedules/`, skrypty `/config/scripts/`) i wpisuje w panelu ścieżkę w kontenerze. Zapis plików z panelu wymagałby nowego kodu C# w moście (zapis pliku w kontenerze legacy – poza ogólnym dyspozytorem) albo wspólnego wolumenu z panelem; oba rozwiązania otwierają zapis plików przez sieć, a edytor YAML bez bibliotek nie daje walidacji. Wracamy do tego, jeśli R9 (elementy graficzne legacy w YAML) będzie potrzebować zapisu plików – wtedy jeden ogólny endpoint mostu ograniczony do jednego katalogu (np. `/config/vizrs/`), z limitem rozmiaru, wspólny dla playoutów i grafiki.

**Media – szczegóły.** Ścieżki bibliotek to ścieżki **w kontenerze legacy** (np. `/config/media/…` na wolumenie konfiguracji albo zamontowany katalog) – panel to mówi przy polu i wymaga ścieżki bezwzględnej. Edycja biblioteki to jeden `UpdateLocalLibrary` z całą listą ścieżek (`Id` 0 = nowa); usunięta ścieżka znika z legacy razem ze swoimi pozycjami (pliki zostają), dlatego ✕ przy ścieżce z pozycjami pyta o potwierdzenie. Rodzaju biblioteki legacy nie pozwala zmienić. Przeniesienie ścieżki (`MoveLocalLibraryPath`) działa od razu, tylko między bibliotekami tego samego rodzaju. Postępu skanu legacy nie udostępnia zapytaniem (idzie zdarzeniami Blazora) – po „Skanuj teraz” panel przez pół minuty odświeża liczby pozycji. Wyszukiwarka dokleja `type:<rodzaj> AND (…)` jak legacy; liczby na zakładkach z `QuerySearchIndexAllItems` (pusty tekst = `*`). Kosz to wyszukiwanie `state:FileNotFound` (jak ekran Trash legacy). `RemoveMediaItems` (w planie R3) jest wewnętrzną komendą indeksu wyszukiwania – nie ma jej na białej liście; `UpdateLocalLibraryPath` to typ ścieżki w `UpdateLocalLibrary`, nie komenda. Czas wyświetlania folderów obrazów (`GetImageFolders`, `UpdateImageFolderDuration`) i skan pojedynczego serialu (`QueueShowScanByLibraryId`) są na liście, bez UI (R4 ich nie potrzebował – do dołożenia przy Bibliotekach). Zaznaczone pozycje bieżącej zakładki trafiają do kolekcji zwykłej albo playlisty („Dodaj zaznaczone do…”; zaznaczenie znika po zmianie zakładki lub zapytania).

**Kolekcje i playlisty – szczegóły (R4).** Pozycje kolekcji zwykłej: `GetCollectionCards` (w planie „GetCollectionItems” – takiej komendy nie ma), karty wszystkich rodzajów w jednej tabeli; dodaje się je w Przeglądarce (`AddItemsToCollection` z listą id jednego rodzaju – pojedyncze `Add{Movie,Show,…}ToCollection` są zbędne i nie są na liście). Własna kolejność (`UpdateCollectionCustomOrder`) – legacy pozwala ją tylko w kolekcji z samych filmów; nie wdrożone. Inteligentna: liczba wyników to suma list z `QuerySearchIndexAllItems` dla zapytania. Wielokolekcja: legacy trzyma składniki zwykłe i inteligentne osobno (`Items`, `SmartItems`), bez wspólnej kolejności; składnik „jako grupa” gra chronologicznie (jak w Multi Collection Editor legacy, panel wysyła `PlaybackOrder` = `Chronological`); `GetAllMultiCollections` nie zawsze zwraca składniki – edytor czyta `GetMultiCollectionById`. Powtórki: lista z `GetPagedRerunCollections` (bez nazw treści), edytor z `GetRerunCollectionById`; kolejności jak w Rerun Collection Editor (wielokolekcja – tylko tasowanie). Playlista: nazwę i pozycje zapisuje jeden `ReplacePlaylistItems` (`Index` 0, 1, … wg tabeli; „wszystkie” wysyła `Count` = `null`); pojedyncze pliki (film, inne wideo, utwór…) dodaje Przeglądarka (`AddItemsToPlaylist`), w edytorze można je przesuwać i ustawiać. Playlist systemowych (grupa „Trakt Lists”) legacy nie pozwala edytować. Usunięcie grupy usuwa jej playlisty. Trakt (`AddTraktList`, `DeleteTraktList`) – nie wdrożone (opcjonalne, wymaga klucza API Trakt).

**Profile, znaki wodne, wypełniacze – szczegóły (R5).** Profil: panel pokazuje pola silnika Next; pola tylko starego silnika legacy (wątki, tryb pasów, profil i preset H.264, B-klatki, wyświetlacz VAAPI, dodatkowe ramki QSV, normalizacja kolorów) zostają bez zmian – przy nowym profilu z `NewFFmpegProfile`. Informacja o sprzęcie to lista z `GetSupportedHardwareAccelerationKinds` (co zgłasza ffmpeg legacy); dokładniejszy stan wg Next (`GetNextProbe`, `RefreshNextProbe`, jak w nowszym FFmpeg Editor legacy) jest dopiero w wydaniach nowszych niż 26.11.6 – dopisać po aktualizacji legacy. Akcelerację V4L2 panel pomija (legacy jej nie włącza). Znak wodny: obraz zapisany w legacy panel pokazuje przez `--stream-url` (`/artwork/watermarks/…`); bez tej opcji widać tylko świeżo wgrany plik. Makieta kadru jest przybliżona (rozmiar oryginalny liczony względem 1920 px). Usunięcie znaku: legacy odpina go od kanałów. Wypełniacz: jak w legacy – miejsca nie da się zmienić po założeniu, ogon i zapasowy nie mają trybu ani playlisty, playlista wymusza tryb „liczba”, wartości spoza trybu są wysyłane jako `null`. Wgrany, a niezapisany obraz zostaje w pamięci obrazów legacy; sprząta go „Usuń osierocone grafiki” (Diagnostyka → Konserwacja; `DeleteOrphanedArtwork` usuwa z katalogu pamięci obrazów pliki, do których nie odwołuje się żadna pozycja ani znak wodny).

## 5. Znane ograniczenia (legacy v26.11.6)

- `AddProgramScheduleItem` zapisuje pozycję, ale legacy rzuca wyjątek przy budowaniu odpowiedzi (`Mapper.ProjectToViewModel`, niezaładowane znaki wodne pozycji). Nie ma jej na białej liście; panel używa `ReplaceProgramScheduleItems`, jak UI legacy.
- `ReplaceProgramScheduleItems` zwraca leniwą projekcję, której nie da się zserializować – most zgłasza sukces z ostrzeżeniem (`warning`); panel traktuje to jako sukces i przeładowuje pozycje.
- `DeleteProgramSchedule` usuwa kaskadowo playouty, które używają harmonogramu (klucz obcy `OnDelete(Cascade)` w legacy) – panel wymienia te kanały w potwierdzeniu usunięcia.
- `ReplacePlayoutAlternateScheduleItems` z pustą listą legacy odrzuca („must not be empty”) – panel zawsze wysyła co najmniej harmonogram główny.
- Część wyników legacy to encje bazy (np. `BuildStatus` w `GetPagedPlayouts`) – most serializuje je z pominięciem cykli; mogą być duże.
- Web GUI legacy i strumienie są na tym samym porcie 8409 – legacy nie umie ich rozdzielić. Rozdziela proxy przed legacy (R10, §8); bez proxy web GUI jest dostępne dla każdego, kto widzi port.
- (v26.12.0) `ReplacePlayoutTemplateItems`, `UpdateDefaultDeco`, `UpdateDeco`, `DeleteWatermark`… same zlecają synchronizację playoutów Next (`QueueSyncNextPlayouts`) – to odświeża serializację, nie przebudowuje playoutu; „Przebuduj” dalej potrzebne po zmianie kalendarza.
- `PreviewPlaylistPlayout` buduje podgląd z pozycji z bazy (handler ustawia `PlaylistId`, a budowniczy playoutu czyta playlistę po id), nie z pozycji wysłanych w komendzie – podgląd niezapisanej playlisty daje „has no valid items”. Panel przed podglądem zapisuje pozycje („Zapisz i pokaż podgląd”).
- Zagnieżdżone obiekty w komendach powtórek (`CreateRerunCollection`, `UpdateRerunCollection`: `MediaCollectionViewModel`, `MultiCollectionViewModel`…) most deserializuje tylko z kompletem pól konstruktora – panel wysyła pełne obiekty z pustymi nazwami (legacy czyta z nich tylko `Id`).
- `GetDecosByDecoGroupId` zwraca deco bez treści (kolekcje wypełniacza i martwego powietrza, playlisty przerw = `null`, tylko id w bazie). Zapis `UpdateDeco` na podstawie tej listy skasowałby treść – edytor deco czyta i zapisuje na podstawie `GetDecoById` (test e2e pilnuje ponownego zapisu).
- `ReplacePlayoutTemplateItems` i `UpdateDefaultDeco` nie przebudowują playoutu – trzeba „Przebuduj” albo „Od nowa”.
- Komendy `Update…Settings` nie sprawdzają zakresów (np. `UpdateXmltvSettings` przyjmuje 0 dni) – robi to tylko web GUI legacy, więc panel sprawdza sam przed zapisem. Wyjątek: dni XMLTV większe niż dni playoutu legacy odrzuca („cannot be greater than Playout days to build”).
- `RebuildSearchIndex` legacy uruchamia tylko przy starcie; wysłana przez most trafia do kolejki skanera, która jej nie obsługuje („Unsupported request type”) – nie ma jej na białej liście. Przebudowa indeksu: restart kontenera legacy.
- Test odtwarzania legacy (`PrepareTroubleshootingPlayback` → `StartTroubleshootingPlayback`) przekazuje między krokami wewnętrzne obiekty (`PlayoutItemResult`, proces ffmpeg) i pokazuje wynik w odtwarzaczu Blazora – przez ogólny dyspozytor się nie da. Panel daje odnośniki do strumienia kanału.
- `GetAllLanguageCodes` w obrazie legacy zwraca tylko `und` (brak danych kultur .NET) – preferowany język dźwięku wpisuje się jako kod ISO 639-2.
- Logowanie do Plex: `StartPlexPinFlow` działa przez most (adres app.plex.tv), dokończenie logowania prawdziwym kontem nie sprawdzone w testach. Stan „zalogowany” i blokady bibliotek legacy trzyma poza MediatR (`IPlexSecretStore`, `IEntityLocker`) – panel ich nie widzi.
- `Save{Jellyfin,Emby}Secrets` i `Get…Secrets` operują jednym serwerem na rodzaj (tak działa legacy); kilku serwerów Jellyfin nie da się podłączyć.

## 6. Aktualizacja legacy

1. Na stosie testowym, z osobnym katalogiem danych (nowsze legacy migruje bazę i starsze już jej nie otworzy):
   `export VIZRS_LIVE_TEST_DIR=/tmp/vizrs-live-test-<wersja> LEGACY_IMAGE=ghcr.io/ersatztv/legacy:<wersja>`
2. `tests/stack.sh up` – buduje obraz mostu na tej wersji, smoke mostu i proxy; smoke sam sprawdza, że `commandsMissing` z `GET /vizrs-bridge/health` jest puste.
3. `tests/stack.sh seed && tests/stack.sh test` – ramówka od zera wyłącznie przez panel i e2e.
4. Przejrzyj zmiany komend: `git diff v<stara>..v<nowa> -- ErsatzTV.Application` w źródle legacy (zmienione rekordy `Commands/*.cs`, `Queries/*.cs` = zmienione parametry; nowe pliki = nowe możliwości). Zmiany zachowania opisz w §5.
5. Dopiero potem: kopia `etv-config`, zmiana `LEGACY_IMAGE` w `.env` produkcji, `docker compose up -d --build`.

Wczesne ostrzeżenie: CI `legacy-latest.yml` co tydzień robi kroki 1–3 na `ghcr.io/ersatztv/legacy:latest`.

**Przejście 26.11.6 → 26.12.0 (R10, 2026-11-07):** smoke, `commandsMissing = []`, seed na świeżej bazie i całe e2e – zielone bez zmian w moście i panelu. Rekordy komend bez zmian; nowe: `GetNextProbe`, `RefreshNextProbe`, `GetNextDescribe` (stan silnika Next – do dopisania w Profilach, zob. R5 w §4; nie na białej liście). Kilka komend deco/szablonów/znaków sama zleca synchronizację playoutów Next (§5). Domyślny `LEGACY_IMAGE` zostaje `latest` – przypięcie wersji w `.env.example` robi wydanie 1.0 (R11).

## 7. Testy

| Test | Polecenie |
|---|---|
| serwer (Rust) | `cd server && cargo clippy --all-targets -- -D warnings && cargo test` |
| most + panel (smoke) | `tests/stack.sh up` |
| ramówka przez panel | `tests/stack.sh seed` (drugi raz nic nie dubluje; od zera: `tests/stack.sh reset`) |
| e2e UI | `tests/stack.sh test` (Playwright: `PLAYWRIGHT_DIR` albo `tests/local.env`; zrzuty nowych widoków: `E2E_SHOTS=<katalog poza repo>`) |
| proxy (smoke) | w `tests/stack.sh up`: proxy na 127.0.0.1:18410 (`docker/proxy.Caddyfile`, sieć `vizrs-live-test-net`): `/`, `/channels`, `/api/…`, `/vizrs-bridge/…`, `POST` = 403; M3U, XMLTV, `discover.json` = 200. Panel testowy podaje widzom adres proxy (`--stream-url http://127.0.0.1:18410`) |
| **bramka przed commitem** | `tests/gate.sh` – wszystko powyżej po kolei |
| CI | `.github/workflows/ci.yml` (push, PR): serwer, obraz panelu, `tests/gate.sh` z Playwright 1.58.2; `legacy-latest.yml` (poniedziałek 04:17 UTC i ręcznie): stos na `ghcr.io/ersatztv/legacy:latest` + seed + e2e |

Plan rozbudowy realizuje automat `scripts/plan.sh` (opis w `docs/PLAN-rozbudowy.md`, „Jak pracować”).

## 8. Zamknięcie web GUI legacy (R10)

Operatorzy pracują wyłącznie w panelu. Legacy nie ma portu na zewnątrz (`expose`, nie `ports` w `compose.yml`); panel i most rozmawiają w sieci wewnętrznej Dockera (`http://ersatztv:8409`). Na zewnątrz port 8409 wystawia **proxy** (Caddy, `docker/proxy.Caddyfile`):

| Na zewnątrz (tylko `GET`/`HEAD`) | Po co |
|---|---|
| `/iptv/*` | strumienie (HLS, TS, HLS Direct, segmenty sesji), `channels.m3u`, `xmltv.xml`, logo kanałów i okładki EPG |
| `/artwork/*` | obrazy legacy tylko do odczytu – podgląd znaków wodnych i logo w panelu (przeglądarka operatora ładuje je spod `--stream-url`) |
| `/discover.json`, `/device.xml`, `/lineup.json`, `/lineup_status.json` | HDHomeRun (Plex, Jellyfin, Emby jako tuner) |
| wszystko inne, też `POST` do powyższych | **403**: web GUI (Blazor), `/api/*` legacy, `/vizrs-bridge/*` |

**Decyzje (2026-11-07, sesja automatu – zachowawczo):**
- **Caddy, nie nginx** – jeden krótki plik, dopasowanie ścieżek i metod bez warunków `if`, `flush_interval -1` dla strumieni; obraz `caddy:2.10-alpine` (do zmiany `PROXY_IMAGE`). TLS proxy nie robi (`auto_https off`) – jak dotąd port 8409 był zwykłym HTTP; certyfikat to osobna decyzja wdrożenia (R11).
- **`/artwork/*` otwarte** – to tylko obrazy (plakaty, miniatury, znaki wodne, adresy z identyfikatorem/skrótem), a panel z nich korzysta; zamknięcie zepsułoby podgląd w Znakach wodnych. `/api/*` legacy (np. `/api/channels`, `/api/sessions`) zamknięte – nic z zewnątrz ich nie potrzebuje.
- **HDHomeRun otwarty** – to funkcja dla widzów (tuner), nie GUI.
- Panel nie dostał osobnego adresu „wewnętrznego” legacy do obrazów: `--stream-url` = adres proxy dla widzów.
- **Sprawdzanie w panelu** (Diagnostyka → „Web GUI legacy dla widzów”): serwer panelu pyta adres `--stream-url` o `/`, `/channels`, `/vizrs-bridge/health` (oczekiwane 403/404) i `/iptv/channels.m3u` (200). Sprawdza ze swojej sieci – gdy `--stream-url` to `localhost` albo adres publiczny niewidoczny z kontenera, wynik to „nie sprawdzono”, a sprawdzić trzeba z zewnątrz (`curl -I http://<serwer>:8409/` → 403).

**Pierwsze uruchomienie legacy bez GUI.** Legacy nie wymaga konfiguracji startowej: na pustym `/config` tworzy bazę i domyślny profil kodowania (id 1), a całą resztę (biblioteka, skan, kolekcja, harmonogram, kanał, playout) robi `tests/stack.sh seed` wyłącznie komendami przez panel – sprawdzone na świeżej bazie v26.11.6 i v26.12.0. Jedyne, czego trzeba przy pierwszym starcie: `xmltv.xml` pojawia się kilka–kilkanaście sekund po starcie (wcześniej legacy zwraca 500 – smoke czeka).

**Lista kontrolna pokrycia** (menu `ErsatzTV/Shared/MainLayout.razor`; ta sama lista w UI: Diagnostyka → „Pokrycie web GUI legacy”, `COVERAGE` w `server/web/views/system.js`; e2e pilnuje, że każdy wiersz ma ekran albo uzasadnione pominięcie):

| Legacy | Panel |
|---|---|
| Channels | Kanały |
| FFmpeg Profiles | Profile kodowania |
| Watermarks | Znaki wodne |
| Media Sources → Local / Libraries | Biblioteki |
| Media Sources → Emby / Jellyfin / Plex | Źródła zewnętrzne |
| Media → Trash | Kosz |
| Media → TV Shows, Movies, Music, Other Videos, Songs, Images, Remote Streams | Przeglądarka |
| Lists → Collections, Smart, Multi, Rerun | Kolekcje |
| Lists → Playlists | Playlisty |
| Lists → Trakt Lists | **pominięte**: wymaga klucza API Trakt; listy założone wcześniej widać jako playlisty systemowe (tylko odczyt) |
| Lists → Filler Presets | Wypełniacze |
| Scheduling → Schedules / Blocks, Templates / Decos, Deco Templates / Playouts | Harmonogramy / Bloki i szablony / Wystrój (deco) / Playouty |
| Settings → FFmpeg, Logging, HDHomeRun, Scanner, Playout, XMLTV, UI | Ustawienia (UI legacy – tylko wygląd web GUI, bez znaczenia po zamknięciu) |
| Support → Health Checks / Logs | Diagnostyka / Logi |
| Support → Troubleshooting | **częściowo**: wersje i sprzęt, odnośniki do strumienia; test pliku w odtwarzaczu Blazora – nie (§5) |
| pasek: M3U, XMLTV | odnośniki w Kanałach, Na antenie, Przewodniku EPG |
| pasek: Docs, pomoc, GitHub | **pominięte**: strony projektu ErsatzTV |

**Kroki ręczne (poza repozytorium / poza sesją automatu):**
1. Produkcja: po aktualizacji `compose.yml` legacy traci port 8409, a dostaje go proxy – `docker compose up -d` przestawia to bez zmian w `etv-config`. Jeśli coś (np. Plex/Jellyfin jako tuner HDHomeRun, odtwarzacze) korzystało dotąd z innych ścieżek niż powyżej, sprawdzić po przejściu (`curl -I`).
2. Administrator, który wyjątkowo potrzebuje web GUI legacy: tunel SSH do sieci Dockera albo tymczasowo `ports: ["127.0.0.1:8410:8409"]` przy usłudze `ersatztv` – nie dla operatorów.
3. CI zacznie działać po wypchnięciu `.github/workflows/` na GitHub (sesja automatu nie robi push); w ustawieniach repozytorium Actions muszą być włączone. `legacy-latest.yml` nie wymaga sekretów (obraz legacy jest publiczny).


## 9. Wydanie 1.0 (R11)

### Obrazy i wersje

| Obraz | Tag | Z czego |
|---|---|---|
| `ghcr.io/sdorpl/vizrs-live` | `1.0.0` | `docker/live.Dockerfile` |
| `ghcr.io/sdorpl/vizrs-live-legacy` | `1.0.0-legacy26.12.0` | `docker/legacy-bridge.Dockerfile` na `ghcr.io/ersatztv/legacy:v26.12.0` |
| `caddy` (proxy) | `2.10.2-alpine` | obraz oficjalny |

Wszystkie przypięte w `.env.example` (`LIVE_IMAGE`, `LIVE_LEGACY_IMAGE`, `LEGACY_IMAGE`, `PROXY_IMAGE`) i jako domyślne w `compose.yml`; domyślny `LEGACY_IMAGE` w `docker/legacy-bridge.Dockerfile` też `v26.12.0` (stos testowy buduje się więc na wersji wydania; inna: `LEGACY_IMAGE=… tests/stack.sh up`). Publikację robi `.github/workflows/release.yml` po tagu `v<wersja>` (sprawdza zgodność tagu z `Cargo.toml`, przechodzi `tests/gate.sh`, buduje i wypycha oba obrazy z `GITHUB_TOKEN`).

**Decyzje (2026-11-07, sesja automatu – zachowawczo):**
- Tag obrazu legacy niesie obie wersje (`<panel>-legacy<legacy>`) – most jest sprawdzony z konkretną wersją legacy, więc nazwa mówi, co jest w środku; nowa wersja legacy = nowy tag bez nowego wydania panelu.
- Brak tagu `latest` na ghcr – produkcja zawsze na przypiętej wersji.
- TLS: panel i proxy zostają na HTTP (decyzja R10 podtrzymana); w RUNBOOK zalecenie LAN/VPN albo zewnętrzne proxy TLS. Panel nie robi TLS sam (serwer bez zależności).

**Kroki ręczne (sesja automatu niczego nie publikuje):**
1. `git push origin main` i `git tag v1.0.0 && git push origin v1.0.0` – uruchamia `release.yml`.
2. Po pierwszej publikacji: pakiety `vizrs-live` i `vizrs-live-legacy` na GitHub ustawić jako publiczne (albo `docker login ghcr.io` na serwerze produkcyjnym).
3. Produkcja: `.env` wg `.env.example` (nowe zmienne `LIVE_IMAGE`, `LIVE_LEGACY_IMAGE`), kopia `etv-config`, `docker compose pull && docker compose up -d` (RUNBOOK §2–4).

### Przegląd bezpieczeństwa

| Obszar | Stan | Zmiana w 1.0 |
|---|---|---|
| tokeny | panel i most: min. 16 znaków, porównanie w stałym czasie (`eq_ct`); most bez tokenu = 503; panel poza 127.0.0.1 nie startuje bez tokenu; token CG zostaje w serwerze | **limit logowań** 10/min (429), wpis w dzienniku przy złym tokenie |
| sesja | ciasteczko `HttpOnly`, `SameSite=Strict`, 30 dni; wartość = token panelu (wymiana tokenu unieważnia wszystkie sesje – RUNBOOK §6) | `Secure` za proxy TLS |
| CSRF | `X-VizRS-Live: 1` na każde żądanie zmieniające (też logowanie, `PUT`, `DELETE`), `SameSite=Strict` | e2e na osobnym panelu z tokenem |
| CSP / XSS | tekst do DOM tylko `textContent`, brak `innerHTML`/`eval` w `server/web/` (sprawdzone `grep`), bez inline | CSP na **wszystkich** odpowiedziach (wcześniej tylko wbudowane UI), dodane `object-src`, `base-uri`, `form-action`, `frame-ancestors` |
| limity | nagłówki 16 KB, treść 1 MB (wgrywanie 10 MB, tylko PNG/JPEG/GIF/WebP z sygnaturą), 64 połączenia, czas 15 s, bez `Transfer-Encoding` | – |
| most | biała lista komend, 403 spoza niej; bez `Get…ConnectionParameters`, `TryCompletePlexPinFlow`, `RebuildSearchIndex`; most tylko w sieci Dockera, przez proxy 403 | – |
| sekrety (R8) | maskowanie `…apikey/token/password/secret` w odpowiedziach komend i CG | – |
| proxy (R10) | na zewnątrz tylko `GET/HEAD` strumieni, `/artwork/*`, HDHomeRun | obraz przypięty `2.10.2-alpine` |
| obrazy | panel: `scratch`, użytkownik 10001, statyczna binarka; legacy: obraz upstream bez zmian + 2 pliki | wersje przypięte |

Świadomie pozostawione (ryzyko przyjęte): `img-src`/`frame-src` dopuszczają `http:`/`https:` (podgląd obrazów legacy spod `--stream-url` i `/output` VizRS pod adresem z konfiguracji); ciasteczko = token (brak magazynu sesji w serwerze bez stanu); limit logowań wspólny – atakujący może przez minutę blokować logowanie (operator z ważnym ciasteczkiem pracuje dalej); legacy w kontenerze działa jako root (obraz upstream – bez zmian legacy).

# Plan rozwoju VizRS Live (PLAN-mcr) – braki wobec legacy, wzorzec Viz Channel Branding, legacy czy Next

> **Stan:** gałąź `next-v`, wydanie testowe 1.3.0-test.1 (2026-11-10): K1–K11, K18 zrobione; K12–K14, K17 – panel gotowy, czeka na VizRS CG Playout; K15–K16 – kontrakt; Q1 ręcznie; decyzja legacy/Next: **A – legacy** (§6). Stan prac: [../STATUS.md](../STATUS.md), znane braki: [../LUKI.md](../LUKI.md), opis działania: [../DOKUMENTACJA.md](../DOKUMENTACJA.md).
>
> **Jedyny dokument planów rozwoju VizRS Live** (decyzja użytkownika 2026-11-09): nowe plany i punkty panelu dopisuj tutaj – nowy punkt w tabeli §4 (w miejscu kolejki, które mu odpowiada) i opis w §5, nowe analizy jako kolejne sekcje – zamiast zakładać nowe pliki `PLAN-*.md`. Zakończone plany [PLAN-rozbudowy.md](PLAN-rozbudowy.md) i [PLAN-makieta.md](PLAN-makieta.md) zostają jako archiwum.
>
> Treść: §1 skąd wiadomo, §2 czego jeszcze brakuje wobec web GUI legacy, §3 czego uczy Vizrt (tabela A–J), §4 jeden przebieg (luki + plan), §5 punkty, §6 legacy czy Next – decyzja i analiza.

## 1. Źródła i ograniczenia rozpoznania

- **Web GUI legacy (port 8409).** Rozpoznanie z kodu, bez działającego GUI: GUI jest zamknięte za proxy (DOKUMENTACJA §8), a sesja, w której powstał plan, nie miała dostępu do lokalnego stosu. Źródło: `ErsatzTV/legacy` na `main`, commit `e51ac60` z 2026-11-09 (po v26.12.0), strony `ErsatzTV/Pages/**/*.razor`, menu `Shared/MainLayout.razor`. Porównanie: 259 rekordów komend i zapytań w `ErsatzTV.Application` z białą listą `bridge/commands.txt` (241 wierszy) i listą pokrycia (DOKUMENTACJA §8).
- **ErsatzTV Next.** `ErsatzTV/next` commit `c5cb065` (v0.2.5, 2026-11-06): README, `CHANGELOG.md`, `schema/*.json`, trasy `crates/ersatztv`. Wcześniejsze rozpoznanie (2026-11-06): `../../../VizRS CG System/docs/plany/PLAN-vizrs-live.md` §2.
- **Vizrt.** Kanałową grafikę i playout Vizrt robi dziś **Viz Channel Branding** (5.x, następca **Viz Multichannel** 4.x); studio – Viz Mosart (poza zakresem). Opis pochodzi z wyników wyszukiwarki i stron produktu, **nie z pełnej lektury przewodników**. Prośba o dodanie `docs.vizrt.com` i `documentation.vizrt.com` do dozwolonych hostów sesji została odrzucona (2026-11-09). Do uzupełnienia, gdy hosty będą dozwolone: przewodnik VCB 5.5/5.6 (rozdziały User Interface, Playlists, Channel Deck, Integrations Hub REST v2), Multichannel 4.2 (Master Control Workflow, Import/Export Settings).
  Strony: [VCB – przegląd](https://www.vizrt.com/product-updates/viz-channel-branding-overview/), [VCB 5.4](https://www.vizrt.com/product-updates/viz-channel-branding/viz-channel-branding-5-4/), [release notes 5.4](https://docs.vizrt.com/viz-channelbranding-rn/5.4/Viz_Channel_Branding_Release_Notes.html), [5.5 (PDF)](https://docs.vizrt.com/viz-channelbranding-rn-5.5.pdf), [User Interface 5.5](https://docs.vizrt.com/viz-channelbranding-guide/5.5/User_Interface.html), [Basic Settings 5.0](https://documentation.vizrt.com/viz-channelbranding-guide/5.0/Basic_Settings.html), [Playlists 5.3](https://docs.vizrt.com/viz-channelbranding-guide/5.3/Playlists.html), [Clip Bank 5.2](https://docs.vizrt.com/viz-channelbranding-guide/5.2/Clip_Bank.html), [Multichannel 4.2 – Working with Playlists](https://docs.vizrt.com/viz-multichannel-guide/4.2/Working_with_Playlists.html), [Import/Export Settings](https://docs.vizrt.com/viz-multichannel-guide/4.2/Import___Export_Settings.html), [Master Control Workflow](https://docs.vizrt.com/viz-multichannel-guide/4.2/Master_Control_Workflow.html).

## 2. Web GUI legacy – co jeszcze nie ma odpowiednika

Pokrycie jest prawie pełne (DOKUMENTACJA §8). Nowe braki, których nie było w LUKI (dopisane jako #23–#27):

| Element legacy | Komendy | Uwagi |
|---|---|---|
| **Edit Channel Numbers** (`/channels/numbers`, przycisk na liście kanałów) – zmiana numeracji wszystkich kanałów naraz | `GetAllChannelsForSort`, `UpdateChannelNumbers` | wiersze w `commands.txt` + UI w `views/kanaly.js` → **K3** |
| **Własne rozdzielczości** (Settings → FFmpeg) | `CreateCustomResolution`, `DeleteCustomResolution` | → **K4** |
| **Walidator YAML harmonogramu sekwencyjnego** (`/system/troubleshooting/sequential-schedule`) | `ISequentialScheduleValidator` – poza MediatR | dyspozytor go nie wywoła; razem z LUKI #14 (pliki YAML) |
| **Diagnostyka playoutu blokowego** (`/system/troubleshooting/block-playout`) | `GetAllBlockPlayouts`, `DecodePlayoutHistory` | obok LUKI #13 → **K7** |
| **Wyodrębnianie napisów osadzonych** | `ExtractEmbeddedSubtitles`, `ExtractEmbeddedShowSubtitles` | zadanie w tle → **K8** |
| **Paczka diagnostyczna** (Troubleshooting → Upload Results) | `ArchiveTroubleshootingResults`, `ArchiveMediaSample` | przydatna przy zgłoszeniu awarii (RUNBOOK) → **K5** |
| **Stan silnika Next** | `GetNextProbe`, `RefreshNextProbe`, `GetNextDescribe`, `GetNextVersion` | już LUKI #11 → **K5** |

Świadomie pominięte (bez zmian): Trakt (LUKI #16), Docs/GitHub, UI settings, `RebuildSearchIndex`, `TryCompletePlexPinFlow`, `Get{Jellyfin,Emby}ConnectionParameters`.

## 3. Wzorzec Vizrt – co z niego brać

Model Viz Channel Branding (VCB) i Multichannel, w skrócie:

- **Playlista kanału** = **zdarzenia pierwotne** (programy z ramówki) i przypięte do nich **zdarzenia wtórne** (strony grafiki i akcje) z **przesunięciem** (offset) względem programu i czasem trwania. Playlista dobowa albo ciągła.
- **Import ramówki z systemu traffic**: CSV/TXT, XML, Excel, Harris ADC‑100, Omnibus; folder obserwowany, pliki oznaczane `.done`/`.fail`, okno importu, „pełna aktualizacja” (scalenie bez kasowania) albo „tylko czasy”; od 5.x także REST (Integrations Hub v2).
- **Automatyczna kontrola playlisty**: nakładające się animacje, niezgodności z ramówką, inne odstępstwa; zdarzenie z błędem na czerwono z opisem w podpowiedzi.
- **Run Status**: stan wykonania każdego zdarzenia, opisany przez Media Sequencer.
- **Channel Deck**: jeden widok wszystkich kanałów – obraz (NDI), co gra teraz, co zaplanowano, alarmy (brak reguły, brak metadanych do szablonu).
- **Page pool i Quick Take**: strony gotowe do ręcznego wprowadzenia; **Take / Continue / Take Out** przy automatyce.
- **Clip Bank**: wcześniej przygotowane zdarzenia LIVE do szybkiego wstawienia w bieżącą playlistę.
- **Dane w stronach**: pola z bazy, pliku, playlisty; reguły aktywacji (pozycja aktywna tylko, gdy dane są).
- **Kampanie** (5.4): zatwierdzanie stron (Planning → MCR), czas życia (TTL) stron kampanii.
- **Wyzwalanie**: czasowe przez Media Sequencer albo z automatyki (TCP/IP, Intelligent Interface, VDCP, GPI, REST).

Odpowiedniki w rodzinie VizRS: playlista = ramówka legacy (playout), zdarzenia wtórne = reguły grafiki CG Playout (`/api/live/graphics`: start pozycji ± s, przed końcem, przerwa reklamowa, slot na żywo), Media Sequencer = CG Playout + VizRS (TCP 6100), Clip Bank ≈ Audycje LIVE, Page pool ≈ strony VizRS (`/etv/pages`), Channel Deck ≈ Na antenie.

### Funkcje Vizrt, których brakuje w panelu (A–J)

Sprawdzone w `server/web` (2026-11-09). Kolumna „Punkt” wskazuje punkt tabeli w §4.

| # | Funkcja (Vizrt) | Co by to było w VizRS | Gdzie zmiana | Punkt |
|---|---|---|---|---|
| A | **Zdarzenia wtórne** przy pozycji ramówki – strony i akcje z przesunięciem (offset) względem programu | reguła grafiki przypięta do konkretnej audycji/kolekcji/pozycji, z offsetem od startu albo końca i czasem trwania; kilka zdarzeń na pozycję (np. „Za chwilę” 30 s przed końcem, belka tytułowa po 10 s) | CG Playout (model reguł) + panel; legacy bez zmian | K15 |
| B | **Kontrola playlisty** – nakładające się animacje, niezgodności z ramówką, błąd na czerwono z opisem | „Sprawdź ramówkę”: dziury, playout za krótki, pliki w koszu, audycja LIVE bez wejścia studia, zdjęta grafika – czerwone znaczniki w EPG, Playoutach i na karcie kanału | panel (dane z legacy i CG) | K9 |
| C | **Run Status / as-run** – stan wykonania każdego zdarzenia | dziennik emisji: co faktycznie poszło na antenę (pozycja, start, koniec, strony grafiki, przejęcia live), eksport CSV | CG Playout (zapis, `GET /api/live/asrun`) + panel (ekran, CSV) | K14 |
| D | **Channel Deck** – jeden widok „czy branding gra poprawnie” na wszystkich kanałach | „Na antenie” z warstwami grafiki VizRS (pigułki „W10 · belka 101”) i lampką zgodności grafiki z regułą | najpierw API CG Playout (`/api/live/state`), potem panel | K12 (LUKI #22) |
| E | **Import ramówki z systemu traffic** (CSV, XML, Excel, Harris, Omnibus; folder obserwowany, `.done`/`.fail`; pełna aktualizacja albo tylko czasy) | import CSV/XML do playlisty legacy z podglądem dopasowania do mediów; dokładne godziny – Scripted Schedule (§6, C2, po zmianie decyzji R2) | panel (`CreatePlaylist`, `ReplacePlaylistItems` już na białej liście) | K11 |
| F | **Dane w stronach** z bazy, RSS albo pliku; reguły aktywacji (pozycja aktywna tylko, gdy dane są) | pola stron VizRS z EPG legacy (CG Playout ma już `{title}`, `{next_*}`); źródło RSS/JSON dla tickera; reguła „pomiń stronę, gdy pole puste” | VizRS CG System i CG Playout | poza planem panelu (do planów CG) |
| G | **Kampanie** (VCB 5.4): zatwierdzanie stron (Planning → MCR) i czas życia (TTL) stron kampanii | strona promo z datami „od–do” i znacznikiem „zatwierdzona”; reguła gaśnie po terminie | CG Playout (reguły) + panel | K16 |
| H | **Take / Continue / Take Out** i **Quick Take** z page pool przy automatyce | na karcie kanału: wprowadź stronę, dalej, zdejmij jedną warstwę (dziś jest tylko „Zdejmij całą grafikę”) | CG Playout (TCP VizRS: `TAKE`/`CONTINUE`/`OUT`) + panel | K13 |
| I | **Wyzwalanie z automatyki** (REST, TCP/IP, GPI, VDCP) | REST już jest (`/api/live/*`); dodać webhook i alarm przy utracie sygnału, pustej ramówce, zatrzymanej emisji, długo zdjętej grafice | panel (banner, dźwięk) + CG Playout (webhook) | K17 |
| J | **Monitorowanie wszystkich kanałów** z jednego klienta (obraz NDI w Channel Deck) | mozaika podglądów (multiview) w „Na antenie”; uwaga: każdy podgląd to sesja Next, która transkoduje – limit albo miniatury | panel (`player.js`, `mux.js`) | K10 |

## 4. Jeden przebieg: luki + plan

**Decyzja użytkownika (2026-11-09): wariant A – zostajemy przy ErsatzTV legacy** (§6). Realizacja na gałęzi **`next-v`**.

Przebieg łączy [LUKI.md](../LUKI.md) i punkty z §2–§3 w jedną kolejkę: najpierw G1 (bezpieczeństwo), potem szybkie G2 wobec legacy (tylko panel i biała lista), potem funkcje MCR z danych, które panel już ma, na końcu punkty wymagające zmian w API VizRS CG Playout i G3. Luki spoza przebiegu – na końcu tej sekcji, z powodem.

**Jak pracować.** Jak w [PLAN-rozbudowy.md](PLAN-rozbudowy.md) („Jak pracować”): jeden punkt = jedna sesja, pierwszy „do zrobienia” ze spełnionym „Wymaga”, warunki „gotowe”, commit „Kn: …”. Testy wg [PLAN-makieta.md](PLAN-makieta.md): `DEPLOY_SHOTS=<katalog poza repo> tests/deploy.sh` zielony, zrzut obejrzany, nowe przypadki w `tests/e2e.cjs` (sprawdzi je CI). Zamknięta luka: wiersz usunięty z LUKI i wpis w `CHANGELOG.md` („Niewydane”). Punkty **CG** zmieniają API VizRS CG Playout – zasada „pakiet zawsze zgodny”: najpierw CG Playout (kod, testy kontraktu, jego DOKUMENTACJA §1 „Live API”), potem panel, w tym samym cyklu; starszy CG Playout nie może psuć panelu (brak pola = brak elementu UI). Punkt **ręcznie** robi się z użytkownikiem – automat go pomija.

| Punkt | Zakres | Wymaga | Stan |
|---|---|---|---|
| K1 | Sesje panelu: losowy identyfikator sesji zamiast tokenu w ciasteczku, wylogowanie, wygasanie (LUKI #2, G1) | – | zrobione (2026-11-09) |
| K2 | CSP zawężone do znanych źródeł obrazów i ramek zamiast `http:`/`https:` (LUKI #6, G1) | – | zrobione (2026-11-09) |
| K3 | Numeracja kanałów naraz (LUKI #23) | – | zrobione (2026-11-09) |
| K4 | Własne rozdzielczości w Profilach (LUKI #24) | – | zrobione (2026-11-09) |
| K5 | Silnik Next w Profilach i Diagnostyce, paczka diagnostyczna (LUKI #11, #27) | – | zrobione (2026-11-09; #27 zostaje – DOKUMENTACJA §4) |
| K6 | Wyniki zadań w tle (nakładanie pozycji, konserwacja) w panelu, nie tylko w Logach (LUKI #10) | – | zrobione (2026-11-09) |
| K7 | Diagnostyka i historia playoutu blokowego (LUKI #13, część #25) | – | zrobione (2026-11-09) |
| K8 | Biblioteki: czas folderów obrazów, skan jednego serialu, wyodrębnianie napisów (LUKI #18, #26) | – | zrobione (2026-11-09) |
| K9 | Kontrola ramówki: błędy na czerwono w Na antenie, EPG i Playoutach (Vizrt B) | K6 | zrobione (2026-11-09) |
| K10 | Mozaika kanałów (multiview) w Na antenie (Vizrt J) | K9 | zrobione (2026-11-09) |
| K11 | Import ramówki z pliku CSV/XML do playlisty legacy (Vizrt E) | – | zrobione (2026-11-09) |
| Q1 | Sloty na żywo z prawdziwym sygnałem OBS → CG Playout, Plex z prawdziwym kontem (LUKI #3, G1) | – | ręcznie (z użytkownikiem) |
| K12 | Warstwy i strony VizRS na antenie w karcie kanału (LUKI #22, Vizrt D; CG) | – | panel gotowy (2026-11-09); czeka na CG Playout |
| K13 | Ręczne TAKE / CONTINUE / OUT pojedynczej strony (Vizrt H; CG) | K12 | panel gotowy (2026-11-09); czeka na CG Playout |
| K14 | Dziennik emisji (as-run) z eksportem CSV (Vizrt C; CG) | K12 | panel gotowy (2026-11-09); czeka na CG Playout |
| K15 | Zdarzenia wtórne przypięte do audycji/kolekcji, oś pozycji z grafiką (Vizrt A; CG) | K12 | kontrakt opisany (2026-11-09); czeka na CG Playout |
| K16 | Ważność (od–do) i zatwierdzanie stron promo (Vizrt G; CG) | K15 | kontrakt opisany (2026-11-09); czeka na CG Playout |
| K17 | Alarmy: banner, dźwięk, webhook (Vizrt I; webhook w CG) | K9, K14 | panel zrobiony (2026-11-09); webhook czeka na CG Playout |
| K18 | Podgląd kanału: HEVC w `mux.js`, dźwięk inny niż AAC – sprawdzić wykonalność (LUKI #21, G3) | – | zrobione (2026-11-09) |

**Poza przebiegiem** (wiersze zostają w LUKI):

| LUKI | Dlaczego nie w przebiegu |
|---|---|
| #1 TLS | zamierzone: serwer bez zależności, TLS w zewnętrznym proxy (RUNBOOK) |
| #5 blokada biblioteki, #8 test odtwarzania, #9 postęp skanu, #12 stan Plex | poza MediatR – wymagałyby nowego kodu C# w moście; korzyść mała |
| #14 pliki YAML/skrypty, #20 elementy graficzne, walidator YAML z #25 | decyzja R2 (panel nie zapisuje na `/config`); zmiana tylko decyzją użytkownika – wtedy także Scripted Schedule (§6, C2) |
| #15, #17 | zamierzone albo ograniczenie legacy |
| #16 Trakt, #19 głęboki skan | pominięte świadomie (klucz API Trakt; rzadko potrzebny) |
| Vizrt F (dane w stronach) | praca w VizRS CG System i CG Playout, nie w panelu |

## 5. Punkty

### K1 – sesje panelu (LUKI #2)
Dziś ciasteczko `vizrs_live` niesie sam token panelu (`server/src/main.rs`, `session_cookie`), więc wymiana tokenu unieważnia wszystkie sesje, a wyciek ciasteczka = wyciek tokenu. Zrobić: po udanym logowaniu losowy identyfikator sesji (32 bajty z `/dev/urandom` – bez crate'ów; obraz `scratch` ma `/dev` od środowiska kontenera), tablica sesji w pamięci (`Mutex<HashMap>`, limit liczby, wygasanie po 30 dniach bezczynności), „Wyloguj” usuwa sesję, restart panelu = ponowne logowanie (opisać). Token panelu dalej działa w nagłówku dla skryptów, jeśli dziś działa (sprawdzić). Testy jednostkowe (wygasanie, limit, wylogowanie), e2e logowania. DOKUMENTACJA §3 i §9, RUNBOOK §6. Zamyka LUKI #2.

### K2 – CSP zawężone (LUKI #6)
`server/src/http.rs`: `CSP` jest stałą z `img-src … http: https:` i `frame-src http: https:`. Zbudować CSP przy starcie z originów, które panel zna: `--stream-url` (obrazy legacy `/artwork`) i adres VizRS (`/output` w ramce) – `img-src 'self' data: <stream-origin>`, `frame-src <vizrs-origin>`. Brak opcji = brak źródła. Test jednostkowy nagłówka; przejście po ekranach bez błędów CSP w konsoli (`prod-smoke.cjs` zbiera błędy konsoli – sprawdzić). Zamyka LUKI #6.

### K3 – numeracja kanałów naraz (LUKI #23)
Legacy: `ChannelNumbers.razor` – lista kanałów (`GetAllChannelsForSort`), zapis jednym `UpdateChannelNumbers`. Panel: przycisk „Numeracja” na ekranie Kanały, okno z tabelą (numer – pole, nazwa), kontrola duplikatów przed wysłaniem, błąd legacy w tostach. Wiersze w `bridge/commands.txt`; DOKUMENTACJA §4 (Kanały), §8.

### K4 – własne rozdzielczości (LUKI #24)
Legacy: Settings → FFmpeg: `GetAllResolutions` (jest), `CreateCustomResolution` (nazwa, szerokość, wysokość), `DeleteCustomResolution` (tylko własne – `IsCustom`). Panel: lista na ekranie Profile kodowania pod wyborem rozdzielczości albo w Ustawieniach → FFmpeg.

### K5 – silnik Next, paczka diagnostyczna (LUKI #11, #27)
`GetNextVersion`, `GetNextDescribe`, `GetNextProbe`, `RefreshNextProbe` (legacy ≥ 26.12.0; starsze – brak komendy = brak sekcji). Profile kodowania: przy wybranej akceleracji „działa / nie działa i dlaczego”, kodeki dekodowania i kodowania sprzętowego (jak edytor profilu legacy 26.12.0). Diagnostyka: karta „Silnik Next” z wersją, akceptowanymi wersjami schematów i „Sprawdź ponownie”. Paczka diagnostyczna (`ArchiveTroubleshootingResults`): sprawdzić, co zwraca; jeśli plik da się podać przez dyspozytor albo istniejący endpoint mostu – przycisk „Pobierz paczkę diagnostyczną”, w przeciwnym razie zostawić #27 z opisem powodu.
*Zrobione 2026-11-09:* ZIP powstaje tylko w katalogu tymczasowym legacy (`ArchiveTroubleshootingResults` zwraca ścieżkę) – bez nowego kodu C# nie do pobrania; #27 zostaje (DOKUMENTACJA §4).

### K6 – wyniki zadań w tle (LUKI #10)
`CheckForOverlappingPlayoutItems` i zadania konserwacji wracają jako `queued`, a wynik jest tylko w logu legacy. Po zleceniu panel czyta `GetRecentLogEntries` przez ≤ 60 s i pokazuje w oknie wpisy z czasem po zleceniu, pasujące do zadania (wzorce komunikatów z kodu legacy – wypisać w DOKUMENTACJA §4); brak wpisu = „wynik w Logach”. Potrzebne dla K9 (nakładanie pozycji jako błąd ramówki).

### K7 – playout blokowy: diagnostyka i historia (LUKI #13, część #25)
Legacy: `BlockPlayoutTroubleshooting.razor` i `BlockPlayoutHistory.razor` – `GetAllBlockPlayouts`, `GetBlockPlayoutHistory`, `DecodePlayoutHistory`. Panel: w edytorze playoutu blokowego zakładka „Historia” (tylko odczyt: blok, pozycja, ostatnia emisja, zdekodowany stan). Przed dopisaniem do białej listy sprawdzić, czy wyniki nie niosą obiektów wewnętrznych (DOKUMENTACJA §5); wtedy uwaga w `commands.txt` jak dziś przy `GetBlockPlayoutHistory`. Walidator YAML z #25 – poza przebiegiem (R2).

### K8 – biblioteki: obrazy, serial, napisy (LUKI #18, #26)
Komendy na białej liście bez UI: `GetImageFolders`, `UpdateImageFolderDuration` (czas wyświetlania obrazów w folderze), `QueueShowScanByLibraryId` (skan jednego serialu – w karcie serialu w Przeglądarce). Nowe: `ExtractEmbeddedSubtitles`, `ExtractEmbeddedShowSubtitles` (zadanie w tle; przycisk w karcie pozycji / serialu, wynik jak w K6).

### K9 – kontrola ramówki (Vizrt B)
Na wzór kontroli playlisty Vizrt, tylko z danych, które panel już ma: `GetFuturePlayoutItemsById` (dziury między pozycjami, playout kończący się w ciągu < 24 h, kanał bez playoutu), `GetPlayoutWarningsCount`, wynik nakładania pozycji (K6), pozycje z plikiem w koszu (`QuerySearchIndex…` `state:FileNotFound` dla pozycji w najbliższych 24 h), CG Playout `/api/live/state` (audycja LIVE w ramówce bez wejścia studia, zdjęta grafika). Wynik: lista „Uwagi” w Na antenie (jest – rozszerzyć), czerwone znaczniki pozycji w EPG i Playoutach z opisem w podpowiedzi. Liczone w przeglądarce przy odświeżeniu ekranu, bez pętli w serwerze. Bez zapisu.

### K10 – mozaika kanałów (Vizrt J)
Na antenie: przełącznik „Mozaika” – siatka podglądów (`player.js`/`mux.js`), wyciszone, dźwięk tylko w wybranym, czerwona ramka kanału z błędem z K9. **Uwaga kosztowa:** każdy podgląd to sesja Next, która transkoduje (na Ampere A1 2 OCPU może nie wystarczyć) – limit podglądów (opcja `VIZRS_LIVE_MULTIVIEW_MAX`, domyślnie 4) i ostrzeżenie; rozważyć miniatury co N s. DOKUMENTACJA §3 „UI”.

### K11 – import ramówki z pliku (Vizrt E)
Plik CSV (start, tytuł albo ścieżka pliku, długość) lub XML wgrany w przeglądarce, parsowany w JS. Dopasowanie do mediów legacy (`QuerySearchIndexAllItems` po ścieżce, potem po tytule), podgląd: dopasowane / niejednoznaczne / brak. Zapis jako **playlista legacy** (`CreatePlaylist`, `ReplacePlaylistItems` – są na liście) do użycia w harmonogramie. Bez zapisu plików na `/config` (R2). Godziny emisji wymusza harmonogram (pozycja „stała godzina”). Harris/Omnibus i godziny co do sekundy – poza punktem (§6).

### Q1 – prawdziwy sygnał i Plex (LUKI #3, ręcznie)
Z użytkownikiem, na jego stosie: OBS → RTMP/SRT → CG Playout → przejęcie kanału, ZDEJMIJ/WPUŚĆ, audycja LIVE z ramówki; Plex – logowanie PIN i synchronizacja. Wynik w DOKUMENTACJA §7 i STATUS. Najlepiej przed K12–K17, które rozbudowują część live.

### K12 – warstwy VizRS na antenie (LUKI #22; CG)
CG Playout: w `/api/live/state` dla kanału `layers`: `[{layer, page, scene, since}]` – CG zna je z `STATE` VizRS (woła je już przy „Zdejmij grafikę”). Panel: pigułki „W10 · belka 101” w karcie kanału (makieta M2).

### K13 – TAKE / CONTINUE / OUT (CG)
CG Playout: `POST /api/live/channels/<n>/take` `{page}`, `/continue` `{layer}`, `/out` `{layer}` → komendy TCP VizRS na antenie kanału, w tle z limitem czasu („grafika nigdy nie zatrzymuje emisji”), wpis w dzienniku z `X-Operator`. Panel: przy pigułkach z K12 „Dalej”/„Zdejmij”, w karcie kanału „Wprowadź stronę…” (lista z `/etv/pages`) – odpowiednik Quick Take. Ręcznie wprowadzona strona ma pierwszeństwo przed regułą do czasu zdjęcia (ustalić w CG).

### K14 – dziennik emisji (as-run) (CG)
CG Playout zapisuje start i koniec każdej pozycji kanału (z danych szablonu ErsatzTV), wprowadzone i zdjęte strony, przejęcia live (ZDEJMIJ/WPUŚĆ), zdjęcie całej grafiki – JSONL z rotacją jak `log.jsonl`, `GET /api/live/asrun?channel=&from=&to=`. Panel: ekran „Dziennik emisji” (filtr kanału i dnia, tabela), eksport CSV w przeglądarce.

### K15 – zdarzenia wtórne (CG)
Dziś reguły grafiki są ogólne (każda pozycja, przerwa, slot). Dodać regułę z celem: audycja (tytuł), kolekcja albo ID pozycji legacy, z listą zdarzeń `{page, offset_s od startu|końca, duration_s, values}` – kilka zdarzeń na pozycję („Za chwilę” 30 s przed końcem, belka tytułowa po 10 s). Walidacja w CG (nakładające się warstwy = błąd). Panel: w karcie pozycji (EPG, Playouty) oś pozycji z zaplanowanymi zdarzeniami i „Dodaj zdarzenie”.

### K16 – ważność i zatwierdzanie stron promo (CG)
Reguła/zdarzenie dostaje `valid_from`, `valid_to` i `approved` (kto, kiedy); CG pomija niezatwierdzone i przeterminowane. Panel: pigułki „czeka na zatwierdzenie” / „wygasa jutro”, filtr. Wzór: VCB 5.4.

### K17 – alarmy
Panel (przeglądarka): banner i opcjonalny dźwięk, gdy K9 znajdzie błąd w najbliższych 15 min, slot LIVE bez sygnału, emisja kanału zatrzymana, grafika zdjęta > N min. Webhook (poza przeglądarką) – w CG Playout, który ma pętlę zdarzeń; opcja `VIZRS_ALERT_WEBHOOK` po stronie CG, źródło zdarzeń z K14.

### K18 – podgląd HEVC i inne dźwięki (LUKI #21)
`mux.js` przepakowuje tylko H.264 + AAC. Sprawdzić koszt `hvcC` (HEVC) i dźwięku AC-3/E-AC-3 w MSE (`MediaSource.isTypeSupported`); jeśli wykonalne bez bibliotek – dodać, inaczej opisać w DOKUMENTACJA §3 i zostawić lukę. Najniższy priorytet.

## 6. Legacy czy Next

**Decyzja (2026-11-09): A – zostajemy przy ErsatzTV legacy.** B (VizRS jako planista dla samego Next) i C1 (osobny lineup Next) – odrzucone. C2 (Scripted Schedule w legacy, ramówka co do sekundy) zostaje możliwy w ramach A, ale tylko po zmianie decyzji R2 (LUKI #14) – wtedy nowy punkt w §4. Do rozważenia B wrócić dopiero, gdy Next wyda 1.0 z API zarządzania albo legacy przestanie być rozwijane (sygnał: brak wydań > 2 miesiące, baner końca wsparcia).

Analiza, na której oparto decyzję:

### Stan faktyczny (2026-11-09)

- Od **legacy v26.12.0** silnik nadawania legacy jest usunięty: **wszystkie kanały nadaje już ErsatzTV Next** (legacy przenosi kanały przy starcie, adresy `ts-legacy`/`hls-direct` przekierowuje). VizRS Live **już korzysta z Next** – legacy jest dla niego planistą, bazą, skanerem i dostawcą EPG.
- **Next 0.2.5** (Rust, MIT, przed 1.0 – `0.B` = zmiana niezgodna) z założenia **nie** ma bibliotek, metadanych, harmonogramów ani tworzenia playoutów; **nie ma API zarządzania** – tylko pliki JSON z wersją (`lineup.json`, `channel.json`, katalog playoutu `{start}_{finish}.json`, wczytywany ponownie po zmianie) i HTTP: `/channel/{plik}` (HLS), `/channels.m3u`, `/xmltv.xml` (XMLTV z plików, które pisze planista). Bez uwierzytelniania. HDHomeRun, logo i okładki EPG, Plex/Jellyfin/Emby – tylko w legacy.
- Mocne strony Next dla VizRS: źródło **`dynamic`** (pozycja rozwiązywana zapytaniem HTTP w chwili emisji), źródła `http`/`rtsp` z `is_live`, **warstwy grafiki** w playoucie (`graphics[]`, w tym `canvas` – wideo z alfą z HTTP z nagłówkami offsetu; tak legacy podaje elementy graficzne, a CG Playout element „script” VizRS), **fallback** z obrazem tła i opisem błędu, `describe --probe`.

### Opcje

| | A. Zostać na legacy – **wybrane** | B. Porzucić legacy: VizRS jako planista dla Next | C. Hybryda: legacy zostaje, VizRS przejmuje wybrane kanały lub ramówki |
|---|---|---|---|
| Co robimy | most i panel jak dziś, przebieg z §4 | piszemy: bazę mediów i skaner (ffprobe), kolekcje, harmonogramy/bloki/wypełniacze, budowanie playoutu, XMLTV, uruchamianie `ersatztv`, proxy z autoryzacją | C1: kanały „traffic” jako **osobny lineup Next** obok legacy; C2: ramówka z pliku wewnątrz legacy przez **Scripted Schedule** (playout `Scripted`, skrypt woła `add_*`, `wait_until_exact`, `pad_until_exact`, `graphics_on/off`) |
| Koszt | najniższy | bardzo wysoki – w praktyce przepisanie legacy (~157 tys. linii C# według PLAN-vizrs-live §4) | C1 średni; C2 niski–średni (skrypt na `/config` – LUKI #14) |
| Zyski | pełne funkcje legacy (biblioteki, Plex/Jellyfin/Emby, bloki, deco, EPG, HDHR) | jeden język (Rust), brak .NET (sterta legacy 1,5 GB na Ampere A1), brak zależności od wewnętrznych komend legacy, pełna kontrola nad zdarzeniami wtórnymi i as-run, LIVE przez `dynamic`/`http is_live` bez nakładki `vizrs-ffmpeg` | dokładne godziny emisji z traffic bez przepisywania legacy; C1 – grafika i LIVE natywnie w playoucie Next |
| Ryzyka | most na komendach wewnętrznych: każde wydanie legacy (co tydzień) = test (`commandsMissing`, e2e); .NET na Ampere | Next przed 1.0 (0.2.0 → 0.2.5 w miesiąc), bez API i bez autoryzacji; utrata Plex/Jellyfin/Emby, HDHR; ogromna praca, zanim panel znów zrobi to, co dziś | C1: dwa lineupy (dwa M3U/XMLTV), własny obraz Next do utrzymania; C2: łamie decyzję R2 |

Niezależnie od decyzji: CG Playout może sprawdzić, czy element graficzny legacy z warstwą `canvas` Next zastąpi nakładkę `vizrs-ffmpeg` (PLAN-vizrs-live §4, „Na później”) – praca w repo CG Playout, poza tym planem.

## 9. Zdublowane funkcje w pakiecie VizRS – analiza i porządki (2026-11-11)

Przegląd VizRS Live wobec VizRS CG Playout i VizRS CG System. Kodu przeniesionego między repozytoriami nie ma (własne HTTP i JSON w każdym to zasada „zero zależności”), ale te same czynności dało się wykonać w kilku miejscach.

| # | Dublowanie | Decyzja / stan |
|---|---|---|
| D1 | Ręczne TAKE / CONTINUE / OUT na antenie kanału w Trio (CG System) i w Live (K13); dziennik emisji widział tylko komendy z Live | **Live zachowuje sterowanie grafiką** (decyzja użytkownika 2026-11-11 – role Trio i Live nie są rozdzielane). Dziennik pełny: CG Playout wykrywa zmiany warstw, których sam nie wysłał (Trio, `/mobile`, makra, karuzela, Companion) i zapisuje `take`/`out` z operatorem „VizRS (poza panelem)”. Przy okazji naprawiona flaga `manual` (K13). **Zrobione** (CG Playout `panel.rs`, `vizrs.rs`) |
| D2 | „Kiedy grafika wchodzi” w trzech miejscach: czas strony w Trio (⏱ kanał), reguły CG Playout (`on_clip`, `on_end`, `shows`, `channels`), elementy `page-<ID>.yml` w ramówce legacy | Jeden widok w Live: Grafika kanału → „Kiedy strona wchodzi na antenę” (trzy źródła przy każdej stronie, ostrzeżenie „może wejść dwa razy”). **Zrobione.** Otwarte: który mechanizm ma być główny (proponowany: element w ramówce + czas z Trio; reguły CG do pasków stałych i reklam) – do decyzji użytkownika |
| D3 | Zapisy do legacy dwiema drogami: CG Playout `etv_api.rs` (Smart Collections `LIVE · …`, skan biblioteki, reset playoutu, XMLTV) i Live przez most | Kolekcje `LIVE · …` w Live tylko do odczytu, z pigułką „CG Playout”, nazwa zarezerwowana. **Zrobione.** Otwarte: CG przestaje pisać do legacy, a kroki audycji LIVE (kolekcja, skan, przebudowa) wykonuje Live przez most – zmiana styku po obu stronach, osobny punkt |
| D4 | Wdrożenie opisane dwa razy: `compose.cg-playout.yml` (lokalnie) i `docker-compose.live.yml` CG (Portainer), kopia Caddyfile, `compose.vaapi.yml` | `scripts/check-cg-overlay.sh` (na początku `tests/deploy.sh`) wymusza zgodność; wyrównany rozjazd `TZ`. **Zrobione.** Otwarte: jedna nakładka (lokalnie `docker-compose.live.yml` CG + cienka nakładka Live tylko z budową mostu) – wymaga zmiany `COMPOSE_FILE` w `.env` lokalnego stosu i odtworzenia proxy, więc tylko na prośbę użytkownika |
| D5 | Ramówka czytana dwa razy: XMLTV w CG Playout i `GetFuturePlayoutItemsById` w Live | Bez zmian: małe ryzyko (EPG legacy odświeża się z opóźnieniem); do obserwacji |
| D6 | Alarmy: webhook CG System (`--webhook`), `alert_webhook` CG Playout, alarmy w przeglądarce Live; stan systemu w Trio i w Live | Bez zmian: uzupełniają się (różne zdarzenia) |
| D7 | „Show/audycja” w trzech znaczeniach (paczka grafiki VizRS, `shows` w regułach CG, Audycje LIVE) | Tylko pojęcia: w UI Live używać „show VizRS”, „reguła audycji”, „audycja LIVE” |

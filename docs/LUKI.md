# LUKI – znane braki (uszeregowane: niezawodność → wierność → funkcje)

Kolejność realizacji luk razem z planem rozwoju: [plany/PLAN-mcr.md](plany/PLAN-mcr.md) §4 („Jeden przebieg”); luki spoza przebiegu są tam w tabeli z powodem. Zamykając pozycję, usuń wiersz i dopisz zmianę w `CHANGELOG.md` („Niewydane”). Nowe braki dopisuj od razu, z kolejnym wolnym numerem (numerów nie używamy ponownie). Opis działania i uzasadnienia decyzji są w [DOKUMENTACJA.md](DOKUMENTACJA.md) – tu tylko krótko i odsyłacz.

Ograniczenia samego legacy, których panel nie obejdzie bez zmiany legacy (np. jeden serwer Jellyfin/Emby, `GetAllLanguageCodes` = `und`), są w DOKUMENTACJA §5, nie tutaj.

## G1 – niezawodność i bezpieczeństwo

| # | Luka | Uwagi |
|---|---|---|
| 1 | Brak TLS w panelu i w proxy dla widzów | zamierzone (serwer bez zależności); LAN/VPN albo zewnętrzne proxy TLS – RUNBOOK; ciasteczko dostaje `Secure` przy `X-Forwarded-Proto: https` (DOKUMENTACJA §9) |
| 2 | Ciasteczko sesji = token panelu (brak magazynu sesji) | wymiana tokenu unieważnia wszystkie sesje (RUNBOOK §6); ryzyko przyjęte w R11; PLAN-mcr K1 |
| 3 | Sloty na żywo nie sprawdzone z prawdziwym sygnałem (OBS → CG Playout), Plex nie sprawdzony z prawdziwym kontem | e2e na atrapach; `tests/real.sh` sprawdził Jellyfin, Emby i reguły grafiki na prawdziwym CG (DOKUMENTACJA §7); krok ręczny przed wdrożeniem – STATUS; PLAN-mcr Q1 (ręcznie) |
| 5 | Panel nie bierze blokady biblioteki legacy (`IEntityLocker`, poza MediatR) | drugie zlecenie synchronizacji tej samej biblioteki trafia do kolejki (DOKUMENTACJA §4, R8) |
| 6 | CSP dopuszcza `img-src`/`frame-src` `http:`/`https:` | potrzebne podglądowi obrazów legacy spod `--stream-url` i `/output` VizRS; ryzyko przyjęte (DOKUMENTACJA §9); PLAN-mcr K2 |
| 22 | Na antenie bez warstw grafiki VizRS (pigułki „W10 belka 101” z makiety) | CG Playout nie wystawia w `/api/live/state` stanu warstw ani stron na antenie; do dodania w API CG Playout, potem w karcie kanału (PLAN-makieta M2); PLAN-mcr K12 |

## G2 – wierność wobec web GUI legacy

| # | Luka | Uwagi |
|---|---|---|
| 8 | Test odtwarzania pliku z wyborem profilu (jak w Blazorze legacy) – panel ma tylko podgląd kanału | legacy przekazuje między krokami obiekty wewnętrzne (DOKUMENTACJA §5) |
| 9 | Brak postępu skanu biblioteki | legacy podaje go tylko zdarzeniami Blazora; panel przez 30 s odświeża liczby pozycji (DOKUMENTACJA §4 „Media”) |
| 10 | Wynik „Sprawdź nakładanie pozycji” i zadań konserwacji tylko w Logach | zadania w tle legacy (`queued`); PLAN-mcr K6 |
| 11 | Stan silnika Next w Profilach (`GetNextProbe`, `RefreshNextProbe`, `GetNextDescribe`) | dostępne od legacy v26.12.0, nie na białej liście (DOKUMENTACJA §4 R5, §6); PLAN-mcr K5 |
| 12 | Plex: panel nie wie, czy konto jest zalogowane | legacy trzyma to w `IPlexSecretStore` poza MediatR; „Wyloguj” tylko, gdy są serwery |
| 13 | Historia bloku w edytorze playoutu blokowego (`GetBlockPlayoutHistory`) | pominięte świadomie (DOKUMENTACJA §4 „Playouty”); PLAN-mcr K7 |
| 23 | Numeracja kanałów naraz (`GetAllChannelsForSort`, `UpdateChannelNumbers` – ekran legacy `/channels/numbers`) | brak na białej liście; PLAN-mcr K3 |
| 24 | Własne rozdzielczości (`CreateCustomResolution`, `DeleteCustomResolution`) | brak na białej liście; PLAN-mcr K4 |
| 25 | Walidator YAML harmonogramu sekwencyjnego i diagnostyka playoutu blokowego (`DecodePlayoutHistory`) | walidator poza MediatR (`ISequentialScheduleValidator`); razem z #13 i #14 (PLAN-mcr K7, walidator poza przebiegiem) |
| 26 | Wyodrębnianie napisów osadzonych (`ExtractEmbeddedSubtitles`, `ExtractEmbeddedShowSubtitles`) | zadanie w tle legacy (PLAN-mcr K8) |
| 27 | Paczka diagnostyczna legacy (`ArchiveTroubleshootingResults`, `ArchiveMediaSample`) | przydatna przy zgłoszeniu awarii (PLAN-mcr K5) |

## G3 – funkcje

| # | Luka | Uwagi |
|---|---|---|
| 14 | Panel nie edytuje plików YAML, skryptów i JSON playoutów ani `.yml` strumieni zdalnych | decyzja R2; plik na wolumen `/config`, w panelu ścieżka; ewentualnie jeden ogólny endpoint zapisu w moście ograniczony do jednego katalogu (DOKUMENTACJA §4) |
| 15 | Pozycję harmonogramu audycji LIVE operator dodaje ręcznie w Harmonogramach | zamierzone (zapis harmonogramu z dwóch miejsc groziłby nadpisaniem); kreator Audycji LIVE prowadzi krok po kroku |
| 16 | Trakt Lists (`AddTraktList`, `DeleteTraktList`) | wymaga klucza API Trakt; pominięte w liście pokrycia (DOKUMENTACJA §8) |
| 17 | Własna kolejność kolekcji (`UpdateCollectionCustomOrder`) | legacy pozwala tylko dla kolekcji z samych filmów (DOKUMENTACJA §4 R4) |
| 18 | Komendy na białej liście bez UI: czas folderów obrazów (`GetImageFolders`, `UpdateImageFolderDuration`), skan jednego serialu (`QueueShowScanByLibraryId`) | do dołożenia w Bibliotekach; PLAN-mcr K8 |
| 19 | Głęboki skan źródeł zewnętrznych | pominięty (rzadko potrzebny, długo trwa) – DOKUMENTACJA §4 R8 |
| 20 | Elementy graficzne legacy (YAML): tylko lista i „Wczytaj pliki elementów” | element VizRS zakłada CG Playout; patrz #14 |
| 21 | Podgląd kanału: HEVC/AV1 tylko przez natywny HLS przeglądarki, dźwięk tylko AAC | `mux.js` przepakowuje H.264 + AAC; HEVC wymagałby `hvcC` (DOKUMENTACJA §3 „UI”); PLAN-mcr K18 |

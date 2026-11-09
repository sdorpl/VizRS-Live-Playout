# Plan rozwoju VizRS Live (PLAN-mcr) – braki wobec legacy, wzorzec Viz Channel Branding, legacy czy Next

> **Stan:** projekt (2026-11-09), żaden punkt niezaczęty. Stan prac: [../STATUS.md](../STATUS.md), znane braki: [../LUKI.md](../LUKI.md), opis działania: [../DOKUMENTACJA.md](../DOKUMENTACJA.md).
>
> **Jedyny dokument planów rozwoju VizRS Live** (decyzja użytkownika 2026-11-09): nowe plany i punkty panelu dopisuj tutaj – nowy punkt w tabeli §4 i opis w §5, nowe analizy jako kolejne sekcje – zamiast zakładać nowe pliki `PLAN-*.md`. Zakończone plany [PLAN-rozbudowy.md](PLAN-rozbudowy.md) i [PLAN-makieta.md](PLAN-makieta.md) zostają jako archiwum.
>
> Treść: §1 skąd wiadomo, §2 czego jeszcze brakuje wobec web GUI legacy, §3 czego uczy Vizrt (tabela A–J), §4 tabela punktów, §5 punkty, §6 legacy czy Next – opcje i zalecenie.

## 1. Źródła i ograniczenia rozpoznania

- **Web GUI legacy (port 8409).** Rozpoznanie z kodu, bez działającego GUI: GUI jest zamknięte za proxy (DOKUMENTACJA §8), a sesja, w której powstał plan, nie miała dostępu do lokalnego stosu. Źródło: `ErsatzTV/legacy` na `main`, commit `e51ac60` z 2026-11-09 (po v26.12.0), strony `ErsatzTV/Pages/**/*.razor`, menu `Shared/MainLayout.razor`. Porównanie: 259 rekordów komend i zapytań w `ErsatzTV.Application` z białą listą `bridge/commands.txt` (241 wierszy) i listą pokrycia (DOKUMENTACJA §8).
- **ErsatzTV Next.** `ErsatzTV/next` commit `c5cb065` (v0.2.5, 2026-11-06): README, `CHANGELOG.md`, `schema/*.json`, trasy `crates/ersatztv`. Wcześniejsze rozpoznanie (2026-11-06): `../../../VizRS CG System/docs/plany/PLAN-vizrs-live.md` §2.
- **Vizrt.** Kanałową grafikę i playout Vizrt robi dziś **Viz Channel Branding** (5.x, następca **Viz Multichannel** 4.x); studio – Viz Mosart (poza zakresem). Opis pochodzi z wyników wyszukiwarki i stron produktu, **nie z pełnej lektury przewodników**. Prośba o dodanie `docs.vizrt.com` i `documentation.vizrt.com` do dozwolonych hostów sesji została odrzucona (2026-11-09). Do uzupełnienia, gdy hosty będą dozwolone: przewodnik VCB 5.5/5.6 (rozdziały User Interface, Playlists, Channel Deck, Integrations Hub REST v2), Multichannel 4.2 (Master Control Workflow, Import/Export Settings).
  Strony: [VCB – przegląd](https://www.vizrt.com/product-updates/viz-channel-branding-overview/), [VCB 5.4](https://www.vizrt.com/product-updates/viz-channel-branding/viz-channel-branding-5-4/), [release notes 5.4](https://docs.vizrt.com/viz-channelbranding-rn/5.4/Viz_Channel_Branding_Release_Notes.html), [5.5 (PDF)](https://docs.vizrt.com/viz-channelbranding-rn-5.5.pdf), [User Interface 5.5](https://docs.vizrt.com/viz-channelbranding-guide/5.5/User_Interface.html), [Basic Settings 5.0](https://documentation.vizrt.com/viz-channelbranding-guide/5.0/Basic_Settings.html), [Playlists 5.3](https://docs.vizrt.com/viz-channelbranding-guide/5.3/Playlists.html), [Clip Bank 5.2](https://docs.vizrt.com/viz-channelbranding-guide/5.2/Clip_Bank.html), [Multichannel 4.2 – Working with Playlists](https://docs.vizrt.com/viz-multichannel-guide/4.2/Working_with_Playlists.html), [Import/Export Settings](https://docs.vizrt.com/viz-multichannel-guide/4.2/Import___Export_Settings.html), [Master Control Workflow](https://docs.vizrt.com/viz-multichannel-guide/4.2/Master_Control_Workflow.html).

## 2. Web GUI legacy – co jeszcze nie ma odpowiednika

Pokrycie jest prawie pełne (DOKUMENTACJA §8). Nowe braki, których nie było w LUKI (dopisane jako #23–#27):

| Element legacy | Komendy | Uwagi |
|---|---|---|
| **Edit Channel Numbers** (`/channels/numbers`, przycisk na liście kanałów) – zmiana numeracji wszystkich kanałów naraz | `GetAllChannelsForSort`, `UpdateChannelNumbers` | wiersze w `commands.txt` + UI w `views/kanaly.js` → **K1** |
| **Własne rozdzielczości** (Settings → FFmpeg) | `CreateCustomResolution`, `DeleteCustomResolution` | → **K2** |
| **Walidator YAML harmonogramu sekwencyjnego** (`/system/troubleshooting/sequential-schedule`) | `ISequentialScheduleValidator` – poza MediatR | dyspozytor go nie wywoła; razem z LUKI #14 (pliki YAML) |
| **Diagnostyka playoutu blokowego** (`/system/troubleshooting/block-playout`) | `GetAllBlockPlayouts`, `DecodePlayoutHistory` | obok LUKI #13 |
| **Wyodrębnianie napisów osadzonych** | `ExtractEmbeddedSubtitles`, `ExtractEmbeddedShowSubtitles` | zadanie w tle |
| **Paczka diagnostyczna** (Troubleshooting → Upload Results) | `ArchiveTroubleshootingResults`, `ArchiveMediaSample` | przydatna przy zgłoszeniu awarii (RUNBOOK) |
| **Stan silnika Next** | `GetNextProbe`, `RefreshNextProbe`, `GetNextDescribe`, `GetNextVersion` | już LUKI #11 → **K3** |

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
| A | **Zdarzenia wtórne** przy pozycji ramówki – strony i akcje z przesunięciem (offset) względem programu | reguła grafiki przypięta do konkretnej audycji/kolekcji/pozycji, z offsetem od startu albo końca i czasem trwania; kilka zdarzeń na pozycję (np. „Za chwilę” 30 s przed końcem, belka tytułowa po 10 s) | CG Playout (model reguł) + panel; legacy bez zmian | K10 |
| B | **Kontrola playlisty** – nakładające się animacje, niezgodności z ramówką, błąd na czerwono z opisem | „Sprawdź ramówkę”: dziury, playout za krótki, pliki w koszu, audycja LIVE bez wejścia studia, zdjęta grafika – czerwone znaczniki w EPG, Playoutach i na karcie kanału | panel (dane z legacy i CG) | K4 |
| C | **Run Status / as-run** – stan wykonania każdego zdarzenia | dziennik emisji: co faktycznie poszło na antenę (pozycja, start, koniec, strony grafiki, przejęcia live), eksport CSV | CG Playout (zapis, `GET /api/live/asrun`) + panel (ekran, CSV) | K9 |
| D | **Channel Deck** – jeden widok „czy branding gra poprawnie” na wszystkich kanałach | „Na antenie” z warstwami grafiki VizRS (pigułki „W10 · belka 101”) i lampką zgodności grafiki z regułą | najpierw API CG Playout (`/api/live/state`), potem panel | K7 (LUKI #22) |
| E | **Import ramówki z systemu traffic** (CSV, XML, Excel, Harris, Omnibus; folder obserwowany, `.done`/`.fail`; pełna aktualizacja albo tylko czasy) | import CSV/XML do playlisty legacy z podglądem dopasowania do mediów; dokładne godziny – Scripted Schedule (§6, C2) | panel (`CreatePlaylist`, `ReplacePlaylistItems` już na białej liście) | K6 |
| F | **Dane w stronach** z bazy, RSS albo pliku; reguły aktywacji (pozycja aktywna tylko, gdy dane są) | pola stron VizRS z EPG legacy (CG Playout ma już `{title}`, `{next_*}`); źródło RSS/JSON dla tickera; reguła „pomiń stronę, gdy pole puste” | VizRS CG System i CG Playout | poza planem panelu (do planów CG) |
| G | **Kampanie** (VCB 5.4): zatwierdzanie stron (Planning → MCR) i czas życia (TTL) stron kampanii | strona promo z datami „od–do” i znacznikiem „zatwierdzona”; reguła gaśnie po terminie | CG Playout (reguły) + panel | K11 |
| H | **Take / Continue / Take Out** i **Quick Take** z page pool przy automatyce | na karcie kanału: wprowadź stronę, dalej, zdejmij jedną warstwę (dziś jest tylko „Zdejmij całą grafikę”) | CG Playout (TCP VizRS: `TAKE`/`CONTINUE`/`OUT`) + panel | K8 |
| I | **Wyzwalanie z automatyki** (REST, TCP/IP, GPI, VDCP) | REST już jest (`/api/live/*`); dodać webhook i alarm przy utracie sygnału, pustej ramówce, zatrzymanej emisji, długo zdjętej grafice | panel (banner, dźwięk) + CG Playout (webhook) | K12 |
| J | **Monitorowanie wszystkich kanałów** z jednego klienta (obraz NDI w Channel Deck) | mozaika podglądów (multiview) w „Na antenie”; uwaga: każdy podgląd to sesja Next, która transkoduje – limit albo miniatury | panel (`player.js`, `mux.js`) | K5 |

## 4. Jak pracować i tabela

Jak w [PLAN-rozbudowy.md](PLAN-rozbudowy.md) („Jak pracować”): jeden punkt = jedna sesja, kolejność od góry, warunki „gotowe”. Testy wg [PLAN-makieta.md](PLAN-makieta.md): `DEPLOY_SHOTS=<katalog poza repo> tests/deploy.sh` zielony, zrzut obejrzany, nowe przypadki w `tests/e2e.cjs` (sprawdzi je CI). Punkty oznaczone **CG** zmieniają API VizRS CG Playout – zasada „pakiet zawsze zgodny”: najpierw CG Playout (kod, testy kontraktu, DOKUMENTACJA §1 „Live API”), potem panel, w tym samym cyklu; starszy CG Playout nie może psuć panelu (brak pola = brak elementu UI).

| Punkt | Zakres | Wymaga | Stan |
|---|---|---|---|
| K1 | Numeracja kanałów naraz (panel) | – | do zrobienia |
| K2 | Własne rozdzielczości w Profilach (panel) | – | do zrobienia |
| K3 | Stan silnika Next (probe, wersja, możliwości sprzętu) w Profilach i Diagnostyce (panel) | – | do zrobienia |
| K4 | Kontrola ramówki: błędy na czerwono w Na antenie, EPG i Playoutach (panel) | – | do zrobienia |
| K5 | Mozaika kanałów (multiview) w Na antenie (panel) | K4 | do zrobienia |
| K6 | Import ramówki z pliku (CSV/XML) do playlisty legacy (panel) | – | do zrobienia |
| K7 | Warstwy i strony VizRS na antenie w karcie kanału (LUKI #22) (CG + panel) | – | do zrobienia |
| K8 | Ręczne TAKE / CONTINUE / OUT pojedynczej strony na kanale (CG + panel) | K7 | do zrobienia |
| K9 | Dziennik emisji (as-run) z eksportem CSV (CG + panel) | K7 | do zrobienia |
| K10 | Zdarzenia wtórne przypięte do audycji/kolekcji, oś pozycji z grafiką (CG + panel) | K7 | do zrobienia |
| K11 | Ważność (od–do) i zatwierdzanie stron promo (CG + panel) | K10 | do zrobienia |
| K12 | Alarmy: banner, dźwięk, webhook (panel; webhook w CG) | K4, K9 | do zrobienia |
| N0 | Decyzja legacy/Next (§6) – przegląd przed wydaniem 1.3 (decyzja użytkownika) | – | do decyzji |

## 5. Punkty

### K1 – numeracja kanałów naraz
Legacy: `ChannelNumbers.razor` – lista kanałów (`GetAllChannelsForSort`), przeciąganie lub wpisywanie numerów, zapis jednym `UpdateChannelNumbers`. Panel: przycisk „Numeracja” na ekranie Kanały, okno z tabelą (numer – pole, nazwa), kontrola duplikatów przed wysłaniem, błąd legacy w tostach. Wiersze w `bridge/commands.txt`; DOKUMENTACJA §4 (Kanały), §8 (lista pokrycia). Zamyka LUKI #23.

### K2 – własne rozdzielczości
Legacy: Settings → FFmpeg, sekcja rozdzielczości: `GetAllResolutions` (jest), `CreateCustomResolution` (nazwa, szerokość, wysokość), `DeleteCustomResolution` (tylko własne – `IsCustom`). Panel: lista na ekranie Profile kodowania pod wyborem rozdzielczości albo w Ustawieniach → FFmpeg. Zamyka LUKI #24.

### K3 – stan silnika Next
`GetNextVersion`, `GetNextDescribe`, `GetNextProbe`, `RefreshNextProbe` (legacy ≥ 26.12.0; starsze – brak komendy = brak sekcji). Profile kodowania: przy wybranej akceleracji „działa / nie działa i dlaczego”, kodeki dekodowania i kodowania sprzętowego (jak edytor profilu legacy 26.12.0). Diagnostyka: karta „Silnik Next” z wersją, akceptowanymi wersjami schematów (przydatne dla N0) i „Sprawdź ponownie”. Zamyka LUKI #11.

### K4 – kontrola ramówki
Na wzór kontroli playlisty Vizrt, tylko z danych, które panel już ma: `GetFuturePlayoutItemsById` (dziury między pozycjami, playout kończący się w ciągu < 24 h, kanał bez playoutu), `GetPlayoutWarningsCount`, pozycje z plikiem w koszu (`QuerySearchIndex…` `state:FileNotFound` dla pozycji w najbliższych 24 h), CG Playout `/api/live/state` (audycja LIVE w ramówce bez wejścia studia, zdjęta grafika). Wynik: lista „Uwagi” w Na antenie (jest – rozszerzyć), czerwone znaczniki pozycji w EPG i Playoutach z opisem w podpowiedzi. Licz w przeglądarce przy odświeżeniu ekranu, bez pętli w serwerze. Bez zapisu.

### K5 – mozaika kanałów
Na antenie: przełącznik „Mozaika” – siatka podglądów (`player.js`/`mux.js`), wyciszone, dźwięk tylko w wybranym. **Uwaga kosztowa:** każdy podgląd to sesja Next, która transkoduje (na Ampere A1 2 OCPU – może nie wystarczyć); domyślnie miniatury co N s zamiast wideo albo limit podglądów (opcja `VIZRS_LIVE_MULTIVIEW_MAX`, domyślnie 4) i ostrzeżenie. Wymaga K4 (ramka kanału na czerwono przy błędzie). DOKUMENTACJA §3 „UI”.

### K6 – import ramówki z pliku
Odpowiednik importu z systemu traffic. Plik CSV (kolumny: start, tytuł albo ścieżka pliku, długość) lub XML wgrany w przeglądarce, parsowany w JS. Dopasowanie pozycji do mediów legacy (`QuerySearchIndexAllItems` po ścieżce, potem po tytule), podgląd: dopasowane / niejednoznaczne / brak. Zapis jako **playlista legacy** (`CreatePlaylist`, `ReplacePlaylistItems` – są na liście) do użycia w harmonogramie. Bez zapisu plików na `/config` (decyzja R2). Godziny emisji wymusza harmonogram (pozycja „stała godzina”); dokładne godziny z pliku – patrz §6, opcja C (Scripted Schedule). Formaty Harris/Omnibus – nie w tym punkcie.

### K7 – warstwy VizRS na antenie (CG + panel)
CG Playout: w `/api/live/state` dla kanału `layers`: `[{layer, page, scene, since}]` – CG zna je z `STATE` VizRS (już woła je przy „Zdejmij grafikę”). Panel: pigułki „W10 · belka 101” w karcie kanału (makieta M2). Zamyka LUKI #22.

### K8 – TAKE / CONTINUE / OUT (CG + panel)
CG Playout: `POST /api/live/channels/<n>/take` `{page}`, `/continue` `{layer}`, `/out` `{layer}` → komendy TCP VizRS na antenie kanału, w tle z limitem czasu („grafika nigdy nie zatrzymuje emisji”), wpis w dzienniku z `X-Operator`. Panel: przy pigułkach z K7 „Dalej”/„Zdejmij”, a w karcie kanału „Wprowadź stronę…” (lista z `/etv/pages`) – odpowiednik Quick Take. Ręcznie wprowadzona strona ma pierwszeństwo przed regułą do czasu zdjęcia (do ustalenia w CG).

### K9 – dziennik emisji (as-run) (CG + panel)
CG Playout zapisuje start i koniec każdej pozycji kanału (z danych szablonu ErsatzTV), wprowadzone i zdjęte strony, przejęcia live (ZDEJMIJ/WPUŚĆ), zdjęcie całej grafiki. Plik JSONL z rotacją jak `log.jsonl`, `GET /api/live/asrun?channel=&from=&to=`. Panel: ekran „Dziennik emisji” (filtr kanału i dnia, tabela), eksport CSV w przeglądarce. Odpowiednik Run Status + raportu emisji dla reklamodawców.

### K10 – zdarzenia wtórne (CG + panel)
Dziś reguły grafiki są ogólne (każda pozycja, przerwa, slot). Dodać regułę z celem: konkretna audycja (tytuł), kolekcja albo ID pozycji legacy, z listą zdarzeń `{page, offset_s od startu|końca, duration_s, values}` – kilka zdarzeń na jedną pozycję („Za chwilę” 30 s przed końcem, belka tytułowa po 10 s). Walidacja w CG (nakładające się warstwy = błąd, jak w Vizrt). Panel: w karcie pozycji (EPG, Playouty) oś pozycji z zaplanowanymi zdarzeniami i „Dodaj zdarzenie”.

### K11 – ważność i zatwierdzanie stron promo (CG + panel)
Reguła/zdarzenie dostaje `valid_from`, `valid_to` i `approved` (bool, kto, kiedy); CG pomija niezatwierdzone i przeterminowane. Panel: pigułki „czeka na zatwierdzenie” / „wygasa jutro”, filtr. Wzór: VCB 5.4 (Planning → MCR, TTL stron kampanii).

### K12 – alarmy
Panel (przeglądarka): banner i opcjonalny dźwięk, gdy K4 znajdzie błąd w najbliższych 15 min, slot LIVE bez sygnału, emisja kanału zatrzymana, grafika zdjęta > N min. Webhook (poza przeglądarką) – w CG Playout, który i tak ma pętlę zdarzeń; opcja `VIZRS_ALERT_WEBHOOK` po stronie CG. Wymaga K4 i K9 (źródło zdarzeń).

## 6. Legacy czy Next – opcje

### Stan faktyczny (2026-11-09)

- Od **legacy v26.12.0** silnik nadawania legacy jest usunięty: **wszystkie kanały nadaje już ErsatzTV Next** (legacy przenosi kanały przy starcie, adresy `ts-legacy`/`hls-direct` przekierowuje). VizRS Live **już korzysta z Next** – legacy jest dla niego planistą, bazą, skanerem i dostawcą EPG.
- **Next 0.2.5** (Rust, MIT, przed 1.0 – `0.B` = zmiana niezgodna) z założenia **nie** ma bibliotek, metadanych, harmonogramów ani tworzenia playoutów; **nie ma API zarządzania** – tylko pliki JSON z wersją (`lineup.json`, `channel.json`, katalog playoutu `{start}_{finish}.json`, wczytywany ponownie po zmianie) i HTTP: `/channel/{plik}` (HLS), `/channels.m3u`, `/xmltv.xml` (XMLTV z plików, które pisze planista). Bez uwierzytelniania. HDHomeRun, logo i okładki EPG, Plex/Jellyfin/Emby – tylko w legacy.
- Mocne strony Next dla VizRS: źródło **`dynamic`** (pozycja rozwiązywana zapytaniem HTTP w chwili emisji), źródła `http`/`rtsp` z `is_live`, **warstwy grafiki** w playoucie (`graphics[]`, w tym `canvas` – wideo z alfą z HTTP z nagłówkami offsetu; tak legacy podaje elementy graficzne, a CG Playout element „script” VizRS), **fallback** z obrazem tła i opisem błędu, `describe --probe`.

### Opcje

| | A. Zostać na legacy (stan obecny) | B. Porzucić legacy: VizRS jako planista dla Next | C. Hybryda: legacy zostaje, VizRS przejmuje wybrane kanały lub ramówki |
|---|---|---|---|
| Co robimy | nic nowego; most i panel jak dziś, plan K1–K12 | piszemy: bazę mediów i skaner (ffprobe), kolekcje, harmonogramy/bloki/wypełniacze, budowanie playoutu, XMLTV, uruchamianie `ersatztv`, proxy z autoryzacją | C1: kanały „traffic” (ramówka z pliku, Vizrt-owe zdarzenia) jako **osobny lineup Next** obok legacy; C2: ramówka z pliku wewnątrz legacy przez **Scripted Schedule** (playout `Scripted`, skrypt woła `add_*`, `wait_until_exact`, `pad_until_exact`, `graphics_on/off`) |
| Koszt | najniższy | bardzo wysoki – w praktyce przepisanie legacy (~157 tys. linii C# według PLAN-vizrs-live §4); odrzucone 2026-11-06 | C1 średni (planista tylko „lista pozycji z pliku → playout JSON + XMLTV”, bez bibliotek); C2 niski–średni (skrypt na `/config` – LUKI #14) |
| Zyski | pełne funkcje legacy (biblioteki, Plex/Jellyfin/Emby, bloki, deco, EPG, HDHR) | jeden język (Rust), brak .NET (pamięć na Ampere A1: dziś sterta legacy 1,5 GB), brak zależności od wewnętrznych komend legacy, pełna kontrola nad zdarzeniami wtórnymi i as-run, LIVE przez `dynamic`/`http is_live` bez nakładki `vizrs-ffmpeg` | dokładne godziny emisji z traffic (jak Vizrt) bez przepisywania legacy; C1 – grafika i LIVE natywnie w playoucie Next (`graphics[]`, `dynamic`) |
| Ryzyka | most na komendach wewnętrznych: każde wydanie legacy (co tydzień) = test (`commandsMissing`, e2e); .NET na Ampere | Next przed 1.0 (zmiany niezgodne co kilka tygodni: 0.2.0 → 0.2.5 w miesiąc), bez API i bez autoryzacji; utrata Plex/Jellyfin/Emby, HDHR; ogromna praca, zanim panel znów zrobi to, co dziś | C1: dwa lineupy (dwa M3U/XMLTV, scalanie w proxy), własny ErsatzTV-ffmpeg i obraz Next do utrzymania; C2: Scripted Schedule to API publiczne legacy, ale skrypt na wolumenie łamie decyzję R2 (zgoda potrzebna) |

### Zalecenie

1. **Teraz: A.** Porzucenie legacy (B) nie ma uzasadnienia, dopóki Next jest przed 1.0 i nie ma API – zostałoby nam pisanie wszystkiego, co legacy robi dobrze. Next i tak już nadaje.
2. **Przygotować drogę do C, nie do B:** K3 (stan Next, akceptowane wersje schematów), K7–K10 (model zdarzeń i as-run po stronie CG Playout – niezależny od tego, kto planuje). Te prace przydadzą się w każdej opcji.
3. **N0 – przegląd przed wydaniem 1.3** (decyzja użytkownika): jeśli potrzebny jest kanał z ramówką z systemu traffic co do sekundy, najpierw **C2** (Scripted Schedule w legacy; wymaga zgody na skrypt na `/config` – LUKI #14), a **C1** dopiero wtedy, gdy C2 nie wystarczy. **B** wrócić do rozważenia, gdy Next wyda 1.0 z API zarządzania albo legacy przestanie być rozwijane (sygnał: brak wydań > 2 miesiące, baner końca wsparcia).
4. Niezależnie od decyzji: CG Playout może sprawdzić, czy element graficzny legacy z warstwą `canvas` Next zastąpi nakładkę `vizrs-ffmpeg` (PLAN-vizrs-live §4, „Na później”) – to praca w repo CG Playout, poza tym planem.

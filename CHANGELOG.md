# Zmiany

## Niewydane

- **Harmonogramy – pełna edycja** (R1): lista z kanałami, które używają harmonogramu; ustawienia (godziny stałe, tasowanie, losowy start, części odcinków, kolekcje jak seriale); nowy, kopiuj, usuń z potwierdzeniem (wymienia kanały, których playouty legacy usunie kaskadowo); **edytor pozycji**: start dynamiczny/o stałej godzinie, treść (wybór treści), kolejność odtwarzania zależna od rodzaju treści, maraton, tryb (wypełnij / jedna / kilka + liczba albo tryb / przez czas + reszta czasu + próby dopasowania), wypełnianie grupami, tytuł własny, tryb przewodnika, wypełniacze pre/mid/post/ogon/zapasowy, znaki wodne i elementy graficzne, preferencje audio i napisów; kopiowanie pozycji. Ustawienia i pozycje zapisuje jeden „Zapisz” (pozycje jednym `ReplaceProgramScheduleItems`); błąd legacy pokazany z polskim wstępem.
- **Most: abstrakcyjne typy legacy serializowane po typie rzeczywistym** – wcześniej pozycje harmonogramu (`GetProgramScheduleItems`) traciły pola podtypów (liczba trybu „kilka”, czas, reszta czasu, próby dopasowania), więc zapis z panelu skasowałby je w legacy.
- `crudView`: `loadOne` (dane zaznaczonej pozycji), `below` (panel pod edytorem), `beforeSave`/`afterSave`; `itemsEditor`: `commit()` (zatwierdza otwarty panel boczny przed zapisem) i kopiowanie wiersza (`copy`).
- Biała lista: `GetProgramScheduleById`, `UpdateProgramSchedule`, `CopyProgramSchedule`, `DeleteProgramSchedule`, `GetProgramScheduleItems`.
- e2e: harmonogram z dwiema pozycjami (06:00 „wypełnij” + dynamiczna „kilka”), zmiana kolejności, zapis, ponowne otwarcie, błąd walidacji legacy, kopia, usunięcie.
- **UI w modułach ES** (R0): `core.js`, `form.js`, `parts.js`, `views/<grupa menu>.js` zamiast jednego `app.js`; test serwera, że każdy plik ze `STATIC` jest podawany i każdy `import` wskazuje plik ze `STATIC`.
- **Formularz z metadanych komend** (`form.js`): kontrolki z typów parametrów mostu (tekst, liczba, tak/nie, wyliczenie, `TimeSpan`, data/godzina, wybór id, lista id), sekcje, pola warunkowe, opis złego pola.
- **Wspólne części ekranów** (`parts.js`): „lista + edytor” (Kanały przepisane na ten wzorzec bez zmiany zachowania; „Kanał lustrzany” widoczny tylko dla źródła Mirror), edytor listy pozycji, wybór treści z wyszukiwaniem w legacy (w Diagnostyce: pola treści do konsoli komend).
- Ekrany, którym brakuje komend na białej liście mostu, mówią, której komendy brakuje, zamiast pokazywać pusty ekran.
- Biała lista: `GetPlaylistsByPlaylistGroupId`, `SearchCollections`, `SearchSmartCollections`, `SearchMultiCollections`, `SearchTelevisionShows`, `SearchTelevisionSeasons`, `SearchArtists`.
- Testy: `tests/gate.sh` (cała bramka jednym poleceniem), `tests/stack.sh test` (e2e, Playwright z `tests/local.env`) i `reset`; `seed` nie dubluje danych przy ponownym uruchomieniu.
- `scripts/plan.sh`: automat planu rozbudowy – punkt po punkcie, każdy w nowej sesji Claude Code bez operatora, z niezależną kontrolą bramką.
- e2e: pole warunkowe i wyliczenia formularza, wybór treści (wynik, brak wyników, brakująca komenda, zapytanie), edytor listy pozycji; każda odpowiedź HTTP ≥ 400 w trakcie testu jest błędem.

## 0.1.0 – prototyp (2026-11-06)

- **VizRS Bridge** (C#): most REST w procesie niezmienionego ErsatzTV legacy (hak startowy + hosting startup), ogólny dyspozytor komend MediatR z białą listą, zadania w tle przez kolejkę legacy, wyniki `Either`/`Option` jako `{ok, result | error}`.
- **vizrs-live** (Rust, bez zależności): UI panelu, token panelu z ciasteczkiem, ochrona CSRF nagłówkiem, pośrednik do mostu, `/health` i `--healthcheck`.
- **Panel**: Na antenie, EPG, Kanały (pełna edycja), Playouty (przebudowa), widoki odczytu dla profili, znaków wodnych, bibliotek, kolekcji, playlist, wypełniaczy, harmonogramów, bloków, deco i elementów graficznych, Ustawienia, Diagnostyka z konsolą komend.
- Obrazy Docker (`vizrs-live-legacy`, `vizrs-live`), `compose.yml`, stos testowy `tests/stack.sh` (smoke + ramówka przez panel), e2e `tests/e2e.cjs`.
- Sprawdzone z ErsatzTV legacy v26.11.6: kanał zbudowany przez panel nadaje przez Next (HLS, H.264 1080p + AAC).

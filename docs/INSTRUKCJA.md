# VizRS Live – instrukcja operatora

Dla osoby, która prowadzi kanał na co dzień. Wdrożenie i administracja: [RUNBOOK.md](RUNBOOK.md); szczegóły techniczne: [DOKUMENTACJA.md](DOKUMENTACJA.md).

Web GUI ErsatzTV legacy **nie jest potrzebne** i jest zamknięte – wszystko robi się w panelu.

## 1. Wejście do panelu

1. Otwórz `http://<serwer>:8090/` (adres poda administrator).
2. Wpisz **token panelu** (`VIZRS_LIVE_TOKEN`) i „Zaloguj”. Sesja trwa 30 dni w tej przeglądarce; „wyloguj” = wyczyść ciasteczka strony.
3. Po 10 nieudanych próbach w ciągu minuty panel przez minutę nie przyjmuje logowania („za dużo nieudanych logowań”) – odczekaj.

Pasek górny: stan mostu do legacy (zielony = działa) i licznik playoutów z błędem budowy (klik → Playouty).

## 2. Codzienna praca

| Chcę… | Ekran | Jak |
|---|---|---|
| zobaczyć, co leci teraz i dalej | **Na antenie** | teraz / następnie z postępem, najbliższe pozycje każdego kanału |
| sprawdzić przewodnik | **Przewodnik EPG** | oś 4 h wszystkich kanałów |
| dodać / zmienić kanał | **Kanały** | „+ Nowy kanał”, formularz, „Załóż kanał”; zmiana → „Zapisz”; logo: wgraj obraz albo podaj adres |
| dodać nowe pliki | **Biblioteki** → „Skanuj” | pliki muszą leżeć w katalogu mediów serwera; po skanie widać je w **Przeglądarce** |
| zgrupować treść | **Kolekcje** (zwykłe, inteligentne, wielo-, powtórki), **Playlisty** | treść dobiera się „wyborem treści” z wyszukiwaniem |
| ułożyć ramówkę klasyczną | **Harmonogramy** | pozycje: start stały (godzina) albo dynamiczny, tryb (jedna, kilka, czas, do pełna), treść; „Zapisz” zapisuje całą listę |
| ułożyć ramówkę blokową | **Bloki i szablony**, **Wystrój (deco)**, potem **Playouty** → kalendarz tygodnia | blok = treść na N minut; szablon dnia = bloki o godzinach; kalendarz = szablony na dni |
| podpiąć ramówkę do kanału | **Playouty** → „+ Playout” | rodzaj, kanał (tylko bez playoutu), harmonogram; potem „Przebuduj” |
| przerwy, wypełnienie | **Wypełniacze**, **Znaki wodne** | |
| grafika i studio na żywo | **Grafika kanału**, **Sloty na żywo** | wymaga VizRS CG Playout; **ZDEJMIJ** zdejmuje studio z anteny (z potwierdzeniem), **WPUŚĆ** wpuszcza |

### Przebudowa ramówki

Zmiana harmonogramu, bloków, szablonów, kalendarza czy deco **nie zmienia od razu tego, co już zaplanowane**. Po zmianie:

- **Przebuduj** (Na antenie albo Playouty) – dobudowuje i odświeża przyszłe pozycje; to wystarcza zwykle;
- **Od nowa** – kasuje zaplanowane pozycje i układa wszystko jeszcze raz (np. po dużej przebudowie ramówki; kanał „przeskoczy”);
- **Resetuj wszystkie** (Playouty) – „Od nowa” dla wszystkich kanałów, z potwierdzeniem.

Przebudowa idzie w tle legacy – po kilku sekundach odśwież Na antenie / EPG.

### Usuwanie

Każde usunięcie pyta o potwierdzenie i mówi, co jeszcze zniknie (np. usunięcie harmonogramu usuwa playouty kanałów, które go używają).

### Komunikaty

Czerwony komunikat „legacy odrzucił: …” to odmowa ErsatzTV legacy z jego tekstem po angielsku (np. „Channel number must be unique”) – popraw pole i zapisz jeszcze raz. Nic nie zostało zapisane.

## 3. Awarie – co zrobić

| Objaw | Co zrobić |
|---|---|
| pasek: most **czerwony**, ekrany puste | legacy nie działa albo się restartuje (start trwa do minuty). Odczekaj; dalej czerwony → **Diagnostyka** (komunikat błędu) i administrator (RUNBOOK „Awarie”) |
| licznik ostrzeżeń playoutów > 0 | **Playouty** – kanał z błędem budowy; zwykle pusta kolekcja albo brak treści w harmonogramie. Popraw, „Przebuduj” |
| kanał nie gra / czarny obraz | **Diagnostyka** → test odtwarzania (odnośnik HLS/TS kanału); **Logi** (próg Warning/Error); sprawdź, czy kanał ma playout i pozycje na **Na antenie** |
| brak nowych plików | **Biblioteki** → „Skanuj”; plik w katalogu, którego biblioteka nie obejmuje, nie pojawi się |
| EPG puste u widzów | „Przebuduj”; XMLTV pokazuje tylko zbudowane dni (Ustawienia → przewodnik XMLTV) |
| „wymaga komendy X na białej liście mostu” | wersja mostu nie zna funkcji – administrator |
| „za dużo nieudanych logowań” | odczekaj minutę, wpisz token ponownie |
| studio nie wchodzi na antenę | **Sloty na żywo**: czy jest sygnał, czy kanał nie jest WSTRZYMANY (WPUŚĆ) |

Zawsze przy zgłoszeniu do administratora: godzina, kanał, treść komunikatu (albo zrzut ekranu).

# Współpraca agentów: Claude i Gemini

Zasady podziału pracy między Claude Code i Gemini CLI w tym repozytorium. Cel: tokeny Claude idą na myślenie i kod, a zadania lekkie i wykonawcze (dokumentacja, kompilacja, długie wyjścia) bierze Gemini.
Zasady ogólne repozytorium są w [../CLAUDE.md](../CLAUDE.md) i obowiązują obu agentów. Ten plik dodaje tylko podział ról.

## 1. Role

| | **Claude – dowódca** | **Gemini – wykonawca** |
|---|---|---|
| Decyzje | planuje, wybiera rozwiązanie, ustala zakres zadania, rozstrzyga wątpliwości | nie podejmuje decyzji projektowych; przy wątpliwości pyta w raporcie |
| Kod | **jedyny, który pisze i zmienia kod** | **nie pisze i nie zmienia kodu**, nawet „małej poprawki” |
| Dokumentacja | wyznacza, co i gdzie opisać; przegląda wynik | pisze i redaguje tekst `.md` według zlecenia |
| Kompilacja, testy | zleca, czyta raport, naprawia | uruchamia, streszcza wynik, wskazuje miejsce błędu |
| Commit | przegląda zmiany, robi commit (na prośbę użytkownika) | nie commituje, nie pushuje, nie taguje |

**Ostatnie słowo ma Claude** (a nad nim użytkownik). Wynik Gemini jest propozycją, dopóki Claude go nie przejrzy.

## 2. Co jest kodem (tylko Claude)

Kodem jest wszystko, co wpływa na działanie albo budowanie, w tym:

- `server/**` (`*.rs`, `Cargo.toml`, `server/web/*.js|html|css`),
- `bridge/**` (`*.cs`, `*.csproj`) i **`bridge/commands.txt`** – biała lista to granica bezpieczeństwa,
- `tests/**` (`*.sh`, `*.cjs`), `scripts/**`,
- `docker/**`, `compose.yml`, `.env.example`, `.github/workflows/**`,
- reguły pracy agentów: `CLAUDE.md`, `GEMINI.md`, ten plik,
- plany w `docs/plany/` (to decyzje projektowe).

Gemini może te pliki **czytać**. Gdy zobaczy w nich błąd, opisuje go w raporcie (`plik:wiersz`, objaw, propozycja słowami) – nie wysyła łatki.

## 3. Co może Gemini

| Zadanie | Zakres |
|---|---|
| Dokumentacja | `docs/DOKUMENTACJA.md`, `docs/INSTRUKCJA.md`, `docs/RUNBOOK.md`, `docs/STATUS.md`, `docs/LUKI.md`, `docs/README.md`, `README.md`, `CHANGELOG.md` – tylko pliki wskazane w zleceniu, zgodnie z „Gdzie co opisywać” w `CLAUDE.md` |
| Kompilacja i bramka | `cargo build`, `cargo fmt --check`, `cargo clippy`, `cargo test`, `tests/gate.sh`, `tests/stack.sh up|seed|test|down` – uruchomić i streścić; **bez** `cargo fmt` zapisującego pliki |
| Długie wyjścia | streszczenie logów, wyników testów, `docker logs` stosu testowego |
| Wyszukiwanie | przegląd źródeł legacy (klon poza repo), `GET /api/commands` mostu testowego, grep po repo – raport z odnośnikami `plik:wiersz` |
| Kontrola tekstu | spójność dokumentacji z kodem (np. tabela ekranów §4 a `server/web/views/`), literówki, martwe odnośniki – zmiany tylko w `.md` z listy wyżej |
| Zrzuty UI | uruchomienie `E2E_SHOTS=<katalog poza repo> tests/stack.sh test` i opis tego, co widać |

Zawsze obowiązuje: produkcji nie ruszać (`virtrs-*`, port 8409), żadnego `docker compose` produkcji, `git push`, tagów ani zapisów w `etv-config/`.

## 4. Kiedy Claude zleca, a kiedy robi sam

Tokeny Claude zużywa to, co trafia do jego kontekstu (i jest potem ponownie wysyłane w każdym kolejnym kroku sesji), oraz tekst, który Claude pisze. Najtańszy jest więc **filtr w powłoce**, nie agent.

**Logi zawsze przez plik i filtr (Claude, bez Gemini):**

```bash
tests/gate.sh > "$S/gate.log" 2>&1; echo "kod: $?"; tail -3 "$S/gate.log"    # zielono: wystarczy kod i ogon
grep -n -A3 '^error\|^warning\|FAIL\|nie ok' "$S/gate.log" | head -80          # czerwono: same błędy
```

Do kontekstu trafia tylko kod wyjścia, ogon albo odfiltrowane błędy – nigdy cały log. Błędy kompilacji i testów Claude czyta sam (i tak musi zobaczyć każde miejsce, żeby je poprawić), streszczenie „pierwszy błąd” nie wystarcza.

**Zlecaj Gemini**, gdy zadanie daje dużo tekstu przy małej liczbie decyzji i nie da się go zastąpić filtrem:

- **proza dokumentacji** do gotowej zmiany kodu (Claude podaje fakty, Gemini pisze, Claude przegląda tylko diff) – oszczędza drogie tokeny wyjściowe Claude,
- **przeszukiwanie dużych źródeł**, gdy Claude musiałby czytać dziesiątki plików (np. źródła legacy: `*.razor`, `Commands|Queries/*.cs`) – raport ze ścisłym formatem,
- **długie logi bez struktury**, których nie da się sensownie przefiltrować (`docker logs`, ślady Playwrighta) – Claude zapisuje log do pliku, Gemini tylko czyta.

**Rób sam**, gdy:

- wystarczy jedno, dwa wywołania narzędzi albo `grep` po repo (zlecenie, czekanie i przegląd kosztują więcej),
- trzeba zdecydować (projekt, bezpieczeństwo, biała lista, kształt API),
- wynik trafia do kodu.

**Pomiar (2026-11-07, `agy`, ok. 3,3 znaku na token):**

| Zadanie | Claude sam, cały wynik | Przez Gemini | Claude sam, z filtrem |
|---|---|---|---|
| bramka zielona (64 s) | 11,6 KB ≈ 3,5 tys. tok. | ≈ 300 tok. (zlecenie + raport) | `tail -3`: ≈ 15 tok. |
| clippy czerwony (14 błędów po zmianie sygnatury) | 7,7 KB ≈ 2,3 tys. tok. | streszczenie niewystarczające do poprawki | `grep -A2 '^error'`: ≈ 450 tok. |
| zgodność DOKUMENTACJA §4 z `VIEWS` | 1 wywołanie, ≈ 1,4 tys. tok., ~1 s | raport ≈ 1,5 tys. tok., **263 s**, 13 z 14 wierszy to szum | – |

Wniosek: przy logach filtr jest tańszy od zlecenia. Zysk z Gemini to proza dokumentacji i duże przeszukiwania – rzędu kilku procent tokenów sesji. Każde zlecenie ma koszt stały (ten plik ≈ 2,4 tys. tok., zlecenie, przegląd diffu) i trwa od 10 s do kilku minut. Raport sprawdzaj wyrywkowo – bywa zaszumiony.

## 5. Zlecenie (Claude → Gemini)

„Gemini” to **Antigravity CLI** (`agy`, sprawdzone na 1.5.3, domyślny model Gemini 3.8 Flash High), zainstalowany w `~/.gemini/bin/agy` i **nie ma go w `PATH`**. Działa na koncie Google użytkownika. Claude uruchamia `agy` bez trybu interaktywnego (`-p`) z katalogu repozytorium.

**Gemini CLI (`gemini`) nie używamy.** Od 2026-06-18 Google nie obsługuje w nim kont prywatnych (darmowe, AI Pro, AI Ultra – logowanie kończy się `UNSUPPORTED_CLIENT`); zostały tylko płatne klucze API z przedpłatą. Decyzja użytkownika (2026-11-07): korzystamy wyłącznie z wykupionej subskrypcji Google, bez dopłat i kredytów API – więc jedynym wykonawcą jest `agy`. Modele w subskrypcji: `agy models` (m.in. `gemini-3.8-flash-high|medium|low`); wybór na sesję: `--model <id>`. Streszczenia i proste raporty: `--model gemini-3.8-flash-low` (pomiar: ten sam poprawny wynik, 10,5 s zamiast 25,4 s na High); proza dokumentacji i przeszukiwanie źródeł: domyślny High.

```bash
A=~/.gemini/bin/agy
S=<scratchpad Claude>

# 1. streszczenie – Claude sam uruchamia polecenie, Gemini tylko czyta log (tryb plan: bez zapisu)
tests/gate.sh > "$S/gate.log" 2>&1; echo "kod: $?"
$A --mode plan --add-dir "$S" --print-timeout 300s \
   -p "Przeczytaj $S/gate.log (wynik bramki). Streść w max 10 wierszach: kroki, pierwszy błąd (plik:wiersz, komunikat)."

# 2. redakcja dokumentacji – zapis plików bez pytania, powłoka zablokowana
$A --mode accept-edits --print-timeout 300s -p "$(cat "$S/zlecenie.md")"

# 3. Gemini uruchamia polecenie – zezwolenie tylko na tę sesję i tylko na to dokładne polecenie
$A --mode accept-edits --print-timeout 600s \
   --settings '{"permissions":{"allow":["command(cargo fmt --check --manifest-path server/Cargo.toml)"]}}' \
   -p "Uruchom dokładnie, bez cd: cargo fmt --check --manifest-path server/Cargo.toml. Raport: kod wyjścia, pierwszy błąd."
```

Co ustalono w próbach (2026-11-07):

- **Importy `@plik` w `GEMINI.md` nie są rozwijane.** `agy` wczytuje sam `GEMINI.md`; `CLAUDE.md` i ten plik musi przeczytać narzędziem – dlatego `GEMINI.md` każe to zrobić na początku i zawiera najważniejsze zakazy wprost.
- **Stdin jest ignorowany** (`-p … < log` daje „stdin jest pusty”). Log przekazuj jako plik do przeczytania (wzór 1, katalog spoza repo przez `--add-dir`) albo wklej do treści promptu, gdy jest krótki.
- **Kolejność przełączników:** `-p` bierze następny argument jako prompt, więc stawiaj go na końcu (albo `-p='…'`).
- **Powłoka w trybie `-p` jest domyślnie zablokowana** – każde polecenie odrzucane bez pytania. Zezwolenie daje `--settings` z regułą `command(<polecenie>)`; działa przy **dokładnie** tym samym tekście polecenia (bez `cd … &&`). Zezwolenia nie zapisuj na stałe w ustawieniach `agy`.
- **`--dangerously-skip-permissions` nie używamy** (to odpowiednik `--yolo`).
- W `accept-edits` prośba o zmianę `server/src/main.rs` skończyła się odmową i zleceniem dla Claude (§8) – plik nietknięty. To zachowanie modelu, nie blokada narzędzia, dlatego przegląd z §7 jest obowiązkowy.
- Jedno zlecenie trwa ok. 10–35 s.

Zlecenie zawiera zawsze:

1. **Cel** – jedno zdanie.
2. **Pliki, które wolno zmienić** – jawna lista (dla zadań „tylko raport”: „żadnych”).
3. **Fakty** – co zmieniło się w kodzie (commit, diff, `plik:wiersz`); Gemini nie zgaduje działania, opisuje to, co podał Claude albo co wyczytał z kodu.
4. **Warunek „gotowe”** i **format raportu** (długość, odnośniki `plik:wiersz`).

## 6. Raport (Gemini → Claude)

Krótko, po polsku:

- co zrobione; zmienione pliki,
- wynik poleceń: kod wyjścia, skrót, pierwszy błąd z `plik:wiersz` i dosłownym komunikatem (nie cały log),
- czego nie zrobiono i dlaczego; pytania do Claude.

Bez powtarzania zlecenia i bez prozy wokół wyniku.

## 7. Przegląd po zleceniu (Claude)

- Przed zleceniem zapisz migawkę `git status --porcelain` – drzewo robocze często ma niezacommitowaną pracę.
- Po zleceniu porównaj z migawką: zmienione mogą być tylko pliki ze zlecenia. Zmianę w kodzie albo w nieprzewidzianym pliku przejrzyj i usuń ręcznie; **nie** cofaj na ślepo `git checkout`/`git restore` (zniszczyłoby cudzą pracę w tym samym pliku).
- Przejrzyj `git diff` dokumentacji: zgodność z kodem, zasady z `CLAUDE.md` (opis działania tylko w `DOKUMENTACJA.md`, nie w README ani planach).
- Wynik bramki z raportu przy commicie potwierdź – ostatni przebieg przed commitem musi być zielony.

## 8. Sesja Gemini uruchomiona przez użytkownika

Gdy użytkownik pracuje z Gemini bezpośrednio, obowiązuje ten sam podział. Na prośbę o zmianę kodu Gemini odmawia i zamiast tego przygotowuje **zlecenie dla Claude**: cel, pliki, fakty (`plik:wiersz`), warunek „gotowe” – do wklejenia w sesję Claude Code. Dokumentację, kompilację i testy wykonuje sam, wg §3.

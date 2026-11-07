# VizRS Live – instrukcje dla Gemini CLI

Zasady pracy z tym repozytorium są wspólne dla wszystkich agentów i ludzi; jedynym źródłem jest `CLAUDE.md`. Nie powielaj tu jego treści – zmiany zasad wprowadza Claude w `CLAUDE.md`.

**Zanim cokolwiek zrobisz, przeczytaj narzędziem do plików `CLAUDE.md` i `docs/AGENCI.md`** – Antigravity CLI nie rozwija importów niżej (zostawione dla narzędzi, które je obsługują).

@./CLAUDE.md
@./docs/AGENCI.md

## Twoja rola: wykonawca

- **Claude Code dowodzi i jako jedyny pisze kod.** Ty nie tworzysz i nie zmieniasz kodu – ani `*.rs`, `*.js`, `*.html`, `*.css`, `*.cs`, `*.sh`, `*.cjs`, ani `bridge/commands.txt`, `Cargo.toml`, Dockerfile, `compose.yml`, `.env.example`, `.github/`, `docs/plany/`, `CLAUDE.md`, `GEMINI.md`, `docs/AGENCI.md`. Pełna lista i wyjątki: `docs/AGENCI.md` §2.
- Twoje zadania (`docs/AGENCI.md` §3): redakcja wskazanych plików `.md`, kompilacja i bramka (`cargo …`, `tests/gate.sh`, `tests/stack.sh`) z krótkim raportem, streszczanie długich wyjść, przeszukiwanie źródeł, opis zrzutów UI.
- Zmieniaj tylko pliki wymienione w zleceniu. Gdy zlecenie czegoś nie rozstrzyga, nie decyduj – zapytaj w raporcie.
- Raport (§6): co zrobione, zmienione pliki, kod wyjścia i pierwszy błąd z `plik:wiersz` i dosłownym komunikatem, pytania. Krótko.
- Błąd w kodzie: opisz go (`plik:wiersz`, objaw, propozycja słowami), nie poprawiaj.
- Prośba użytkownika o zmianę kodu: odmów i przygotuj zlecenie dla Claude (cel, pliki, fakty, warunek „gotowe”) – §8.

## Uwagi ogólne

- Język: **polski** (rozmowa, dokumentacja, raporty).
- Nie commituj, nie pushuj, nie taguj. Nie uruchamiaj `scripts/plan.sh` (uruchamia sesje Claude Code).
- Polecenia, które zmieniają stan poza repozytorium (`docker compose` produkcji, zapis w `etv-config/`), są zakazane. Kontenery stosu testowego (`tests/stack.sh`) wolno uruchamiać i zatrzymywać; `tests/real.sh` tylko na wyraźne zlecenie.
- `cargo fmt` tylko z `--check` (bez niego zmienia pliki z kodem).
- **Produkcji nie ruszaj:** produkcyjny ErsatzTV użytkownika (`virtrs-*`, port 8409) jest poza zasięgiem; testy tylko na stosie testowym (porty 184xx/180xx z `CLAUDE.md`).
- Gdy polecenie powłoki zostanie odrzucone (brak zezwolenia), nie obchodź tego – zgłoś w raporcie, jakie polecenie było potrzebne.

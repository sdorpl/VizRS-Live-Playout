# VizRS Live

Panel kanału nad **ErsatzTV legacy** (rodzina VizRS). Cel: operator w ogóle nie korzysta z web GUI legacy; logika zostaje w legacy, VizRS Live ją pokazuje i nią steruje przez most w procesie legacy.
Plan i decyzje: `../VizRS CG System/docs/plany/PLAN-vizrs-live.md`. Opis działania: [docs/DOKUMENTACJA.md](docs/DOKUMENTACJA.md).

Język pracy, dokumentacji, komentarzy i UI: **polski**.

## Zasady

- **Legacy bez zmian.** Nie forkujemy ErsatzTV i nic do niego nie zgłaszamy. Most ładuje się przez `DOTNET_STARTUP_HOOKS` + `ASPNETCORE_HOSTINGSTARTUPASSEMBLIES`. Żadnych zapisów wprost do bazy legacy.
- **C# tylko w moście** (`bridge/`), jak najmniej: ogólny dyspozytor. Nowa funkcja panelu = wiersz w `bridge/commands.txt` + kod w Ruście/JS, nie nowy kod C#.
- **Serwer bez zależności** (`server/Cargo.toml` bez `[dependencies]`), UI w czystym JS bez bibliotek i CDN; tekst do DOM tylko przez `textContent` (dane z legacy są obce), bez stylów i skryptów inline (CSP).
- Nowy plik w `server/web/` → dopisz do `STATIC` w `server/src/main.rs`.
- Testy ręczne tylko na stosie testowym (`tests/stack.sh`, porty 18409/18090) – nie ruszaj produkcyjnego ErsatzTV użytkownika (`virtrs-*`, port 8409).
- Dokumentacja razem z kodem: zmiana zachowania → `docs/DOKUMENTACJA.md` + `CHANGELOG.md` (Niewydane).

## Bramka przed commitem

```bash
(cd server && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo build --release)
tests/stack.sh up && tests/stack.sh seed
PLAYWRIGHT_DIR=… node tests/e2e.cjs
```

Commit i push tylko na prośbę użytkownika; pliki dodawaj jawnie.

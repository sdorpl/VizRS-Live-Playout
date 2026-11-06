# Zmiany

## Niewydane

## 0.1.0 – prototyp (2026-11-06)

- **VizRS Bridge** (C#): most REST w procesie niezmienionego ErsatzTV legacy (hak startowy + hosting startup), ogólny dyspozytor komend MediatR z białą listą, zadania w tle przez kolejkę legacy, wyniki `Either`/`Option` jako `{ok, result | error}`.
- **vizrs-live** (Rust, bez zależności): UI panelu, token panelu z ciasteczkiem, ochrona CSRF nagłówkiem, pośrednik do mostu, `/health` i `--healthcheck`.
- **Panel**: Na antenie, EPG, Kanały (pełna edycja), Playouty (przebudowa), widoki odczytu dla profili, znaków wodnych, bibliotek, kolekcji, playlist, wypełniaczy, harmonogramów, bloków, deco i elementów graficznych, Ustawienia, Diagnostyka z konsolą komend.
- Obrazy Docker (`vizrs-live-legacy`, `vizrs-live`), `compose.yml`, stos testowy `tests/stack.sh` (smoke + ramówka przez panel), e2e `tests/e2e.cjs`.
- Sprawdzone z ErsatzTV legacy v26.11.6: kanał zbudowany przez panel nadaje przez Next (HLS, H.264 1080p + AAC).

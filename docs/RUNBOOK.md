# VizRS Live – runbook administratora

Wdrożenie, kopie, aktualizacja legacy, odtworzenie. Praca operatora: [INSTRUKCJA.md](INSTRUKCJA.md); budowa i API: [DOKUMENTACJA.md](DOKUMENTACJA.md).

## 1. Składniki i porty

| Usługa (`compose.yml`) | Obraz (wydanie 1.0.0) | Port na zewnątrz |
|---|---|---|
| `live` – panel | `ghcr.io/sdorpl/vizrs-live:1.0.0` | 8090 – operatorzy |
| `ersatztv` – legacy z mostem | `ghcr.io/sdorpl/vizrs-live-legacy:1.0.0-legacy26.12.0` (ErsatzTV legacy v26.12.0 + VizRS Bridge) | brak (`expose`) |
| `proxy` – Caddy | `caddy:2.10.2-alpine` | 8409 – widzowie: strumienie, M3U, XMLTV, HDHomeRun |

Dane: `ETV_CONFIG` (domyślnie `./etv-config`, cała baza i stan legacy) i `MEDIA_DIR` (media, tylko do odczytu). Panel nie trzyma żadnych danych.

## 2. Wdrożenie

1. Docker z Compose v2. Skopiuj repozytorium (albo tylko `compose.yml`, `.env.example`, `docker/proxy.Caddyfile`).
2. `cp .env.example .env`; wygeneruj dwa **różne** tokeny: `head -c 24 /dev/urandom | base64 | tr -d '/+='` → `VIZRS_BRIDGE_TOKEN`, `VIZRS_LIVE_TOKEN`. Ustaw `ETV_CONFIG`, `MEDIA_DIR`, `TZ`, `VIZRS_LIVE_STREAM_URL=http://<serwer>:8409` (adres dla widzów, widoczny z kontenera panelu). `chmod 600 .env`.
3. `docker compose pull && docker compose up -d` (gotowe obrazy) albo `docker compose up -d --build` (budowa na miejscu).
4. Sprawdź: `docker compose ps` (wszystko `healthy`/`running`), panel `http://<serwer>:8090/` → zaloguj → **Diagnostyka**: most zielony, „Web GUI legacy dla widzów” = zamknięte. Z innej maszyny: `curl -I http://<serwer>:8409/` → 403, `curl -I http://<serwer>:8409/iptv/channels.m3u` → 200.
5. Pierwsza konfiguracja (biblioteka, kanał, harmonogram, playout) – w panelu; legacy nie wymaga kreatora.

**Sieć i TLS.** Panel i proxy mówią zwykłym HTTP. Panel wystawiaj tylko w sieci zaufanej (LAN/VPN); przez Internet – wyłącznie za odwrotnym proxy z TLS (np. Caddy z certyfikatem), które ustawia `X-Forwarded-Proto: https` – panel doda wtedy `Secure` do ciasteczka. Port 8090 nie powinien być widoczny publicznie bez TLS (token leci w treści logowania i w ciasteczku).

**CG Playout (opcjonalnie).** `VIZRS_LIVE_CG_URL=http://cg:7700` (sieć wewnętrzna) i `VIZRS_LIVE_CG_TOKEN` = `panel_token` CG Playout.

## 3. Kopie zapasowe `etv-config`

Baza to SQLite w trybie WAL (`ersatztv.sqlite3`, `-wal`, `-shm`) – kopia na działającym legacy może być niespójna.

```bash
docker compose stop ersatztv
tar -C "$(dirname "$ETV_CONFIG")" -czf etv-config-$(date +%F).tgz \
    --exclude='*/cache/transcode' --exclude='*/temp-pool' "$(basename "$ETV_CONFIG")"
docker compose start ersatztv
```

- Przerwa w nadawaniu: kilkanaście sekund – rób w nocy, cron raz na dobę, trzymaj min. 7 kopii, jedną poza serwerem.
- Zawsze **przed** aktualizacją legacy (nowsze legacy migruje bazę, starsze już jej nie otworzy).
- W kopii są sekrety (`*-secrets.json`: klucze Jellyfin/Emby/Plex, `api-secrets.json`) – szyfruj kopię poza serwerem.
- `.env` (tokeny) kopiuj osobno.

## 4. Aktualizacja

**Panel** (nowe wydanie VizRS Live): zmień `LIVE_IMAGE` i `LIVE_LEGACY_IMAGE` w `.env` na nowe tagi z CHANGELOG, `docker compose pull && docker compose up -d`.

**Legacy** (nowa wersja ErsatzTV legacy, zanim pojawi się wydanie VizRS Live z nią):
1. Na maszynie testowej: procedura DOKUMENTACJA §6 (stos testowy, smoke `commandsMissing = []`, seed, e2e).
2. Kopia `etv-config` (§3).
3. W `.env`: `LEGACY_IMAGE=ghcr.io/ersatztv/legacy:v<nowa>`, `LIVE_LEGACY_IMAGE=vizrs-live-legacy:local-<nowa>`; `docker compose up -d --build ersatztv`.
4. Diagnostyka: most zielony, brak brakujących komend; Na antenie gra.
5. Źle → odtworzenie (§5) ze starą wersją.

Nie używaj `legacy:latest` na produkcji – wersja zmienia się bez testu mostu.

## 5. Odtworzenie

Po awarii dysku, nieudanej aktualizacji albo przeniesieniu na nowy serwer:

```bash
docker compose down
mv "$ETV_CONFIG" "$ETV_CONFIG.zepsute"           # nie kasuj od razu
tar -C "$(dirname "$ETV_CONFIG")" -xzf etv-config-<data>.tgz
# .env z kopią tokenów; LEGACY_IMAGE / LIVE_LEGACY_IMAGE = wersja, z której pochodzi kopia
docker compose up -d
```

Potem: Diagnostyka (most zielony), **Playouty → Resetuj wszystkie** (ramówka od chwili obecnej), **Biblioteki → Skanuj** (gdy media się zmieniły). Ścieżki mediów w kontenerze (`/media`) muszą być te same co przed awarią.

## 6. Awarie

| Objaw | Sprawdź |
|---|---|
| most czerwony | `docker compose ps`, `docker compose logs --tail 200 ersatztv`; `VIZRS_BRIDGE_TOKEN` w `.env` ten sam dla obu usług; po restarcie legacy startuje do minuty |
| `commandsMissing` niepuste (Diagnostyka) | legacy w innej wersji niż wydanie – wróć do przypiętej (`.env`) |
| panel nie startuje | `docker compose logs live` – brak/za krótki token (min. 16 znaków, litery, cyfry, `-._~`) |
| widzowie bez strumieni | `curl -I http://<serwer>:8409/iptv/channels.m3u`; `docker compose logs proxy` |
| dysk pełny | `etv-config/cache/transcode`, `ffmpeg-reports`, `logs`; Diagnostyka → konserwacja |
| potrzebne web GUI legacy (wyjątkowo) | tunel SSH albo tymczasowo `ports: ["127.0.0.1:8410:8409"]` przy `ersatztv` (DOKUMENTACJA §8); cofnij po pracy |

**Wymiana tokenu panelu** (np. odejście operatora): nowy `VIZRS_LIVE_TOKEN` w `.env`, `docker compose up -d live` – wszystkie sesje tracą ważność (ciasteczko = token). Token mostu: nowy `VIZRS_BRIDGE_TOKEN`, `docker compose up -d` (obie usługi).

## 7. Wydanie nowej wersji (opiekun repozytorium)

1. `tests/gate.sh` zielony; wersja w `server/Cargo.toml`, `bridge/Bridge.cs`, `bridge/VizRS.Bridge.csproj`; CHANGELOG; tagi w `.env.example` i `compose.yml`.
2. `git tag v<wersja> && git push origin main v<wersja>` – `.github/workflows/release.yml` przechodzi bramkę i publikuje oba obrazy na `ghcr.io/sdorpl/…` (uprawnienie `packages: write`, `GITHUB_TOKEN`).
3. Pierwsze wydanie: w ustawieniach pakietów GitHub ustaw `vizrs-live` i `vizrs-live-legacy` jako publiczne (albo `docker login ghcr.io` na serwerze).

Bez dostępu do Actions – ręcznie: `docker build -f docker/live.Dockerfile -t ghcr.io/sdorpl/vizrs-live:<w> .`, `docker build -f docker/legacy-bridge.Dockerfile -t ghcr.io/sdorpl/vizrs-live-legacy:<w>-legacy<l> .`, `docker login ghcr.io`, `docker push …`.

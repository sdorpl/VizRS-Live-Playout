# VizRS Live – runbook administratora

Wdrożenie, kopie, aktualizacja legacy, odtworzenie. Praca operatora: [INSTRUKCJA.md](INSTRUKCJA.md); budowa i API: [DOKUMENTACJA.md](DOKUMENTACJA.md).

## 1. Składniki i porty

| Usługa (`compose.yml`) | Obraz (wydanie 1.2.0) | Port na zewnątrz |
|---|---|---|
| `live` – panel | `ghcr.io/sdorpl/vizrs-live:1.2.0` | 8090 – operatorzy |
| `ersatztv` – legacy z mostem | `vizrs-live-legacy:local` – budowany na miejscu na najnowszym `ghcr.io/ersatztv/legacy` + VizRS Bridge | brak (`expose`) |
| `proxy` – Caddy | `caddy:2.10.2-alpine` | 8409 – widzowie: strumienie, M3U, XMLTV, HDHomeRun |

Dane: `ETV_CONFIG` (domyślnie `./etv-config`, cała baza i stan legacy) i `MEDIA_DIR` (media, tylko do odczytu). Panel nie trzyma żadnych danych.

## 2. Wdrożenie

1. Docker z Compose v2. Skopiuj repozytorium (albo tylko `compose.yml`, `.env.example`, `docker/proxy.Caddyfile`).
2. `cp .env.example .env`; wygeneruj dwa **różne** tokeny: `head -c 24 /dev/urandom | base64 | tr -d '/+='` → `VIZRS_BRIDGE_TOKEN`, `VIZRS_LIVE_TOKEN`. Ustaw `ETV_CONFIG`, `MEDIA_DIR`, `TZ`, `VIZRS_LIVE_STREAM_URL=http://<serwer>:8409` (adres dla widzów, widoczny z kontenera panelu). `chmod 600 .env`.
3. `docker compose pull live && docker compose up -d` – panel z ghcr, legacy z mostem budowany na miejscu (`pull_policy: build`); każde `up` sprawdza nowsze `ghcr.io/ersatztv/legacy` i dobudowuje most (warstwy z pamięci podręcznej, bez nowego legacy – kilka sekund).
4. Sprawdź: `docker compose ps` (wszystko `healthy`/`running`), panel `http://<serwer>:8090/` → zaloguj → **Diagnostyka**: most zielony, „Web GUI legacy dla widzów” = zamknięte. Z innej maszyny: `curl -I http://<serwer>:8409/` → 403, `curl -I http://<serwer>:8409/iptv/channels.m3u` → 200.
5. Pierwsza konfiguracja (biblioteka, kanał, harmonogram, playout) – w panelu; legacy nie wymaga kreatora.

**Sieć i TLS.** Panel i proxy mówią zwykłym HTTP. Panel wystawiaj tylko w sieci zaufanej (LAN/VPN); przez Internet – wyłącznie za odwrotnym proxy z TLS (np. Caddy z certyfikatem), które ustawia `X-Forwarded-Proto: https` – panel doda wtedy `Secure` do ciasteczka. Port 8090 nie powinien być widoczny publicznie bez TLS (token leci w treści logowania i w ciasteczku).

**CG Playout (opcjonalnie).** `VIZRS_LIVE_CG_URL=http://cg:7700` (sieć wewnętrzna) i `VIZRS_LIVE_CG_TOKEN` = `panel_token` CG Playout.

**VizRS CG System (opcjonalnie, podgląd grafiki i Trio).** `VIZRS_LIVE_VIZRS_URL` – adres VizRS widziany z przeglądarki operatora (nie z kontenera): `http://<serwer>:8788` albo sam port `:8788` (ten sam host co panel – zalecane, ciasteczko Trio działa wtedy także w ramce). VizRS z tokenem: `VIZRS_LIVE_VIZRS_OUTPUT_TOKEN` = `VIZRS_OUTPUT_TOKEN` VizRS (tylko odczyt). Anteny kanałów (`VIZRS_CHANNEL_BUSES=1` w CG Playout): `VIZRS_LIVE_VIZRS_CHANNELS=1`. Sprawdzenie: Grafika kanału → ramka pokazuje wyjście (nie „wymagany token”), Diagnostyka → Panel.

### 2a. Razem ze stosem VizRS CG Playout (jeden projekt compose)

Gdy ErsatzTV legacy działa już w stosie CG Playout (`../VirtRS CG Playout/docker-compose.yml`: `vizrs`, `cg`, `ersatztv`, `ingest`), VizRS Live wpina się w ten sam projekt nakładką `compose.cg-playout.yml` zamiast osobnego `compose.yml`: `ersatztv` dostaje obraz legacy z mostem i traci port na zewnątrz, dochodzą `proxy` (port 8409 dla widzów) i `live` (8090, CG Playout przez `http://cg:7700`). Wolumen `ersatztv-config` i reszta stosu bez zmian.

1. Panel z repozytorium (albo gotowy z ghcr): `VIZRS_BRIDGE_TOKEN=x… VIZRS_LIVE_TOKEN=x… LIVE_IMAGE=vizrs-live:local docker compose build live` w VizRS Live; w CG Playout `docker compose build cg`. Legacy z mostem nakładka buduje sama przy każdym `up` na najnowszym `ghcr.io/ersatztv/legacy` (tym samym, co `ingest` CG Playout).
2. Kopia `ersatztv-config` (§3; wolumen: `docker run --rm -v <projekt>_ersatztv-config:/c -v "$PWD":/k alpine tar -C /c -czf /k/etv-config-$(date +%F).tgz .` przy zatrzymanym `ersatztv`) – nowsze legacy migruje bazę starszej wersji.
3. W `.env` CG Playout (poza gitem): `COMPOSE_FILE=docker-compose.yml:docker-compose.nvidia.yml:<ścieżka VizRS Live>/compose.cg-playout.yml` (bez nakładki NVIDIA – bez niej), `VIZRS_LIVE_DIR=<ścieżka VizRS Live>` (dla `docker/proxy.Caddyfile`), `VIZRS_BRIDGE_TOKEN`, `VIZRS_LIVE_TOKEN` (dwa różne, §2), `LIVE_IMAGE` (`LIVE_LEGACY_IMAGE` – opcjonalnie, nazwa lokalnego obrazu z mostem, domyślnie `vizrs-live-legacy:local`), `VIZRS_LIVE_STREAM_URL=http://<serwer>:8409`; token CG dla panelu to `VIZRS_PANEL_TOKEN`, który już tam jest. VizRS dla panelu nakładka ustawia sama: adres `:${VIZRS_PORT}` (host, pod którym otwarto panel), token wyjścia `VIZRS_OUTPUT_TOKEN`, anteny kanałów wg `VIZRS_CHANNEL_BUSES`; własny `VIZRS_LIVE_VIZRS_URL` w `.env` ma pierwszeństwo – działa tylko, gdy operator otwiera panel pod tym samym hostem (np. `127.0.0.1` ≠ `localhost`).
4. `docker compose up -d` w katalogu CG Playout; sprawdzenie jak w §2 pkt 4 (most zielony, `curl -I :8409/` → 403, `:8409/iptv/channels.m3u` → 200) i w panelu Sloty na żywo (CG Playout połączony).

Cofnięcie: przywróć poprzedni `.env` CG Playout i kopię `ersatztv-config` (§5), `docker compose up -d --remove-orphans`.

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

**Panel** (nowe wydanie VizRS Live): zmień `LIVE_IMAGE` w `.env` na nowy tag z CHANGELOG, `docker compose pull live && docker compose up -d` (most dobuduje się z repozytorium – najpierw `git pull`).

**Legacy** – zawsze najnowsze `ghcr.io/ersatztv/legacy` (decyzja 2026-11-07, jak w CG Playout): każde `docker compose up -d` pobiera nowsze legacy, jeśli jest, i buduje na nim most. Nowsze legacy migruje bazę bez pytania, więc:
1. Przed `up`, które może przynieść nowe legacy, zrób kopię `etv-config` (§3). Wcześniejsze sprawdzenie: `tests/stack.sh up && tests/stack.sh seed && tests/stack.sh test` na maszynie testowej (DOKUMENTACJA §6) – stos testowy też bierze najnowsze.
2. `docker compose up -d`.
3. Diagnostyka: most zielony, brak brakujących komend; Na antenie gra.
4. Źle → odtworzenie (§5) i tymczasowo konkretna wersja: `LEGACY_IMAGE=ghcr.io/ersatztv/legacy:v<poprzednia>` w `.env`.

## 5. Odtworzenie

Po awarii dysku, nieudanej aktualizacji albo przeniesieniu na nowy serwer:

```bash
docker compose down
mv "$ETV_CONFIG" "$ETV_CONFIG.zepsute"           # nie kasuj od razu
tar -C "$(dirname "$ETV_CONFIG")" -xzf etv-config-<data>.tgz
# .env z kopią tokenów; kopia ze starszego legacy niż najnowsze – nowsze ją zmigruje, nowszej niż
# najnowsze nie ma; po nieudanej aktualizacji: LEGACY_IMAGE=ghcr.io/ersatztv/legacy:v<wersja kopii>
docker compose up -d
```

Potem: Diagnostyka (most zielony), **Playouty → Resetuj wszystkie** (ramówka od chwili obecnej), **Biblioteki → Skanuj** (gdy media się zmieniły). Ścieżki mediów w kontenerze (`/media`) muszą być te same co przed awarią.

## 6. Awarie

| Objaw | Sprawdź |
|---|---|
| most czerwony | `docker compose ps`, `docker compose logs --tail 200 ersatztv`; `VIZRS_BRIDGE_TOKEN` w `.env` ten sam dla obu usług; po restarcie legacy startuje do minuty |
| `commandsMissing` niepuste (Diagnostyka) | najnowsze legacy zmieniło komendy – wersja w Diagnostyce; tymczasowo `LEGACY_IMAGE=ghcr.io/ersatztv/legacy:v<poprzednia>` w `.env`, zgłoś do poprawki mostu |
| panel nie startuje | `docker compose logs live` – brak/za krótki token (min. 16 znaków, litery, cyfry, `-._~`) |
| widzowie bez strumieni | `curl -I http://<serwer>:8409/iptv/channels.m3u`; `docker compose logs proxy` |
| dysk pełny | `etv-config/cache/transcode`, `ffmpeg-reports`, `logs`; Diagnostyka → konserwacja |
| 429 przy logowaniu | odczekaj minutę; w dzienniku panelu »login: zły token (adres)« |
| potrzebne web GUI legacy (wyjątkowo) | tunel SSH albo tymczasowo `ports: ["127.0.0.1:8410:8409"]` przy `ersatztv` (DOKUMENTACJA §8); cofnij po pracy |

**Wymiana tokenu panelu** (np. odejście operatora): nowy `VIZRS_LIVE_TOKEN` w `.env`, `docker compose up -d live` – wszystkie sesje tracą ważność (ciasteczko = token). Token mostu: nowy `VIZRS_BRIDGE_TOKEN`, `docker compose up -d` (obie usługi).

## 7. Wydanie nowej wersji (opiekun repozytorium)

1. `tests/gate.sh` zielony; wersja w `server/Cargo.toml`, `bridge/Bridge.cs`, `bridge/VizRS.Bridge.csproj`; CHANGELOG; tagi w `.env.example` i `compose.yml`.
2. `git tag v<wersja> && git push origin main v<wersja>` – `.github/workflows/release.yml` przechodzi bramkę, publikuje oba obrazy (amd64 + arm64, `:<wersja>` i `:latest`) na `ghcr.io/sdorpl/…` i zakłada wydanie na GitHubie z binarkami panelu i sumami (uprawnienia `contents: write`, `packages: write`, `GITHUB_TOKEN`). Próba bez znacznika: Actions → Release → Run workflow z wersją – szkic wydania, obrazy tylko z tagiem wersji; zbędny szkic – Actions → Usuń szkic wydania.
3. Pierwsze wydanie: w ustawieniach pakietów GitHub ustaw `vizrs-live` i `vizrs-live-legacy` jako publiczne (albo `docker login ghcr.io` na serwerze).

Bez dostępu do Actions – ręcznie: `docker build -f docker/live.Dockerfile -t ghcr.io/sdorpl/vizrs-live:<w> .`, `docker build -f docker/legacy-bridge.Dockerfile -t ghcr.io/sdorpl/vizrs-live-legacy:<w>-legacy<l> .`, `docker login ghcr.io`, `docker push …`.

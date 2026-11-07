//! VizRS Live – panel kanału nad ErsatzTV legacy.
//!
//! Serwer podaje UI panelu i przekazuje komendy do mostu VizRS Bridge (w procesie legacy).
//! Token mostu zostaje po stronie serwera; przeglądarka zna tylko (opcjonalny) token panelu.

mod bridge;
mod http;

use std::net::{IpAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use bridge::Bridge;
use http::{json_str, Request, Response};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_CONN: usize = 64;
const COOKIE: &str = "vizrs_live";

const STATIC: &[(&str, &str, &str)] = &[
    (
        "/",
        "text/html; charset=utf-8",
        include_str!("../web/index.html"),
    ),
    (
        "/app.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/app.js"),
    ),
    (
        "/core.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/core.js"),
    ),
    (
        "/form.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/form.js"),
    ),
    (
        "/parts.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/parts.js"),
    ),
    (
        "/when.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/when.js"),
    ),
    (
        "/views/antena.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/antena.js"),
    ),
    (
        "/views/kanaly.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/kanaly.js"),
    ),
    (
        "/views/profile.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/profile.js"),
    ),
    (
        "/views/znaki.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/znaki.js"),
    ),
    (
        "/views/wypelniacze.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/wypelniacze.js"),
    ),
    (
        "/views/media.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/media.js"),
    ),
    (
        "/views/zrodla.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/zrodla.js"),
    ),
    (
        "/views/listy.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/listy.js"),
    ),
    (
        "/views/playlisty.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/playlisty.js"),
    ),
    (
        "/views/playouty.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/playouty.js"),
    ),
    (
        "/views/bloki.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/bloki.js"),
    ),
    (
        "/views/deco.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/deco.js"),
    ),
    (
        "/views/kalendarz.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/kalendarz.js"),
    ),
    (
        "/views/harmonogramy.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/harmonogramy.js"),
    ),
    (
        "/views/grafika.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/grafika.js"),
    ),
    (
        "/views/live.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/live.js"),
    ),
    (
        "/views/system.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/system.js"),
    ),
    (
        "/style.css",
        "text/css; charset=utf-8",
        include_str!("../web/style.css"),
    ),
];

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub bind: String,
    pub port: u16,
    pub bridge_url: String,
    pub bridge_token: String,
    pub token: Option<String>,
    pub stream_url: String,
    pub vizrs_url: String,
    pub cg_url: String,
    pub cg_token: String,
    pub web: Option<PathBuf>,
}

const HELP: &str = "vizrs-live – panel kanału nad ErsatzTV legacy

Użycie: vizrs-live [opcje]

  --bind ADRES          adres nasłuchu (VIZRS_LIVE_BIND, domyślnie 127.0.0.1)
  --port N              port panelu (VIZRS_LIVE_PORT, domyślnie 8090)
  --bridge URL          ErsatzTV legacy z mostem (VIZRS_LIVE_BRIDGE, domyślnie http://127.0.0.1:8409)
  --bridge-token T      token mostu, = VIZRS_BRIDGE_TOKEN w legacy (VIZRS_LIVE_BRIDGE_TOKEN, wymagany)
  --token T             token panelu dla operatorów (VIZRS_LIVE_TOKEN; wymagany poza 127.0.0.1)
  --stream-url URL      publiczny adres strumieni legacy do odnośników (VIZRS_LIVE_STREAM_URL)
  --vizrs-url URL       VizRS CG System do podglądu grafiki i odnośnika do Trio (VIZRS_LIVE_VIZRS_URL)
  --cg-url URL          VizRS CG Playout (sidecar, np. http://cg:7700) – grafika i sloty na żywo (VIZRS_LIVE_CG_URL)
  --cg-token T          token panelu CG Playout, = panel_token / VIZRS_PANEL_TOKEN tam (VIZRS_LIVE_CG_TOKEN)
  --web KATALOG         UI z dysku zamiast wbudowanego (praca nad UI)
  --healthcheck         sprawdź działający panel (GET /health), kod wyjścia 0/1
  --version, --help
";

/// Opcje z argumentów i zmiennych środowiskowych (argumenty mają pierwszeństwo).
pub fn parse_config(
    args: &[String],
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Config, String> {
    let mut c = Config {
        bind: env("VIZRS_LIVE_BIND").unwrap_or_else(|| "127.0.0.1".into()),
        port: match env("VIZRS_LIVE_PORT") {
            Some(p) => p.parse().map_err(|_| format!("zły VIZRS_LIVE_PORT: {p}"))?,
            None => 8090,
        },
        bridge_url: env("VIZRS_LIVE_BRIDGE").unwrap_or_else(|| "http://127.0.0.1:8409".into()),
        bridge_token: env("VIZRS_LIVE_BRIDGE_TOKEN").unwrap_or_default(),
        token: env("VIZRS_LIVE_TOKEN").filter(|t| !t.is_empty()),
        stream_url: env("VIZRS_LIVE_STREAM_URL").unwrap_or_default(),
        vizrs_url: env("VIZRS_LIVE_VIZRS_URL").unwrap_or_default(),
        cg_url: env("VIZRS_LIVE_CG_URL").unwrap_or_default(),
        cg_token: env("VIZRS_LIVE_CG_TOKEN").unwrap_or_default(),
        web: None,
    };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = || {
            it.next()
                .cloned()
                .ok_or_else(|| format!("{a}: brak wartości"))
        };
        match a.as_str() {
            "--bind" => c.bind = val()?,
            "--port" => {
                c.port = val()?
                    .parse()
                    .map_err(|_| "--port: zła liczba".to_string())?
            }
            "--bridge" => c.bridge_url = val()?,
            "--bridge-token" => c.bridge_token = val()?,
            "--token" => c.token = Some(val()?).filter(|t| !t.is_empty()),
            "--stream-url" => c.stream_url = val()?,
            "--vizrs-url" => c.vizrs_url = val()?,
            "--cg-url" => c.cg_url = val()?,
            "--cg-token" => c.cg_token = val()?,
            "--web" => c.web = Some(PathBuf::from(val()?)),
            other => return Err(format!("nieznana opcja: {other} (--help)")),
        }
    }
    bridge::parse_url(&c.bridge_url)?;
    if !c.cg_url.is_empty() {
        bridge::parse_url(&c.cg_url).map_err(|e| format!("--cg-url: {e}"))?;
        if c.cg_token.is_empty() || c.cg_token.contains(['\r', '\n']) {
            return Err(
                "--cg-url wymaga tokenu panelu CG Playout: --cg-token / VIZRS_LIVE_CG_TOKEN".into(),
            );
        }
    }
    if c.bridge_token.len() < 16 {
        return Err("brak tokenu mostu: --bridge-token / VIZRS_LIVE_BRIDGE_TOKEN (min. 16 znaków, ten sam co VIZRS_BRIDGE_TOKEN w legacy)".into());
    }
    if let Some(t) = &c.token {
        if t.len() < 16
            || !t
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || "-._~".contains(ch))
        {
            return Err("token panelu: min. 16 znaków, tylko litery, cyfry i -._~".into());
        }
    }
    let loopback = c
        .bind
        .parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(c.bind == "localhost");
    if !loopback && c.token.is_none() {
        return Err(format!(
            "panel na {} wymaga tokenu (--token / VIZRS_LIVE_TOKEN)",
            c.bind
        ));
    }
    for u in [&mut c.stream_url, &mut c.vizrs_url, &mut c.cg_url] {
        while u.ends_with('/') {
            u.pop();
        }
    }
    Ok(c)
}

struct App {
    cfg: Config,
    bridge: Bridge,
    cg: Option<Bridge>,
    /// nieudane logowania: początek okna i liczba prób (wspólne dla wszystkich klientów)
    login_fails: std::sync::Mutex<(std::time::Instant, u32)>,
}

/// Najwyżej tyle nieudanych logowań na [`LOGIN_WINDOW`] – potem 429 do końca okna.
pub const LOGIN_MAX_FAILS: u32 = 10;
pub const LOGIN_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

/// `true` = logowanie zablokowane; `failed` = dolicz nieudaną próbę.
fn login_limited(app: &App, failed: bool) -> bool {
    let mut g = app.login_fails.lock().unwrap_or_else(|e| e.into_inner());
    if g.0.elapsed() >= LOGIN_WINDOW {
        *g = (std::time::Instant::now(), 0);
    }
    if failed {
        g.1 += 1;
    }
    g.1 >= LOGIN_MAX_FAILS
}

/// Ciasteczko sesji; `Secure`, gdy panel stoi za proxy TLS (`X-Forwarded-Proto: https`).
fn session_cookie(req: &Request, value: &str, max_age: u32) -> String {
    let secure = if req.header("x-forwarded-proto") == Some("https") {
        "; Secure"
    } else {
        ""
    };
    format!("{COOKIE}={value}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}{secure}")
}

fn cg_client(c: &Config) -> Option<Bridge> {
    (!c.cg_url.is_empty()).then(|| Bridge {
        target: bridge::parse_url(&c.cg_url).expect("sprawdzone w parse_config"),
        token: c.cg_token.clone(),
        prefix: "",
        auth: "Authorization",
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print!("{HELP}");
        return;
    }
    if args.iter().any(|a| a == "--version") {
        println!("vizrs-live {VERSION}");
        return;
    }
    if args.iter().any(|a| a == "--healthcheck") {
        std::process::exit(healthcheck());
    }
    let cfg = match parse_config(&args, &|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("vizrs-live: {e}");
            std::process::exit(2);
        }
    };
    let target = bridge::parse_url(&cfg.bridge_url).expect("sprawdzone w parse_config");
    let app = Arc::new(App {
        bridge: Bridge {
            target,
            token: cfg.bridge_token.clone(),
            prefix: "/vizrs-bridge",
            auth: "X-VizRS-Token",
        },
        cg: cg_client(&cfg),
        login_fails: std::sync::Mutex::new((std::time::Instant::now(), 0)),
        cfg,
    });

    let addr = format!("{}:{}", app.cfg.bind, app.cfg.port);
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("vizrs-live: nie mogę nasłuchiwać na {addr}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!(
        "vizrs-live {VERSION}: panel http://{addr}/ · most {} · token panelu: {}",
        app.cfg.bridge_url,
        if app.cfg.token.is_some() {
            "tak"
        } else {
            "nie (tylko lokalnie)"
        }
    );

    let active = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        if active.fetch_add(1, Ordering::SeqCst) >= MAX_CONN {
            active.fetch_sub(1, Ordering::SeqCst);
            let _ = Response::error(503, "za dużo połączeń").write_to(&stream);
            continue;
        }
        let (app, active) = (Arc::clone(&app), Arc::clone(&active));
        std::thread::spawn(move || {
            handle(&app, stream);
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

/// Dla HEALTHCHECK w obrazie bez powłoki: GET /health na lokalnym porcie panelu.
fn healthcheck() -> i32 {
    let port = std::env::var("VIZRS_LIVE_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8090);
    let target = bridge::Target {
        host: "127.0.0.1".into(),
        port,
        base: String::new(),
    };
    let probe = (|| -> Result<bool, String> {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], target.port));
        let mut s = TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        http::set_timeouts(&s, 3);
        use std::io::{Read, Write};
        s.write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .map_err(|e| e.to_string())?;
        let mut raw = Vec::new();
        s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
        Ok(bridge::parse_reply(&raw)?.status == 200)
    })();
    match probe {
        Ok(true) => 0,
        Ok(false) => 1,
        Err(e) => {
            eprintln!("healthcheck: {e}");
            1
        }
    }
}

fn handle(app: &App, stream: TcpStream) {
    http::set_timeouts(&stream, 15);
    let resp = match http::read_request(&stream) {
        Ok(req) => route(app, &req),
        Err(http::ParseError::TooLarge) => Response::error(413, "żądanie za duże"),
        Err(http::ParseError::Bad(m)) => Response::error(400, m),
        Err(http::ParseError::Io) => return,
    };
    let _ = resp.write_to(&stream);
}

fn eq_ct(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn authorized(app: &App, req: &Request) -> bool {
    let Some(token) = &app.cfg.token else {
        return true;
    };
    let bearer = req
        .header("authorization")
        .and_then(|h| h.strip_prefix("Bearer "));
    bearer
        .or(req.cookie(COOKIE))
        .is_some_and(|t| eq_ct(t, token))
}

/// Nazwa komendy legacy: litera, potem litery i cyfry (np. `GetAllChannels`).
pub fn valid_command(name: &str) -> bool {
    (1..=80).contains(&name.len())
        && name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric())
}

fn route(app: &App, req: &Request) -> Response {
    let path = req.path.as_str();
    if path == "/health" {
        return Response::json(200, "{\"ok\":true}");
    }
    if !path.starts_with("/api/") {
        return static_file(app, req);
    }
    if req.method != "GET" && req.method != "HEAD" && req.header("x-vizrs-live") != Some("1") {
        return Response::error(
            403,
            "brak nagłówka X-VizRS-Live (ochrona przed obcymi stronami)",
        );
    }
    match (req.method.as_str(), path) {
        ("POST", "/api/login") => {
            let given = String::from_utf8_lossy(&req.body).trim().to_string();
            if app.cfg.token.is_some() && login_limited(app, false) {
                return Response::error(429, "za dużo nieudanych logowań – odczekaj minutę");
            }
            match &app.cfg.token {
                Some(t) if eq_ct(&given, t) => Response::json(200, "{\"ok\":true}")
                    .with_header("Set-Cookie", session_cookie(req, t, 2_592_000)),
                Some(_) => {
                    login_limited(app, true);
                    eprintln!("login: zły token");
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    Response::error(401, "zły token panelu")
                }
                None => Response::json(200, "{\"ok\":true}"),
            }
        }
        ("POST", "/api/logout") => Response::json(200, "{\"ok\":true}")
            .with_header("Set-Cookie", session_cookie(req, "", 0)),
        _ if !authorized(app, req) => Response::error(401, "zaloguj się tokenem panelu"),
        ("GET", "/api/status") => status(app),
        ("GET", "/api/exposure") => exposure(app),
        (m, p) if p.starts_with("/api/cg/") => cg_proxy(
            app,
            m,
            &p["/api/cg/".len()..],
            &req.body,
            &operator_name(req.header("x-operator")),
        ),
        ("GET", "/api/commands") => forward(app.bridge.get("/commands"), "commands"),
        ("POST", p) if p.starts_with(http::UPLOAD_PREFIX) => {
            upload(app, req, &p[http::UPLOAD_PREFIX.len()..])
        }
        ("POST", p) if p.starts_with("/api/cmd/") => {
            let name = &p["/api/cmd/".len()..];
            if !valid_command(name) {
                return Response::error(400, "zła nazwa komendy");
            }
            let mut r = forward(
                app.bridge.post(&format!("/command/{name}"), &req.body),
                name,
            );
            r.body = mask_secrets(&r.body);
            eprintln!("cmd {name} -> {}", r.status);
            r
        }
        _ => Response::error(404, "nieznany adres API"),
    }
}

/// Końcówki nazw pól (małymi literami), których wartości tekstowe nie wychodzą do przeglądarki (R8).
const SECRET_SUFFIXES: &[&str] = &["apikey", "token", "password", "secret"];
/// Wartość zamaskowanego sekretu; pusty sekret zostaje pusty (panel wie, że nic nie zapisano).
pub const MASK: &str = "********";

/// Maskuje w odpowiedzi JSON tekstowe wartości pól o nazwach z `SECRET_SUFFIXES`
/// (np. `ApiKey` z `GetJellyfinSecrets`). Sekrety są w panelu tylko do zapisu.
pub fn mask_secrets(body: &[u8]) -> Vec<u8> {
    fn string_end(b: &[u8], start: usize) -> usize {
        // start wskazuje cudzysłów otwierający; zwraca indeks za cudzysłowem zamykającym
        let mut i = start + 1;
        while i < b.len() {
            match b[i] {
                b'\\' => i += 2,
                b'"' => return i + 1,
                _ => i += 1,
            }
        }
        b.len()
    }
    let skip_ws = |b: &[u8], mut i: usize| {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        i
    };
    let mut out = Vec::with_capacity(body.len());
    let mut i = 0;
    while i < body.len() {
        if body[i] != b'"' {
            out.push(body[i]);
            i += 1;
            continue;
        }
        let end = string_end(body, i);
        out.extend_from_slice(&body[i..end]);
        let key = String::from_utf8_lossy(&body[i + 1..end.saturating_sub(1).max(i + 1)])
            .to_ascii_lowercase();
        i = end;
        let colon = skip_ws(body, i);
        if colon >= body.len()
            || body[colon] != b':'
            || !SECRET_SUFFIXES.iter().any(|s| key.ends_with(s))
        {
            continue;
        }
        let v = skip_ws(body, colon + 1);
        if v >= body.len() || body[v] != b'"' {
            continue;
        }
        let vend = string_end(body, v);
        out.extend_from_slice(&body[i..v]);
        if vend - v > 2 {
            out.extend_from_slice(format!("\"{MASK}\"").as_bytes());
        } else {
            out.extend_from_slice(b"\"\"");
        }
        i = vend;
    }
    out
}

/// Rodzaje obrazów, które panel wgrywa do legacy (`ArtworkKind`).
const UPLOAD_KINDS: &[&str] = &["Logo", "Watermark"];

/// Typ obrazu z nagłówka zgodny z sygnaturą pliku; tylko PNG, JPEG, GIF, WebP (bez SVG – skrypty).
pub fn image_type_ok(content_type: &str, b: &[u8]) -> bool {
    match content_type {
        "image/png" => b.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => b.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"),
        "image/webp" => b.len() >= 12 && b.starts_with(b"RIFF") && &b[8..12] == b"WEBP",
        _ => false,
    }
}

/// `POST /api/upload/{Logo|Watermark}`: obraz do pamięci obrazów legacy przez most; wynik = nazwa pliku.
fn upload(app: &App, req: &Request, kind: &str) -> Response {
    if !UPLOAD_KINDS.contains(&kind) {
        return Response::error(400, "rodzaj obrazu: Logo albo Watermark");
    }
    let ct = req
        .header("content-type")
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if req.body.is_empty() {
        return Response::error(400, "pusty plik");
    }
    if !image_type_ok(&ct, &req.body) {
        return Response::error(
            415,
            "dozwolone tylko obrazy PNG, JPEG, GIF i WebP (typ i treść pliku muszą się zgadzać)",
        );
    }
    let r = forward(
        app.bridge
            .post_as(&format!("/upload/{kind}"), &req.body, &ct),
        "upload",
    );
    eprintln!("upload {kind} {} B -> {}", req.body.len(), r.status);
    r
}

fn forward(r: Result<bridge::Reply, String>, what: &str) -> Response {
    match r {
        Ok(rep) if rep.body.first() == Some(&b'{') => Response::json(rep.status, rep.body),
        Ok(rep) => Response::error(
            502,
            &format!("most: nieoczekiwana odpowiedź {} dla {what}", rep.status),
        ),
        Err(e) => Response::error(502, &e),
    }
}

/// Numer kanału ErsatzTV albo id audycji CG Playout: litery, cyfry, kropka, myślnik, podkreślnik.
fn cg_segment(s: &str) -> bool {
    (1..=120).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._".contains(c))
        && s != "."
        && s != ".."
}

/// Biała lista pośrednika CG Playout: (metoda, ścieżka w panelu) → ścieżka w CG Playout.
pub fn cg_path(method: &str, rest: &str) -> Option<String> {
    let seg: Vec<&str> = rest.split('/').collect();
    if !seg.iter().skip(1).all(|s| cg_segment(s)) {
        return None;
    }
    let p = match (method, seg.as_slice()) {
        ("GET", ["health"]) => "/health".into(),
        ("GET", ["ingest", ch]) => format!("/ingest/state?channel={ch}"),
        ("GET", ["pages", ch]) => format!("/etv/pages?channel={ch}"),
        ("GET", ["live", "state"]) => "/api/live/state".into(),
        ("GET" | "PUT", ["live", "graphics"]) => "/api/live/graphics".into(),
        ("PUT", ["live", "settings"]) => "/api/live/settings".into(),
        ("GET", ["live", "shows"]) | ("POST", ["live", "shows"]) => "/api/live/shows".into(),
        ("POST", ["live", "shows", "scan"]) => "/api/live/shows/scan".into(),
        ("PUT" | "DELETE", ["live", "shows", id]) => format!("/api/live/shows/{id}"),
        ("PUT", ["live", "channels", ch]) => format!("/api/live/channels/{ch}"),
        ("POST", ["live", "channels", ch, a @ ("hold" | "release" | "rebuild")]) => {
            format!("/api/live/channels/{ch}/{a}")
        }
        _ => return None,
    };
    Some(p)
}

/// Nazwa stanowiska do dziennika CG Playout: nagłówek `X-Operator` przeglądarki
/// (zakodowany `encodeURIComponent`, bo fetch nie wysyła polskich liter w nagłówku),
/// bez znaków sterujących, do 40 znaków; zawsze z przedrostkiem „VizRS Live”.
pub fn operator_name(raw: Option<&str>) -> String {
    let bytes = raw.unwrap_or("").as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(b)) => {
                out.push(b);
                i += 3;
            }
            (b, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    let name: String = String::from_utf8_lossy(&out)
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect();
    match name.trim() {
        "" => "VizRS Live".into(),
        n => format!("VizRS Live · {n}"),
    }
}

/// Pośrednik `/api/cg/…` → VizRS CG Playout (R9): token CG zostaje w serwerze,
/// odpowiedź w kopercie panelu `{"ok":true,"result":…}` albo `{"ok":false,"error":…}`.
fn cg_proxy(app: &App, method: &str, rest: &str, body: &[u8], operator: &str) -> Response {
    let Some(cg) = &app.cg else {
        return Response::error(
            409,
            "VizRS CG Playout nie jest podłączony (--cg-url / VIZRS_LIVE_CG_URL)",
        );
    };
    let Some(path) = cg_path(method, rest) else {
        return Response::error(404, "nieznany adres CG Playout");
    };
    let body = if method == "GET" || method == "DELETE" {
        &[][..]
    } else {
        body
    };
    match cg.send_as(method, &path, body, operator) {
        Ok(r) if (200..300).contains(&r.status) => {
            let inner = if r.body.is_empty() {
                b"null".to_vec()
            } else {
                r.body
            };
            if !matches!(inner.first(), Some(b'{' | b'[' | b'n')) {
                return Response::error(502, "CG Playout: odpowiedź bez JSON");
            }
            let mut out = b"{\"ok\":true,\"result\":".to_vec();
            out.extend_from_slice(&mask_secrets(&inner));
            out.push(b'}');
            eprintln!("cg {method} {path} -> {}", r.status);
            Response::json(200, out)
        }
        Ok(r) => {
            let text = String::from_utf8_lossy(&r.body);
            let msg = cg_error(&text).unwrap_or_else(|| text.chars().take(300).collect());
            eprintln!("cg {method} {path} -> {}", r.status);
            // jak przy legacy: odrzucenie (walidacja CG Playout) = 200 z ok:false, awaria = 502
            let status = match r.status {
                401 | 404 => 502,
                400..=499 => 200,
                s => s,
            };
            let msg = match r.status {
                401 => "CG Playout odrzucił token panelu (--cg-token = panel_token CG Playout)"
                    .to_string(),
                404 if msg.is_empty() => {
                    "CG Playout: brak tej funkcji (panel_token pusty albo starsza wersja)"
                        .to_string()
                }
                _ => format!("CG Playout odrzucił: {msg}"),
            };
            Response::error(status, &msg)
        }
        Err(e) => Response::error(502, &e.replace("most", "CG Playout")),
    }
}

/// Komunikat z `{"error":"…"}` CG Playout (bez parsera JSON: pierwszy napis po kluczu).
pub fn cg_error(body: &str) -> Option<String> {
    let i = body.find("\"error\"")? + 7;
    let rest = body[i..]
        .trim_start()
        .strip_prefix(':')?
        .trim_start()
        .strip_prefix('"')?;
    let mut out = String::new();
    let mut esc = false;
    for c in rest.chars() {
        match (esc, c) {
            (true, 'n') => {
                out.push(' ');
                esc = false
            }
            (true, c) => {
                out.push(c);
                esc = false
            }
            (false, '\\') => esc = true,
            (false, '"') => return Some(out),
            (false, c) => out.push(c),
        }
    }
    None
}

fn status(app: &App) -> Response {
    let (bridge, err) = match app.bridge.get("/health") {
        Ok(r) if r.status == 200 && r.body.first() == Some(&b'{') => (
            String::from_utf8_lossy(&r.body).into_owned(),
            "null".to_string(),
        ),
        Ok(r) => (
            "null".into(),
            json_str(&format!(
                "most odpowiedział {}: {}",
                r.status,
                String::from_utf8_lossy(&r.body)
            )),
        ),
        Err(e) => ("null".into(), json_str(&e)),
    };
    Response::json(
        200,
        format!(
            "{{\"ok\":true,\"result\":{{\"panel\":{},\"bridgeUrl\":{},\"streamUrl\":{},\"vizrsUrl\":{},\"cg\":{},\"auth\":{},\"bridge\":{bridge},\"bridgeError\":{err}}}}}",
            json_str(VERSION),
            json_str(&app.cfg.bridge_url),
            json_str(&app.cfg.stream_url),
            json_str(&app.cfg.vizrs_url),
            app.cg.is_some(),
            app.cfg.token.is_some()
        ),
    )
}

/// Ścieżki sprawdzane pod adresem dla widzów (R10): web GUI legacy, most, M3U.
pub const EXPOSURE_PROBES: [&str; 4] = [
    "/",
    "/channels",
    "/vizrs-bridge/health",
    "/iptv/channels.m3u",
];

/// Czy pod adresem dla widzów (`--stream-url`) widać web GUI legacy (R10). Kody HTTP ścieżek
/// z `EXPOSURE_PROBES`; ocenę robi UI. Sprawdza serwer panelu – z jego sieci, nie z internetu.
fn exposure(app: &App) -> Response {
    if app.cfg.stream_url.is_empty() {
        return Response::json(
            200,
            "{\"ok\":true,\"result\":{\"url\":\"\",\"error\":\"panel bez --stream-url\",\"probes\":[]}}",
        );
    }
    let target = match bridge::parse_url(&app.cfg.stream_url) {
        Ok(t) => t,
        Err(e) => {
            return Response::json(
                200,
                format!(
                    "{{\"ok\":true,\"result\":{{\"url\":{},\"error\":{},\"probes\":[]}}}}",
                    json_str(&app.cfg.stream_url),
                    json_str(&e)
                ),
            )
        }
    };
    let probe = Bridge {
        target,
        token: String::new(),
        prefix: "",
        auth: "X-VizRS-Probe",
    };
    let probes: Vec<String> = EXPOSURE_PROBES
        .iter()
        .map(|p| match probe.get(p) {
            Ok(r) => format!("{{\"path\":{},\"status\":{}}}", json_str(p), r.status),
            Err(e) => format!(
                "{{\"path\":{},\"status\":null,\"error\":{}}}",
                json_str(p),
                json_str(&e)
            ),
        })
        .collect();
    Response::json(
        200,
        format!(
            "{{\"ok\":true,\"result\":{{\"url\":{},\"error\":null,\"probes\":[{}]}}}}",
            json_str(&app.cfg.stream_url),
            probes.join(",")
        ),
    )
}

fn static_file(app: &App, req: &Request) -> Response {
    if req.method != "GET" && req.method != "HEAD" {
        return Response::error(405, "tylko GET");
    }
    let path = if req.path == "/index.html" {
        "/"
    } else {
        req.path.as_str()
    };
    let Some((p, ct, body)) = STATIC.iter().find(|(p, _, _)| *p == path) else {
        return Response::new(404, "text/plain; charset=utf-8", "nie ma takiej strony");
    };
    if let Some(dir) = &app.cfg.web {
        let file = if *p == "/" { "index.html" } else { &p[1..] };
        if let Ok(b) = std::fs::read(dir.join(file)) {
            return Response::new(200, ct, b);
        }
    }
    Response::new(200, ct, body.as_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(args: &[&str], env: &[(&str, &str)]) -> Result<Config, String> {
        let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let env: Vec<(String, String)> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        parse_config(&args, &|k| {
            env.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone())
        })
    }

    const T: &str = "0123456789abcdef";

    #[test]
    fn config_defaults_and_overrides() {
        let c = cfg(&["--bridge-token", T], &[]).unwrap();
        assert_eq!(
            (c.bind.as_str(), c.port, c.bridge_url.as_str()),
            ("127.0.0.1", 8090, "http://127.0.0.1:8409")
        );
        let c = cfg(
            &["--port", "9000"],
            &[
                ("VIZRS_LIVE_PORT", "1"),
                ("VIZRS_LIVE_BRIDGE_TOKEN", T),
                ("VIZRS_LIVE_VIZRS_URL", "http://v:8088/"),
            ],
        )
        .unwrap();
        assert_eq!(c.port, 9000);
        assert_eq!(c.vizrs_url, "http://v:8088");
    }

    #[test]
    fn config_rejects_unsafe() {
        assert!(cfg(&[], &[]).is_err(), "brak tokenu mostu");
        assert!(
            cfg(&["--bridge-token", T, "--bind", "0.0.0.0"], &[]).is_err(),
            "sieć bez tokenu panelu"
        );
        assert!(cfg(
            &["--bridge-token", T, "--bind", "0.0.0.0", "--token", T],
            &[]
        )
        .is_ok());
        assert!(cfg(&["--bridge-token", T, "--token", "krótki"], &[]).is_err());
        assert!(cfg(
            &["--bridge-token", T, "--token", "zły token ze spacją!!"],
            &[]
        )
        .is_err());
        assert!(cfg(&["--bridge-token", T, "--bridge", "https://x"], &[]).is_err());
        assert!(cfg(&["--bridge-token", T, "--nieznana"], &[]).is_err());
    }

    #[test]
    fn command_names() {
        assert!(valid_command("GetAllChannels"));
        assert!(!valid_command(""));
        assert!(!valid_command("../health"));
        assert!(!valid_command("1Abc"));
        assert!(!valid_command("Get%20All"));
    }

    #[test]
    fn image_types() {
        assert!(image_type_ok("image/png", b"\x89PNG\r\n\x1a\n...."));
        assert!(!image_type_ok("image/png", b"GIF89a"));
        assert!(image_type_ok("image/jpeg", &[0xFF, 0xD8, 0xFF, 0xE0]));
        assert!(image_type_ok("image/webp", b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(!image_type_ok("image/svg+xml", b"<svg"));
        assert!(!image_type_ok("text/html", b"<html"));
    }

    #[test]
    fn upload_guards() {
        let a = app(None);
        let mut r = req(
            "POST",
            "/api/upload/Logo",
            &[("X-VizRS-Live", "1"), ("Content-Type", "image/svg+xml")],
        );
        r.body = b"<svg/>".to_vec();
        assert_eq!(route(&a, &r).status, 415, "SVG odrzucony");
        r.headers[1].1 = "image/png".into();
        assert_eq!(route(&a, &r).status, 415, "treść nie PNG");
        r.path = "/api/upload/Poster".into();
        assert_eq!(route(&a, &r).status, 400, "zły rodzaj");
        r.path = "/api/upload/Logo".into();
        r.body = b"\x89PNG\r\n\x1a\nxxxx".to_vec();
        assert_eq!(route(&a, &r).status, 502, "dobry PNG idzie do mostu");
    }

    #[test]
    fn secrets_masked() {
        let m = |s: &str| String::from_utf8(mask_secrets(s.as_bytes())).unwrap();
        assert_eq!(
            m(r#"{"ok":true,"result":{"Address":"http://j:8096","ApiKey" : "abc\"d"}}"#),
            r#"{"ok":true,"result":{"Address":"http://j:8096","ApiKey" : "********"}}"#
        );
        assert_eq!(m(r#"{"apiKey":"","x":1}"#), r#"{"apiKey":"","x":1}"#);
        assert_eq!(
            m(r#"[{"AuthToken":"t","Name":"ApiKey"}]"#),
            r#"[{"AuthToken":"********","Name":"ApiKey"}]"#
        );
        // wartość nietekstowa i tekst wyglądający jak klucz zostają
        assert_eq!(
            m(r#"{"Token":null,"s":"apikey: x"}"#),
            r#"{"Token":null,"s":"apikey: x"}"#
        );
        assert_eq!(m(r#"{"Name":"zażółć"}"#), r#"{"Name":"zażółć"}"#);
    }

    #[test]
    fn cg_config() {
        let t = "--bridge-token";
        let k = "0123456789abcdef";
        assert!(cfg(&[t, k, "--cg-url", "http://cg:7700"], &[]).is_err());
        assert!(cfg(
            &[t, k, "--cg-url", "https://cg"],
            &[("VIZRS_LIVE_CG_TOKEN", "x")]
        )
        .is_err());
        let c = cfg(
            &[t, k],
            &[
                ("VIZRS_LIVE_CG_URL", "http://cg:7700/"),
                ("VIZRS_LIVE_CG_TOKEN", "x"),
            ],
        )
        .unwrap();
        assert_eq!(
            (c.cg_url.as_str(), c.cg_token.as_str()),
            ("http://cg:7700", "x")
        );
    }

    #[test]
    fn cg_whitelist() {
        assert_eq!(cg_path("GET", "health").as_deref(), Some("/health"));
        assert_eq!(
            cg_path("GET", "ingest/24").as_deref(),
            Some("/ingest/state?channel=24")
        );
        assert_eq!(
            cg_path("GET", "pages/1.5").as_deref(),
            Some("/etv/pages?channel=1.5")
        );
        assert_eq!(
            cg_path("POST", "live/channels/24/hold").as_deref(),
            Some("/api/live/channels/24/hold")
        );
        assert_eq!(
            cg_path("DELETE", "live/shows/24-wiadomosci").as_deref(),
            Some("/api/live/shows/24-wiadomosci")
        );
        assert_eq!(
            cg_path("PUT", "live/graphics").as_deref(),
            Some("/api/live/graphics")
        );
        assert_eq!(cg_path("DELETE", "live/graphics"), None);
        assert_eq!(
            cg_path("PUT", "live/settings").as_deref(),
            Some("/api/live/settings")
        );
        assert_eq!(cg_path("GET", "live/settings"), None);
        assert_eq!(operator_name(None), "VizRS Live");
        assert_eq!(operator_name(Some("  ")), "VizRS Live");
        assert_eq!(
            operator_name(Some("Stanowisko%20%C5%81%0D%0AX-Evil:%201")),
            "VizRS Live · Stanowisko ŁX-Evil: 1"
        );
        assert_eq!(operator_name(Some("a%zz")), "VizRS Live · a%zz");
        assert_eq!(
            operator_name(Some(&"x".repeat(99))).chars().count(),
            13 + 40
        );
        assert_eq!(cg_path("GET", "ingest/24&x=1"), None);
        assert_eq!(cg_path("GET", "pages/.."), None);
        assert_eq!(cg_path("DELETE", "live/channels/24"), None);
        assert_eq!(cg_path("POST", "live/channels/24/delete"), None);
        assert_eq!(
            cg_error("{\"error\": \"zły \\\"tytuł\\\"\"}").as_deref(),
            Some("zły \"tytuł\"")
        );
        assert_eq!(cg_error("nic"), None);
        let a = app(None);
        assert_eq!(route(&a, &req("GET", "/api/cg/health", &[])).status, 409);
        assert_eq!(
            route(&a, &req("PUT", "/api/cg/live/channels/1", &[])).status,
            403
        );
    }

    #[test]
    fn constant_time_eq() {
        assert!(eq_ct("abc", "abc"));
        assert!(!eq_ct("abc", "abd"));
        assert!(!eq_ct("abc", "ab"));
    }

    fn app(token: Option<&str>) -> App {
        let mut c = cfg(
            &["--bridge-token", T, "--bridge", "http://127.0.0.1:1"],
            &[],
        )
        .unwrap();
        c.token = token.map(String::from);
        App {
            bridge: Bridge {
                target: bridge::parse_url(&c.bridge_url).unwrap(),
                token: T.into(),
                prefix: "/vizrs-bridge",
                auth: "X-VizRS-Token",
            },
            cg: None,
            login_fails: std::sync::Mutex::new((std::time::Instant::now(), 0)),
            cfg: c,
        }
    }

    fn req(method: &str, path: &str, headers: &[(&str, &str)]) -> Request {
        Request {
            method: method.into(),
            path: path.into(),
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn every_static_file_served() {
        let a = app(Some(T));
        for (p, ct, body) in STATIC {
            let r = route(&a, &req("GET", p, &[]));
            assert_eq!(r.status, 200, "{p}");
            assert!(!body.is_empty(), "{p} pusty");
            assert_eq!(r.content_type, *ct, "{p}");
        }
    }

    /// Każdy import modułu w UI (`from './x.js'`, `import './views/y.js'`) wskazuje plik ze STATIC.
    #[test]
    fn module_imports_resolve() {
        for (p, _, body) in STATIC.iter().filter(|(p, _, _)| p.ends_with(".js")) {
            let dir = &p[..p.rfind('/').unwrap() + 1];
            for line in body.lines() {
                let l = line.trim_start();
                if !l.starts_with("import ") {
                    continue;
                }
                let Some(spec) = l.split(['\'', '"']).nth(1) else {
                    continue;
                };
                let mut parts: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
                for seg in spec.split('/') {
                    match seg {
                        "." => {}
                        ".." => {
                            parts.pop();
                        }
                        s => parts.push(s),
                    }
                }
                let target = format!("/{}", parts.join("/"));
                assert!(
                    STATIC.iter().any(|(q, _, _)| *q == target),
                    "{p}: import {spec} -> {target} nie ma w STATIC"
                );
            }
        }
    }

    #[test]
    fn routes_and_guards() {
        let a = app(Some(T));
        assert_eq!(route(&a, &req("GET", "/", &[])).status, 200);
        assert_eq!(
            route(&a, &req("GET", "/health", &[])).status,
            200,
            "zdrowie bez tokenu"
        );
        assert_eq!(route(&a, &req("GET", "/nie", &[])).status, 404);
        assert_eq!(route(&a, &req("GET", "/api/status", &[])).status, 401);
        assert_eq!(
            route(
                &a,
                &req(
                    "POST",
                    "/api/cmd/GetAllChannels",
                    &[("Cookie", &format!("vizrs_live={T}"))]
                )
            )
            .status,
            403,
            "bez X-VizRS-Live"
        );
        let ok = route(
            &a,
            &req(
                "GET",
                "/api/status",
                &[("Authorization", &format!("Bearer {T}"))],
            ),
        );
        assert_eq!(ok.status, 200);
        assert!(
            String::from_utf8_lossy(&ok.body).contains("\"bridgeError\":\""),
            "most nieosiągalny opisany w statusie"
        );
        let bad = route(
            &a,
            &req(
                "POST",
                "/api/cmd/..",
                &[
                    ("X-VizRS-Live", "1"),
                    ("Cookie", &format!("vizrs_live={T}")),
                ],
            ),
        );
        assert_eq!(bad.status, 400);
        let down = route(
            &a,
            &req(
                "POST",
                "/api/cmd/GetAllChannels",
                &[
                    ("X-VizRS-Live", "1"),
                    ("Cookie", &format!("vizrs_live={T}")),
                ],
            ),
        );
        assert_eq!(down.status, 502);
        assert_eq!(
            route(&app(None), &req("GET", "/api/commands", &[])).status,
            502,
            "bez tokenu panelu lokalnie wpuszcza"
        );
    }

    #[test]
    fn login_limit_and_cookie() {
        let a = app(Some("0123456789abcdef"));
        for _ in 0..LOGIN_MAX_FAILS {
            assert!(!login_limited(&a, false));
            login_limited(&a, true);
        }
        let mut r = req("POST", "/api/login", &[("X-VizRS-Live", "1")]);
        r.body = b"0123456789abcdef".to_vec();
        assert_eq!(route(&a, &r).status, 429, "nawet dobry token po 10 błędach");
        let b = app(Some("0123456789abcdef"));
        let ok = route(&b, &r);
        assert_eq!(ok.status, 200);
        let c = &ok.headers.iter().find(|h| h.0 == "Set-Cookie").unwrap().1;
        assert!(c.contains("HttpOnly") && c.contains("SameSite=Strict") && !c.contains("Secure"));
        let mut tls = req(
            "POST",
            "/api/login",
            &[("X-VizRS-Live", "1"), ("X-Forwarded-Proto", "https")],
        );
        tls.body = r.body.clone();
        let c2 = route(&b, &tls);
        assert!(c2.headers.iter().any(|h| h.1.ends_with("; Secure")));
        let mut out = Vec::new();
        Response::json(200, "{}").write_to(&mut out).unwrap();
        let head = String::from_utf8_lossy(&out);
        assert!(head.contains("frame-ancestors 'none'") && head.contains("X-Frame-Options: DENY"));
    }

    #[test]
    fn exposure_probes() {
        let mut a = app(None);
        let r = route(&a, &req("GET", "/api/exposure", &[]));
        assert_eq!(r.status, 200);
        assert!(String::from_utf8_lossy(&r.body).contains("panel bez --stream-url"));
        a.cfg.stream_url = "http://127.0.0.1:1".into();
        let body = String::from_utf8_lossy(&route(&a, &req("GET", "/api/exposure", &[])).body)
            .into_owned();
        for p in EXPOSURE_PROBES {
            assert!(
                body.contains(&format!("{{\"path\":\"{p}\",\"status\":null")),
                "{body}"
            );
        }
        assert_eq!(
            route(&app(Some("t")), &req("GET", "/api/exposure", &[])).status,
            401
        );
    }
}

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
        "/views/listy.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/listy.js"),
    ),
    (
        "/views/playouty.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/playouty.js"),
    ),
    (
        "/views/ramowka.js",
        "text/javascript; charset=utf-8",
        include_str!("../web/views/ramowka.js"),
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
            "--web" => c.web = Some(PathBuf::from(val()?)),
            other => return Err(format!("nieznana opcja: {other} (--help)")),
        }
    }
    bridge::parse_url(&c.bridge_url)?;
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
    for u in [&mut c.stream_url, &mut c.vizrs_url] {
        while u.ends_with('/') {
            u.pop();
        }
    }
    Ok(c)
}

struct App {
    cfg: Config,
    bridge: Bridge,
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
        },
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
    if req.method == "POST" && req.header("x-vizrs-live") != Some("1") {
        return Response::error(
            403,
            "brak nagłówka X-VizRS-Live (ochrona przed obcymi stronami)",
        );
    }
    match (req.method.as_str(), path) {
        ("POST", "/api/login") => {
            let given = String::from_utf8_lossy(&req.body).trim().to_string();
            match &app.cfg.token {
                Some(t) if eq_ct(&given, t) => Response::json(200, "{\"ok\":true}").with_header(
                    "Set-Cookie",
                    format!("{COOKIE}={t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000"),
                ),
                Some(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    Response::error(401, "zły token panelu")
                }
                None => Response::json(200, "{\"ok\":true}"),
            }
        }
        ("POST", "/api/logout") => Response::json(200, "{\"ok\":true}").with_header(
            "Set-Cookie",
            format!("{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"),
        ),
        _ if !authorized(app, req) => Response::error(401, "zaloguj się tokenem panelu"),
        ("GET", "/api/status") => status(app),
        ("GET", "/api/commands") => forward(app.bridge.get("/commands"), "commands"),
        ("POST", p) if p.starts_with(http::UPLOAD_PREFIX) => {
            upload(app, req, &p[http::UPLOAD_PREFIX.len()..])
        }
        ("POST", p) if p.starts_with("/api/cmd/") => {
            let name = &p["/api/cmd/".len()..];
            if !valid_command(name) {
                return Response::error(400, "zła nazwa komendy");
            }
            let r = forward(
                app.bridge.post(&format!("/command/{name}"), &req.body),
                name,
            );
            eprintln!("cmd {name} -> {}", r.status);
            r
        }
        _ => Response::error(404, "nieznany adres API"),
    }
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
            "{{\"ok\":true,\"result\":{{\"panel\":{},\"bridgeUrl\":{},\"streamUrl\":{},\"vizrsUrl\":{},\"auth\":{},\"bridge\":{bridge},\"bridgeError\":{err}}}}}",
            json_str(VERSION),
            json_str(&app.cfg.bridge_url),
            json_str(&app.cfg.stream_url),
            json_str(&app.cfg.vizrs_url),
            app.cfg.token.is_some()
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
    Response::new(200, ct, body.as_bytes().to_vec()).with_header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: http: https:; frame-src http: https:; connect-src 'self'; style-src 'self'; script-src 'self'".into(),
    )
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
            },
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
}

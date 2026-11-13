//! VizRS Live – aplikacja panelu kanału na Tauri 2 (Linux, Windows, macOS).
//!
//!   vizrs-live-desktop [local|connect] [--connect URL] [--token T] [--live PLIK] [-- OPCJE vizrs-live]
//!
//! Strona to ten sam panel co w przeglądarce (serwuje go `vizrs-live`). Dwa tryby:
//! - **panel lokalny** – okno uruchamia `vizrs-live --bind 127.0.0.1` na wolnym porcie (konfiguracja: zmienne
//!   `VIZRS_LIVE_*` i opcje po `--`) i zamyka go przy wyjściu;
//! - **klient panelu zdalnego** – okno łączy się z panelem (np. na VPS) przez pośrednika na `127.0.0.1`
//!   (`proxy`), który dokleja token: strona go nie zna.
//!
//! Strona nie ma dostępu do systemu – tylko komunikaty z białej listy (`bridge`) przez komendę `ipc`, i tylko
//! od strony bieżącego panelu (uprawnienie w działaniu: `allow_page`).

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod bridge;
mod connect;
mod gpu;
mod paths;
mod proxy;

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
#[cfg(not(target_os = "linux"))]
use tauri::window::Color;
use tauri::{
    AppHandle, Manager, RunEvent, Theme, UserAttentionType, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const CONNECT: &str = "connect";
const RELEASES: &str = "https://github.com/sdorpl/VizRS-Live/releases";
const TITLE: &str = "VizRS Live";
/// Okno czeka ukryte na pierwszą klatkę strony (bez białego błysku), ale nie dłużej niż tyle.
const REVEAL_AFTER: Duration = Duration::from_millis(2500);
/// Tło okna przed stroną – `--bg` z `vizrs-ui.css` (Windows, macOS).
#[cfg(not(target_os = "linux"))]
const BACKGROUND: Color = Color(0x0e, 0x10, 0x15, 0xff);
/// Most strony: `window.__vizrsPost(tekst)` → komenda `ipc` (jak okna VizRS CG System i Artist).
const IPC_SHIM: &str = r#"(() => {
  window.__vizrsPost = (m) => { window.__TAURI_INTERNALS__.invoke('ipc', { body: String(m) }).catch((e) => console.error('ipc', e)); };
  window.__vizrsShell = { version: '__VERSION__', app: 'live', os: '__OS__' };
})();"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Panel,
    Local,
    Connect,
}

struct Args {
    kind: Kind,
    connect: Option<String>,
    token: Option<String>,
    live: Option<String>,
    /// opcje dla `vizrs-live` (po `--`)
    extra: Vec<String>,
    probe: Option<(PathBuf, PathBuf)>,
}

fn help() -> &'static str {
    "vizrs-live-desktop – aplikacja VizRS Live (Tauri 2)

Użycie: vizrs-live-desktop [local|connect] [opcje] [-- opcje vizrs-live]

  local           panel lokalny: uruchom vizrs-live na tym komputerze (domyślnie, gdy nie zapisano panelu zdalnego)
  connect         najpierw okno „Połącz z panelem” (adres i token panelu zdalnego, lista zapisanych)
  --connect URL   panel zdalny, np. https://live.example.pl (VIZRS_LIVE_CONNECT)
  --token T       token panelu zdalnego (VIZRS_LIVE_TOKEN) – zostaje w programie, strona go nie dostaje
  --live PLIK     program vizrs-live do panelu lokalnego (VIZRS_LIVE_BIN; domyślnie obok programu albo w PATH)
  -- …            opcje panelu lokalnego, np. -- --bridge http://127.0.0.1:8409 --bridge-token …
                  (albo zmienne VIZRS_LIVE_BRIDGE, VIZRS_LIVE_BRIDGE_TOKEN, VIZRS_LIVE_CG_URL… – jak vizrs-live --help)
  --probe JS --probe-out JSON   narzędzie testowe: po wczytaniu strony wykonaj skrypt, zapisz wynik, zakończ

Plik → Połącz z panelem… (Ctrl+Shift+K). Działa jedna instancja programu – kolejne uruchomienie wysuwa okno."
}

fn parse_args(argv: &[String]) -> Result<Args, String> {
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    let mut a = Args {
        kind: Kind::Panel,
        connect: env("VIZRS_LIVE_CONNECT"),
        token: None,
        live: env("VIZRS_LIVE_BIN"),
        extra: vec![],
        probe: None,
    };
    let (mut pj, mut po) = (None, None);
    let mut i = 0;
    while i < argv.len() {
        let flag = argv[i].clone();
        let mut val = || -> Result<String, String> {
            i += 1;
            argv.get(i).cloned().ok_or(format!("{flag}: brak wartości"))
        };
        match flag.as_str() {
            "local" => a.kind = Kind::Local,
            "connect" => a.kind = Kind::Connect,
            "--connect" => a.connect = Some(val()?),
            "--token" => a.token = Some(val()?),
            "--live" => a.live = Some(val()?),
            "--probe" => pj = Some(PathBuf::from(val()?)),
            "--probe-out" => po = Some(PathBuf::from(val()?)),
            "--" => {
                a.extra = argv[i + 1..].to_vec();
                break;
            }
            "--help" | "-h" => {
                println!("{}", help());
                std::process::exit(0);
            }
            "--version" | "-V" => {
                println!("vizrs-live-desktop {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            other if other.starts_with("-psn_") => {}
            other => {
                return Err(format!(
                    "nieznany argument {other} (vizrs-live-desktop --help)"
                ))
            }
        }
        i += 1;
    }
    if a.connect.is_some() {
        // token tylko dla panelu zdalnego; dla lokalnego VIZRS_LIVE_TOKEN czyta sam vizrs-live
        a.token = a.token.or_else(|| env("VIZRS_LIVE_TOKEN"));
        a.connect = Some(connect::normalize_url(
            a.connect.as_deref().unwrap_or_default(),
        )?);
    }
    a.probe = match (pj, po) {
        (Some(j), Some(o)) => Some((j, o)),
        (None, None) => None,
        _ => return Err("--probe i --probe-out podaje się razem".into()),
    };
    Ok(a)
}

/// Gdzie pracuje okno.
enum Mode {
    /// `vizrs-live` uruchomiony przez okno na `127.0.0.1`
    Local { base: String },
    /// panel zdalny przez pośrednika z tokenem
    Remote { url: String, proxy: proxy::Proxy },
    /// przed wyborem (okno połączenia)
    None,
}

struct App {
    mode: Mode,
    /// panel lokalny uruchomiony przez okno (zamykany przy wyjściu)
    child: Option<Child>,
    live: Option<String>,
    extra: Vec<String>,
    probe: Option<(String, PathBuf)>,
    wins: HashSet<String>,
    alert: HashMap<String, bool>,
    focused: Option<String>,
    next: u32,
    allowed: HashSet<String>,
}

impl App {
    /// Adres serwera strony okna i pierwszej strony.
    fn page(&self) -> Option<(String, String)> {
        match &self.mode {
            Mode::Local { base } => Some((base.clone(), format!("{base}/"))),
            Mode::Remote { proxy, .. } => Some((proxy.base.clone(), proxy.start_url())),
            Mode::None => None,
        }
    }
    fn title(&self) -> String {
        match &self.mode {
            Mode::Remote { url, .. } => {
                format!("{TITLE} – {}", url.split("://").nth(1).unwrap_or(url))
            }
            _ => TITLE.into(),
        }
    }
    fn target_label(&self) -> Option<String> {
        self.focused
            .clone()
            .filter(|l| self.wins.contains(l))
            .or_else(|| self.wins.iter().next().cloned())
    }
}

type Shared = Mutex<App>;

fn state(app: &AppHandle) -> std::sync::MutexGuard<'_, App> {
    app.state::<Shared>()
        .inner()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

fn eval_in(app: &AppHandle, label: &str, js: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.eval(js);
    }
}

fn error(app: &AppHandle, msg: &str) {
    eprintln!("{msg}");
    app.dialog()
        .message(msg.to_string())
        .title(TITLE)
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

fn open_external(target: &str) {
    #[cfg(target_os = "windows")]
    let r = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", target])
        .spawn();
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(target).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let r = Command::new("xdg-open").arg(target).spawn();
    if let Err(e) = r {
        eprintln!("nie mogę otworzyć {target}: {e}");
    }
}

fn script() -> String {
    IPC_SHIM
        .replace("__VERSION__", env!("CARGO_PKG_VERSION"))
        .replace("__OS__", std::env::consts::OS)
}

// ------------------------------------------------------------------ panel lokalny

/// Program `vizrs-live`: wskazany, obok tego programu albo w `PATH`.
fn find_live(over: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = over {
        return Some(PathBuf::from(p)).filter(|p| p.is_file());
    }
    let name = if cfg!(windows) {
        "vizrs-live.exe"
    } else {
        "vizrs-live"
    };
    let beside = std::env::current_exe().ok()?.parent()?.join(name);
    if beside.is_file() {
        return Some(beside);
    }
    std::env::var_os("PATH").and_then(|p| {
        std::env::split_paths(&p)
            .map(|d| d.join(name))
            .find(|f| f.is_file())
    })
}

fn health(port: u16) -> bool {
    let Ok(mut s) =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300))
    else {
        return false;
    };
    s.set_read_timeout(Some(Duration::from_secs(2))).ok();
    if s.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut out = String::new();
    s.read_to_string(&mut out).is_ok() && out.starts_with("HTTP/1.1 200")
}

/// Uruchamia `vizrs-live --bind 127.0.0.1 --port <wolny>` i czeka na `/health` (log: katalog stanu `panel.log`).
fn start_local(live: Option<&str>, extra: &[String]) -> Result<(Child, String), String> {
    let bin = find_live(live).ok_or("Nie znaleziono programu vizrs-live (obok aplikacji ani w PATH) – wskaż go: --live PLIK albo VIZRS_LIVE_BIN, albo połącz się z panelem zdalnym (Plik → Połącz z panelem).")?;
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| format!("wolny port: {e}"))?;
    let dir = paths::state_dir();
    std::fs::create_dir_all(&dir).ok();
    let log = dir.join("panel.log");
    if log.exists() {
        std::fs::rename(&log, dir.join("panel.log.1")).ok();
    }
    let out = std::fs::File::create(&log).map_err(|e| format!("{}: {e}", log.display()))?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&bin);
    cmd.args(["--bind", "127.0.0.1", "--port", &port.to_string()])
        .args(extra)
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);
    // panel lokalny słucha tylko na 127.0.0.1 – token operatora niepotrzebny (i nie trafia do strony)
    cmd.env_remove("VIZRS_LIVE_BIND")
        .env_remove("VIZRS_LIVE_PORT");
    let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", bin.display()))?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(15) {
        if let Ok(Some(st)) = child.try_wait() {
            let tail: String = std::fs::read_to_string(&log)
                .unwrap_or_default()
                .lines()
                .rev()
                .take(6)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(format!(
                "Panel lokalny nie wystartował ({st}):\n{tail}\nLog: {}",
                log.display()
            ));
        }
        if health(port) {
            return Ok((child, format!("http://127.0.0.1:{port}")));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let _ = child.kill();
    Err(format!(
        "Panel lokalny nie odpowiada po 15 s. Log: {}",
        log.display()
    ))
}

fn use_local(app: &AppHandle) -> Result<(), String> {
    let (live, extra) = {
        let a = state(app);
        if let (Mode::Local { .. }, Some(_)) = (&a.mode, &a.child) {
            return Ok(());
        }
        (a.live.clone(), a.extra.clone())
    };
    let (child, base) = start_local(live.as_deref(), &extra)?;
    let mut a = state(app);
    if let Some(mut old) = a.child.replace(child) {
        let _ = old.kill();
    }
    a.mode = Mode::Local { base };
    Ok(())
}

fn use_remote(app: &AppHandle, url: String, token: Option<String>) -> Result<(), String> {
    let p = proxy::start(&url, token)?;
    let mut a = state(app);
    a.mode = Mode::Remote { url, proxy: p };
    // panel lokalny nie jest już potrzebny
    if let Some(mut c) = a.child.take() {
        let _ = c.kill();
    }
    Ok(())
}

// ------------------------------------------------------------------ okna

/// Strona bieżącego panelu może wołać komendę `ipc` (adres zna dopiero program – uprawnienie w działaniu).
fn allow_page(app: &AppHandle, base: &str) {
    let n = {
        let mut a = state(app);
        if !a.allowed.insert(base.to_string()) {
            return;
        }
        a.allowed.len()
    };
    let cap = CapabilityBuilder::new(format!("panel-{n}"))
        .remote(format!("{base}/*"))
        .window("live-*")
        .permission("allow-ipc");
    if let Err(e) = app.add_capability(cap) {
        eprintln!("uprawnienie mostu dla {base}: {e}");
    }
}

fn native_look<'a>(
    b: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let b = b
        .theme(Some(Theme::Dark))
        .devtools(true)
        .general_autofill_enabled(false);
    #[cfg(not(target_os = "linux"))]
    let b = b.background_color(BACKGROUND);
    #[cfg(target_os = "macos")]
    let b = b.allow_link_preview(false);
    b
}

fn reveal(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.show();
            let _ = w.maximize();
            let _ = w.set_focus();
        }
    }
}

fn page_loaded(app: &AppHandle, label: &str) {
    if label != CONNECT {
        reveal(app, label);
    }
    let probe = state(app).probe.as_ref().map(|(c, _)| c.clone());
    if let Some(code) = probe {
        eval_in(app, label, &code);
    }
}

fn open_panel(app: &AppHandle) {
    let (page, title, label) = {
        let mut a = state(app);
        let Some(page) = a.page() else {
            drop(a);
            return open_connect(app);
        };
        a.next += 1;
        let label = format!("live-{}", a.next);
        a.wins.insert(label.clone());
        (page, a.title(), label)
    };
    let (base, start) = page;
    allow_page(app, &base);
    let Ok(url) = start.parse() else {
        return error(app, "zły adres panelu");
    };
    let (app_nav, app_new) = (app.clone(), app.clone());
    let built = native_look(WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::External(url),
    ))
    .title(&title)
    .inner_size(1600.0, 900.0)
    .min_inner_size(400.0, 500.0)
    .visible(false)
    .initialization_script(script())
    .on_page_load(|w, p| {
        if p.event() == PageLoadEvent::Finished {
            page_loaded(w.app_handle(), w.label());
        }
    })
    // odnośniki poza panel (Trio VizRS, ErsatzTV, dokumentacja) – w przeglądarce systemowej
    .on_navigation(move |u| {
        let base = state(&app_nav).page().map(|p| p.0).unwrap_or_default();
        let ok = u.as_str().starts_with(&format!("{base}/"))
            || u.scheme() == "about"
            || u.scheme() == "blob"
            || u.scheme() == "data";
        if !ok {
            open_external(u.as_str());
        }
        ok
    })
    .on_new_window(move |u, _| {
        let base = state(&app_new).page().map(|p| p.0).unwrap_or_default();
        // strona panelu w nowym oknie programu nie ma sensu (ten sam panel) – zostaje w tym oknie
        if !u.as_str().starts_with(&format!("{base}/")) {
            open_external(u.as_str());
        }
        NewWindowResponse::Deny
    })
    .build();
    match built {
        Ok(w) => {
            #[cfg(target_os = "linux")]
            let _ = w.with_webview(|pv| {
                use webkit2gtk::{WebContextExt, WebViewExt};
                if let Some(ctx) = pv.inner().context() {
                    ctx.set_spell_checking_enabled(true);
                    ctx.set_spell_checking_languages(&["pl_PL"]);
                }
            });
            #[cfg(not(target_os = "linux"))]
            let _ = &w;
            app.set_theme(Some(Theme::Dark));
            let (app2, l2) = (app.clone(), label.clone());
            std::thread::spawn(move || {
                std::thread::sleep(REVEAL_AFTER);
                let app3 = app2.clone();
                let _ = app2.run_on_main_thread(move || reveal(&app3, &l2));
            });
        }
        Err(e) => {
            state(app).wins.remove(&label);
            error(app, &format!("Nie udało się otworzyć okna: {e}"));
        }
    }
}

fn open_connect(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(CONNECT) {
        let _ = w.set_focus();
        return;
    }
    let data = {
        let a = state(app);
        let (current, local) = match &a.mode {
            Mode::Remote { url, .. } => (url.clone(), Some("lokalnie")),
            Mode::Local { .. } => ("lokalnie".to_string(), Some("lokalnie")),
            Mode::None => (String::new(), Some("lokalnie")),
        };
        connect::page_data(&connect::Saved::load(), &current, None, local)
    };
    let parent = state(app)
        .target_label()
        .and_then(|l| app.get_webview_window(&l));
    let mut b = native_look(WebviewWindowBuilder::new(
        app,
        CONNECT,
        WebviewUrl::App("connect.html".into()),
    ))
    .title("VizRS Live – połącz z panelem")
    .inner_size(560.0, 600.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(parent.is_none())
    .center()
    .initialization_script(format!("{}\n{data}", script()))
    .on_page_load(|w, p| {
        if p.event() == PageLoadEvent::Finished {
            page_loaded(w.app_handle(), w.label());
        }
    });
    if let Some(p) = &parent {
        b = match b.parent(p) {
            Ok(b) => b,
            Err(e) => return error(app, &format!("Nie udało się otworzyć okna połączenia: {e}")),
        };
    }
    match b.build() {
        Ok(w) => {
            #[cfg(not(target_os = "macos"))]
            let _ = w.remove_menu();
            let _ = w.set_focus();
        }
        Err(e) => error(app, &format!("Nie udało się otworzyć okna połączenia: {e}")),
    }
}

fn close_connect(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(CONNECT) {
        let _ = w.destroy();
    }
}

fn conn_error(app: &AppHandle, msg: &str) {
    eval_in(
        app,
        CONNECT,
        &format!(
            "window.__vizrsConnError && window.__vizrsConnError({})",
            Value::from(msg)
        ),
    );
}

/// Przełącza okna panelu na bieżący tryb (okno połączenia się zamyka); bez okien – otwiera panel.
fn switch(app: &AppHandle) {
    close_connect(app);
    let (page, title, labels) = {
        let a = state(app);
        (
            a.page(),
            a.title(),
            a.wins.iter().cloned().collect::<Vec<_>>(),
        )
    };
    if labels.is_empty() {
        return open_panel(app);
    }
    let Some((base, start)) = page else { return };
    allow_page(app, &base);
    for l in labels {
        if let Some(w) = app.get_webview_window(&l) {
            let _ = w.set_title(&title);
            if let Ok(u) = start.parse() {
                let _ = w.navigate(u);
            }
        }
    }
}

fn on_conn(app: &AppHandle, body: &str) {
    let msg = match connect::parse_msg(body) {
        Ok(m) => m,
        Err(e) => return conn_error(app, &e),
    };
    match msg {
        connect::Msg::Cancel => {
            close_connect(app);
            if state(app).wins.is_empty() {
                app.exit(0);
            }
        }
        connect::Msg::Forget(url) => {
            let mut saved = connect::Saved::load();
            saved.forget(&url);
            if let Err(e) = saved.save() {
                conn_error(app, &e);
            }
        }
        connect::Msg::Local => {
            let app2 = app.clone();
            std::thread::spawn(move || {
                let r = use_local(&app2);
                let app3 = app2.clone();
                let _ = app2.run_on_main_thread(move || match r {
                    Ok(()) => switch(&app3),
                    Err(e) => conn_error(&app3, &e),
                });
            });
        }
        connect::Msg::Connect(mut req) => {
            if req.token.is_none() {
                req.token = connect::Saved::load().token_for(&req.url);
            }
            let app = app.clone();
            std::thread::spawn(move || {
                let err = proxy::check(&req.url, req.token.as_deref()).err();
                let app2 = app.clone();
                let _ = app.run_on_main_thread(move || on_checked(&app2, req, err));
            });
        }
    }
}

fn on_checked(app: &AppHandle, req: connect::Request, err: Option<String>) {
    if let Some(e) = err {
        return conn_error(app, &e);
    }
    let connect::Request {
        url,
        token,
        keep_token,
        auto,
    } = req;
    let mut saved = connect::Saved::load();
    saved.remember(&url, token.as_deref(), keep_token, auto);
    if let Err(e) = saved.save() {
        eprintln!("zapis listy paneli: {e}");
    }
    match use_remote(app, url, token) {
        Ok(()) => switch(app),
        Err(e) => conn_error(app, &e),
    }
}

fn on_remote(app: &AppHandle, argv: &[String]) {
    if parse_args(argv).is_ok_and(|a| a.kind == Kind::Connect) {
        return open_connect(app);
    }
    let target = state(app).target_label();
    match target.and_then(|l| app.get_webview_window(&l)) {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        None => open_panel(app),
    }
}

// ------------------------------------------------------------------ most

#[tauri::command]
fn ipc(app: AppHandle, webview: tauri::Webview, body: String) {
    if let Some(rest) = body.strip_prefix("probe:") {
        let out = state(&app).probe.as_ref().map(|(_, o)| o.clone());
        if let Some(out) = out {
            if let Err(e) = std::fs::write(&out, rest) {
                eprintln!("{}: {e}", out.display());
            }
            app.exit(0);
        }
        return;
    }
    let label = webview.label().to_string();
    if label == CONNECT {
        return on_conn(&app, &body);
    }
    let Some(rest) = body.strip_prefix("app:") else {
        return;
    };
    let from = webview.url().map(|u| u.to_string()).unwrap_or_default();
    let (base, suffix) = {
        let a = state(&app);
        (
            a.page().map(|p| p.0).unwrap_or_default(),
            a.title().strip_prefix(TITLE).unwrap_or("").to_string(),
        )
    };
    if !label.starts_with("live-") || base.is_empty() || !from.starts_with(&format!("{base}/")) {
        return;
    }
    let Some(bridge::Msg::State { title, alert }) = bridge::parse(rest) else {
        return;
    };
    let changed = {
        let mut a = state(&app);
        let focused = a.focused.as_deref() == Some(label.as_str());
        let old = a.alert.insert(label.clone(), alert).unwrap_or(false);
        (old != alert).then_some(alert && !focused)
    };
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_title(&format!("{title}{suffix}"));
        if let Some(att) = changed {
            let _ = w.request_user_attention(att.then_some(UserAttentionType::Critical));
        }
    }
}

// ------------------------------------------------------------------ menu

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    type Item = dyn tauri::menu::IsMenuItem<tauri::Wry>;
    let mac = cfg!(target_os = "macos");
    let item =
        |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
    let sep = || PredefinedMenuItem::separator(app);
    let quit = item(
        "quit",
        if mac {
            "Zakończ VizRS Live"
        } else {
            "Zakończ"
        },
        if cfg!(target_os = "windows") {
            None
        } else {
            Some("CmdOrCtrl+Q")
        },
    )?;
    let connect = item("connect", "Połącz z panelem…", Some("CmdOrCtrl+Shift+K"))?;
    let new_window = item("new-window", "Nowe okno", Some("CmdOrCtrl+Shift+N"))?;
    let close = item("close", "Zamknij okno", Some("CmdOrCtrl+W"))?;
    let (s1, s2, s3) = (sep()?, sep()?, sep()?);
    let mut file: Vec<&Item> = vec![&connect, &s1, &new_window, &s2, &close];
    if !mac {
        file.extend([&s3 as &Item, &quit]);
    }
    let reload = item("reload", "Odśwież", Some("F5"))?;
    let full = item("fullscreen", "Pełny ekran", Some("F11"))?;
    let zin = item("zoom-in", "Powiększ", Some("CmdOrCtrl+="))?;
    let zout = item("zoom-out", "Pomniejsz", Some("CmdOrCtrl+-"))?;
    let z0 = item("zoom-reset", "Rozmiar 100%", Some("CmdOrCtrl+0"))?;
    let dev = item(
        "devtools",
        "Narzędzia deweloperskie",
        Some("CmdOrCtrl+Shift+I"),
    )?;
    let (s4, s5) = (sep()?, sep()?);
    let view: Vec<&Item> = vec![&reload, &full, &s4, &zin, &zout, &z0, &s5, &dev];
    let logs = item("logs", "Pokaż logi panelu lokalnego", None)?;
    let updates = item("updates", "Sprawdź aktualizacje", None)?;
    let about = item(
        "about",
        if mac {
            "O programie VizRS Live"
        } else {
            "O programie"
        },
        None,
    )?;
    let (s6, s7) = (sep()?, sep()?);
    let mut help: Vec<&Item> = vec![&logs, &s6, &updates];
    if !mac {
        help.extend([&s7 as &Item, &about]);
    }
    let help_menu = Submenu::with_items(app, "Pomo&c", true, &help)?;
    #[allow(unused_mut)]
    let mut subs = vec![
        Submenu::with_items(app, "&Plik", true, &file)?,
        Submenu::with_items(app, "&Widok", true, &view)?,
    ];
    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "VizRS Live",
            true,
            &[
                &about as &Item,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, Some("Ukryj VizRS Live"))?,
                &PredefinedMenuItem::hide_others(app, Some("Ukryj pozostałe"))?,
                &PredefinedMenuItem::show_all(app, Some("Pokaż wszystko"))?,
                &PredefinedMenuItem::separator(app)?,
                &quit,
            ],
        )?;
        let edit = Submenu::with_items(
            app,
            "Edycja",
            true,
            &[
                &PredefinedMenuItem::undo(app, Some("Cofnij"))? as &Item,
                &PredefinedMenuItem::redo(app, Some("Ponów"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some("Wytnij"))?,
                &PredefinedMenuItem::copy(app, Some("Kopiuj"))?,
                &PredefinedMenuItem::paste(app, Some("Wklej"))?,
                &PredefinedMenuItem::select_all(app, Some("Zaznacz wszystko"))?,
            ],
        )?;
        let window_menu = Submenu::with_items(
            app,
            "Okno",
            true,
            &[
                &PredefinedMenuItem::minimize(app, Some("Zminimalizuj"))? as &Item,
                &PredefinedMenuItem::maximize(app, Some("Powiększ okno"))?,
            ],
        )?;
        window_menu.set_as_windows_menu_for_nsapp()?;
        help_menu.set_as_help_menu_for_nsapp()?;
        subs.insert(0, app_menu);
        subs.insert(2, edit);
        subs.push(window_menu);
    }
    subs.push(help_menu);
    let refs: Vec<&Item> = subs.iter().map(|s| s as &Item).collect();
    Menu::with_items(app, &refs)
}

fn on_menu(app: &AppHandle, id: &str) {
    let target = state(app).target_label();
    let win = target.as_deref().and_then(|l| app.get_webview_window(l));
    match id {
        "connect" => open_connect(app),
        "new-window" => open_panel(app),
        "close" => {
            if let Some(w) = win {
                let _ = w.close();
            }
        }
        "quit" => app.exit(0),
        "reload" => {
            if let Some(w) = win {
                let _ = w.eval("location.reload()");
            }
        }
        "fullscreen" => {
            if let Some(w) = win {
                let _ = w.set_fullscreen(!w.is_fullscreen().unwrap_or(false));
            }
        }
        "zoom-in" | "zoom-out" | "zoom-reset" => {
            if let Some(w) = win {
                let z = zoom_step(app, w.label(), id);
                let _ = w.set_zoom(z);
            }
        }
        "devtools" => {
            if let Some(w) = win {
                w.open_devtools();
            }
        }
        "logs" => open_external(&paths::state_dir().to_string_lossy()),
        "updates" => open_external(RELEASES),
        "about" => {
            let msg = {
                let a = state(app);
                let mode = match &a.mode {
                    Mode::Local { base } => format!(
                        "panel lokalny ({base}, log: {})",
                        paths::state_dir().join("panel.log").display()
                    ),
                    Mode::Remote { url, .. } => format!(
                        "panel zdalny {url} (przez pośrednika okna – token zostaje w programie)"
                    ),
                    Mode::None => "nie połączono".into(),
                };
                format!(
                    "VizRS Live – aplikacja (vizrs-live-desktop {}, Tauri 2)\n{mode}",
                    env!("CARGO_PKG_VERSION")
                )
            };
            app.dialog().message(msg).title("O programie").show(|_| {});
        }
        _ => {}
    }
}

/// Powiększenie okna (menu Widok): ×1,1 / ÷1,1 / 100%, w granicach 30–300%.
fn zoom_step(app: &AppHandle, label: &str, id: &str) -> f64 {
    let zooms = app.state::<Zooms>();
    let mut m = zooms.lock().unwrap_or_else(|p| p.into_inner());
    let z = m.entry(label.to_string()).or_insert(1.0);
    *z = match id {
        "zoom-in" => (*z * 1.1).min(3.0),
        "zoom-out" => (*z / 1.1).max(0.3),
        _ => 1.0,
    };
    *z
}

type Zooms = Mutex<HashMap<String, f64>>;

// ------------------------------------------------------------------ start

fn main() {
    // akceleracja WebKitGTK: zmienne środowiska przed startem GTK i przed powstaniem wątków (gpu.rs)
    let gpu_note = gpu::prepare(None);
    if !gpu_note.is_empty() {
        eprintln!("GPU: {gpu_note}");
    }
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = match parse_args(&argv) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let probe = args
        .probe
        .as_ref()
        .map(|(js, out)| match std::fs::read_to_string(js) {
            Ok(code) => (code, out.clone()),
            Err(e) => {
                eprintln!("{}: {e}", js.display());
                std::process::exit(2);
            }
        });
    let auto = if args.connect.is_none() && args.kind != Kind::Local {
        connect::Saved::load().auto
    } else {
        None
    };
    let app_state = App {
        mode: Mode::None,
        child: None,
        live: args.live.clone(),
        extra: args.extra.clone(),
        probe,
        wins: HashSet::new(),
        alert: HashMap::new(),
        focused: None,
        next: 0,
        allowed: HashSet::new(),
    };
    let mut builder = tauri::Builder::default();
    if args.probe.is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let argv: Vec<String> = argv.into_iter().skip(1).collect();
            on_remote(app, &argv);
        }));
    }
    let (kind, connect_url, token) = (args.kind, args.connect.clone(), args.token.clone());
    let built = builder
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(app_state))
        .manage(Zooms::default())
        .invoke_handler(tauri::generate_handler![ipc])
        .setup(move |app| {
            let h = app.handle().clone();
            h.set_theme(Some(Theme::Dark));
            app.set_menu(build_menu(&h)?)?;
            app.on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()));
            // panel: zdalny (--connect albo zapisany „przy uruchomieniu”), okno połączenia albo lokalny
            let started = if let Some(c) = connect_url {
                use_remote(&h, c, token)
            } else if let Some(a) = auto {
                let t = connect::Saved::load().token_for(&a);
                use_remote(&h, a, t)
            } else if kind == Kind::Connect {
                Ok(())
            } else {
                use_local(&h)
            };
            match started {
                Ok(()) if kind != Kind::Connect => open_panel(&h),
                Ok(()) => open_connect(&h),
                // bez panelu lokalnego (brak vizrs-live, zła konfiguracja) – wybór panelu zdalnego z komunikatem
                Err(e) if kind == Kind::Panel => {
                    open_connect(&h);
                    let (h2, msg) = (h.clone(), e.clone());
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(800));
                        let h3 = h2.clone();
                        let _ = h2.run_on_main_thread(move || conn_error(&h3, &msg));
                    });
                    eprintln!("{e}");
                }
                Err(e) => {
                    eprintln!("{e}");
                    let h2 = h.clone();
                    h.dialog()
                        .message(e)
                        .title(TITLE)
                        .kind(MessageDialogKind::Error)
                        .show(move |_| h2.exit(1));
                }
            }
            Ok(())
        })
        .on_window_event(|w, ev| {
            let label = w.label().to_string();
            let app = w.app_handle();
            match ev {
                WindowEvent::Focused(true) if label != CONNECT => state(app).focused = Some(label),
                WindowEvent::Destroyed => {
                    {
                        let mut a = state(app);
                        a.wins.remove(&label);
                        a.alert.remove(&label);
                    }
                    if app.webview_windows().is_empty() {
                        app.exit(0);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!());
    let app = match built {
        Ok(a) => a,
        Err(e) => {
            eprintln!("vizrs-live-desktop: {e}");
            std::process::exit(1);
        }
    };
    app.run(|app, ev| {
        // panel lokalny żyje tylko z oknem; pośrednik kończy się razem z procesem
        if let RunEvent::Exit = ev {
            if let Some(mut c) = state(app).child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Result<Args, String> {
        parse_args(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn command_line() {
        let a = args(&[
            "local",
            "--live",
            "/x/vizrs-live",
            "--",
            "--bridge",
            "http://b:8409",
            "--bridge-token",
            "t",
        ])
        .unwrap();
        assert_eq!(a.kind, Kind::Local);
        assert_eq!(a.live.as_deref(), Some("/x/vizrs-live"));
        assert_eq!(
            a.extra,
            ["--bridge", "http://b:8409", "--bridge-token", "t"]
        );
        let a = args(&["--connect", "https://live.example.pl/", "--token", "abc"]).unwrap();
        assert_eq!(a.connect.as_deref(), Some("https://live.example.pl"));
        assert_eq!(a.token.as_deref(), Some("abc"));
        assert_eq!(args(&["connect"]).unwrap().kind, Kind::Connect);
        assert!(args(&["--probe", "a.js"]).is_err());
        assert!(args(&["--nieznana"]).is_err());
        assert!(args(&["-psn_0_1"]).is_ok());
    }
}

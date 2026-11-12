//! Katalogi użytkownika: stan programu (logi panelu lokalnego).

use std::path::PathBuf;

/// Katalog stanu (logi): Linux `~/.local/state/vizrs-live`, Windows `%LOCALAPPDATA%\VizRS Live`, macOS `~/Library/Logs/VizRS Live`.
pub fn state_dir() -> PathBuf {
    let env = |k: &str| {
        std::env::var_os(k)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    let d = if cfg!(windows) {
        env("LOCALAPPDATA").map(|d| d.join("VizRS Live"))
    } else if cfg!(target_os = "macos") {
        env("HOME").map(|h| h.join("Library/Logs/VizRS Live"))
    } else {
        env("XDG_STATE_HOME")
            .or_else(|| env("HOME").map(|h| h.join(".local/state")))
            .map(|d| d.join("vizrs-live"))
    };
    d.unwrap_or_else(std::env::temp_dir)
}

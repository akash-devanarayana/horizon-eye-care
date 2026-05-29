# Horizon 2.0.0 — Tauri Rewrite Scope

Status: **planning / spike**. Target: replace the Electron app (v1.x, ~82 MB installer)
with a Tauri 2.x build (~3–6 MB installer) using the OS WebView2 instead of bundling
Chromium.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Frontend | **Keep vanilla HTML/CSS/JS.** Reuse `overlay/settings/stats/update-toast.html` + `fonts.css` nearly verbatim; only rewire `window.horizon.*` → Tauri `invoke()` via a thin shim. |
| Updater | **Tauri signed auto-updater** (`tauri-plugin-updater`) — needs a signing keypair + signed `latest.json` per release. |
| Build/dev environment | **GitHub Actions (Windows runner)**, via `tauri-apps/tauri-action`. No local Rust toolchain on the dev machine. |

## Why builds happen in CI (not locally)

The dev machine has **Smart App Control (SAC) ON and enforced** (Win11). Consequences:
- SAC blocks the VS Build Tools sub-components (UCRT redist) → local MSVC/SDK install
  cannot complete. (rustup installed fine; MSVC + Windows SDK did not.)
- SAC has **no per-app allowlist**, and turning it off is **irreversible** (requires a
  Windows reinstall to re-enable). We chose **not** to disable it.
- Therefore: compile/bundle in CI.

### Runtime testing caveat
CI-built binaries are **unsigned**, so SAC will also block *running* them on this machine.
Runtime verification (seeing the overlay/tray actually work) must happen on:
- a non-SAC Windows machine or VM, **or**
- after acquiring an Authenticode code-signing cert (OV ~$200/yr), which makes the app
  trusted by SAC + SmartScreen. This is the real long-term distribution fix.

CI de-risks **compilation + bundling**. It cannot de-risk runtime behavior on this box.

## Architecture mapping (Electron → Tauri 2.x)

| Electron (`main.js`) | Tauri 2.x |
|---|---|
| `app` lifecycle | `tauri::Builder` |
| `BrowserWindow` ×4 (overlay, settings, stats, update-toast) | `WebviewWindow` (config + runtime `WebviewWindowBuilder`) |
| overlay: fullscreen, always-on-top, transparent, skip-taskbar, frameless | window flags (all supported) |
| `Tray` + tooltip + context menu | `tauri::tray::TrayIconBuilder` + `tauri::menu` |
| `ipcMain.handle/on` (9 channels) | `#[tauri::command]` functions + `emit`/events |
| `fs` + `app.getPath('userData')` | `app.path().app_config_dir()` + `std::fs` (or `tauri-plugin-store`) |
| `shell.openExternal` | `tauri-plugin-opener` / `tauri-plugin-shell` |
| `dialog.showMessageBox` | `tauri-plugin-dialog` |
| work/break `setTimeout` loop + pause/skip/DND | shared state `Arc<Mutex<…>>` driven by `tokio` tasks |
| **koffi → `SHQueryUserNotificationState`** | `windows` crate, `Win32::UI::Shell::SHQueryUserNotificationState` (native, no FFI dep) |
| sound via base64 data-URL (asar workaround) | **plays normally** from bundled assets — workaround deleted |
| GitHub update check (`https`) | `reqwest` in Rust, or `tauri-plugin-updater` |

## IPC surface to port (9 channels)

- `get-settings` (invoke), `save-settings`, `close-settings`
- `get-stats` (invoke), `close-stats`
- `skip-break`
- `get-update-info` (invoke), `update-download`, `update-dismiss`

## The three real work items

1. **Fullscreen detection** — port `SHQueryUserNotificationState` to the `windows` crate
   (~20 lines). States 2/3/4/7 = busy/fullscreen/presentation → auto-pause.
2. **Timer state machine** — the work→break→overlay loop with pause, skip, DND auto-pause,
   and the end-chime lead time. Becomes shared Rust state + async tasks. The heart of the app.
3. **Sounds get simpler** — no asar, so real bundled assets play directly.

## Phasing

1. **Spike (this branch):** minimal Tauri PoC — tray + transparent fullscreen window +
   the Rust `SHQueryUserNotificationState` command — proven to **compile & bundle in CI**.
2. **Core loop:** timer state machine + overlay show/hide + skip.
3. **Windows:** wire settings & stats commands to the existing (reused) HTML.
4. **Polish:** sounds, signed auto-updater, packaging (Tauri NSIS bundler), then signing.

## Prereqs status

- ✅ rustup / cargo 1.96 (MSVC host) — installed
- ✅ WebView2 runtime v148 — present
- ❌ MSVC + Windows SDK locally — blocked by SAC (using CI instead)
- ✅ GitHub Actions — available (repo already on GitHub)

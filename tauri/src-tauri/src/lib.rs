// Horizon — Tauri spike.
// Proves the three pieces that were unknowns vs. the Electron build:
//   1. a system tray icon + menu,
//   2. a transparent, always-on-top, fullscreen overlay window,
//   3. the Win32 SHQueryUserNotificationState call (fullscreen / DND detection)
//      that replaces the Electron koffi FFI.

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// Returns the raw QUERY_USER_NOTIFICATION_STATE value (1..=7), or -1 on error.
/// 2=BUSY, 3=D3D fullscreen, 4=presentation, 7=fullscreen app => "do not disturb".
#[tauri::command]
fn notification_state() -> i32 {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::SHQueryUserNotificationState;
        unsafe {
            match SHQueryUserNotificationState() {
                Ok(state) => state.0,
                Err(_) => -1,
            }
        }
    }
    #[cfg(not(windows))]
    {
        -1
    }
}

/// True when a fullscreen game / video / presentation is in the foreground.
#[tauri::command]
fn is_fullscreen_app() -> bool {
    matches!(notification_state(), 2 | 3 | 4 | 7)
}

/// Show/hide the transparent fullscreen overlay (declared in tauri.conf.json).
#[tauri::command]
fn toggle_overlay(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("overlay") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Tray icon with a minimal menu.
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Horizon (spike)")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            // Overlay starts hidden; toggled via the command.
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.hide();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            notification_state,
            is_fullscreen_app,
            toggle_overlay
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use tauri::AppHandle;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::ManagerExt;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
    let qr = MenuItem::with_id(app, "qr", "Show QR Code", true, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        autostart_on,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit ScanToPrint", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &qr, &autostart, &sep, &quit])?;

    let autostart_item = autostart.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip("ScanToPrint — accepting print jobs")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => crate::show_dashboard(app),
            "qr" => crate::open_path(app, "/admin/qr"),
            "autostart" => {
                let al = app.autolaunch();
                let now_on = al.is_enabled().unwrap_or(false);
                let res = if now_on { al.disable() } else { al.enable() };
                if let Err(e) = res {
                    tracing::warn!("autostart toggle failed: {e}");
                }
                let _ = autostart_item.set_checked(al.is_enabled().unwrap_or(false));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_dashboard(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Shown when the server can't start (e.g. port 8080 used by another program).
pub fn set_error(app: &AppHandle, msg: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("ScanToPrint — NOT RUNNING: {msg}")));
    }
}

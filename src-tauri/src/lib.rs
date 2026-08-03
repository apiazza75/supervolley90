//! Native shell for Super Volley 90.
//!
//! All the game logic lives in the web view; this crate only opens the window
//! and gets out of the way. Keeping the Rust side this thin means the game can
//! also be run straight from `npm run dev` in a browser, which is how the
//! headless tests and screenshot tooling exercise it.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    // A game wants the whole window; the traffic lights still
                    // float over the canvas thanks to the overlay title bar.
                    let _ = window.set_title("Super Volley 90");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Super Volley 90");
}

// Prevent a console window from opening alongside the app on Windows release
// builds. Harmless on macOS, and keeps a future cross-platform build honest.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    supervolley90_lib::run();
}

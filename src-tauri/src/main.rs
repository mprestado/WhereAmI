#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod task_overlay;

fn main() {
    let app = tauri::Builder::default();
    #[cfg(target_os = "windows")]
    let app = app
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = task_overlay::focus_main_window(app);
        }))
        .manage(task_overlay::Overlay::default())
        .setup(|app| {
            if let Err(error) = task_overlay::install_tray(app.handle()) {
                eprintln!("Could not add WhereAmI to the Windows notification area: {error}");
            }
            Ok(())
        })
        .on_window_event(task_overlay::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            task_overlay::open_task_overlay,
            task_overlay::get_task_overlay,
            task_overlay::set_task_overlay,
            task_overlay::drag_task_overlay,
            task_overlay::close_task_overlay,
            task_overlay::show_main_window
        ]);

    app
        .run(tauri::generate_context!())
        .expect("WhereAmI could not start");
}

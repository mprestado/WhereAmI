use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Monitor,
};

const MAIN: &str = "main";
const OVERLAY: &str = "task-overlay";
const TRAY: &str = "whereami-tray";
const WIDTH: f64 = 344.0;
const EXPANDED_HEIGHT: f64 = 408.0;
const COLLAPSED_HEIGHT: f64 = 52.0;
const MIN_WIDTH: f64 = 300.0;
const MIN_EXPANDED_HEIGHT: f64 = 232.0;
const MARGIN: f64 = 16.0;

type OverlayResult = Result<(), String>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Expanded,
    Collapsed,
}

impl Mode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "expanded" => Ok(Self::Expanded),
            "collapsed" => Ok(Self::Collapsed),
            _ => Err("Unknown task overlay mode.".into()),
        }
    }

    fn size(self, expanded_size: LogicalSize<f64>) -> LogicalSize<f64> {
        let height = match self {
            Self::Expanded => expanded_size.height.max(MIN_EXPANDED_HEIGHT),
            Self::Collapsed => COLLAPSED_HEIGHT,
        };
        LogicalSize::new(expanded_size.width.max(MIN_WIDTH), height)
    }

    fn name(self) -> &'static str {
        match self {
            Self::Expanded => "expanded",
            Self::Collapsed => "collapsed",
        }
    }
}

struct Geometry {
    mode: Mode,
    expanded_size: LogicalSize<f64>,
}

pub struct Overlay {
    geometry: Mutex<Geometry>,
    creating: AtomicBool,
}

impl Default for Overlay {
    fn default() -> Self {
        Self {
            geometry: Mutex::new(Geometry {
                mode: Mode::Expanded,
                expanded_size: LogicalSize::new(WIDTH, EXPANDED_HEIGHT),
            }),
            creating: AtomicBool::new(false),
        }
    }
}

struct CreationGuard<'a>(&'a AtomicBool);

impl Drop for CreationGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn window_error(error: tauri::Error) -> String {
    format!("Windows could not update the task overlay: {error}")
}

fn overlay_window(window: &WebviewWindow) -> OverlayResult {
    if window.label() != OVERLAY {
        return Err("This action belongs to the task overlay window.".into());
    }
    Ok(())
}

fn monitor_for(window: &WebviewWindow) -> Option<Monitor> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
}

fn resize_overlay(
    window: &WebviewWindow,
    mode: Mode,
    expanded_size: LogicalSize<f64>,
    monitor: Option<&Monitor>,
    anchor: bool,
) -> tauri::Result<()> {
    let requested = mode.size(expanded_size);
    let minimum = if mode == Mode::Expanded {
        let mut size = LogicalSize::new(MIN_WIDTH, MIN_EXPANDED_HEIGHT);
        if let Some(monitor) = monitor {
            let available = monitor.work_area().size.to_logical(monitor.scale_factor());
            size.width = size.width.min(available.width);
            size.height = size.height.min(available.height);
        }
        Some(size)
    } else {
        None
    };
    window.set_min_size(minimum)?;
    window.set_resizable(mode == Mode::Expanded)?;
    let Some(monitor) = monitor else {
        return window.set_size(requested);
    };
    let area = monitor.work_area();
    let requested = requested.to_physical::<u32>(monitor.scale_factor());
    let size = PhysicalSize::new(
        requested.width.min(area.size.width),
        requested.height.min(area.size.height),
    );
    let max_x = area.position.x + area.size.width.saturating_sub(size.width) as i32;
    let max_y = area.position.y + area.size.height.saturating_sub(size.height) as i32;
    let position = if anchor {
        let margin = (MARGIN * monitor.scale_factor()).round() as i32;
        PhysicalPosition::new(
            (max_x - margin).max(area.position.x),
            (area.position.y + margin).min(max_y),
        )
    } else {
        let current = window.outer_position()?;
        PhysicalPosition::new(
            current.x.clamp(area.position.x, max_x),
            current.y.clamp(area.position.y, max_y),
        )
    };
    if window.outer_position()? != position {
        window.set_position(position)?;
    }
    window.set_size(size)?;
    Ok(())
}

pub fn focus_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN) {
        window.show()?;
        if window.is_minimized()? {
            window.unminimize()?;
        }
        window.set_focus()?;
    }
    Ok(())
}

// WebView2 window creation must run outside Windows' main event callback.
fn open_overlay_window(app: &AppHandle) -> OverlayResult {
    if let Some(window) = app.get_webview_window(OVERLAY) {
        window.show().map_err(window_error)?;
        return window.set_focus().map_err(window_error);
    }
    let state = app.state::<Overlay>();
    if state.creating.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let _guard = CreationGuard(&state.creating);
    let expanded_size = {
        let mut geometry = state.geometry.lock().map_err(|_| "The task overlay is unavailable.")?;
        geometry.mode = Mode::Expanded;
        geometry.expanded_size
    };
    let monitor = app.get_webview_window(MAIN).as_ref().and_then(monitor_for);
    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY,
        WebviewUrl::App("index.html#task-overlay".into()),
    )
    .title("WhereAmI Task overlay")
    .visible(false)
    .focused(false)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .maximizable(false)
    .minimizable(false)
    .inner_size(expanded_size.width, expanded_size.height)
    .build()
    .map_err(window_error)?;
    let opened = resize_overlay(&window, Mode::Expanded, expanded_size, monitor.as_ref(), true)
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = opened {
        let _ = window.destroy();
        return Err(window_error(error));
    }
    Ok(())
}

#[tauri::command]
pub async fn open_task_overlay(window: WebviewWindow) -> OverlayResult {
    if window.label() != MAIN {
        return Err("Open the task overlay from WhereAmI.".into());
    }
    open_overlay_window(window.app_handle())
}

#[tauri::command]
pub fn get_task_overlay(window: WebviewWindow, state: State<'_, Overlay>) -> Result<&'static str, String> {
    overlay_window(&window)?;
    let geometry = state.geometry.lock().map_err(|_| "The task overlay is unavailable.")?;
    Ok(geometry.mode.name())
}

#[tauri::command]
pub fn set_task_overlay(window: WebviewWindow, state: State<'_, Overlay>, mode: &str) -> OverlayResult {
    overlay_window(&window)?;
    let mode = Mode::parse(mode)?;
    let mut geometry = state.geometry.lock().map_err(|_| "The task overlay is unavailable.")?;
    if mode == geometry.mode {
        return Ok(());
    }
    let monitor = monitor_for(&window);
    if geometry.mode == Mode::Expanded {
        let size = window.inner_size().map_err(window_error)?;
        geometry.expanded_size = size.to_logical(window.scale_factor().map_err(window_error)?);
    }
    if let Err(error) = resize_overlay(&window, mode, geometry.expanded_size, monitor.as_ref(), false) {
        let _ = resize_overlay(&window, geometry.mode, geometry.expanded_size, monitor.as_ref(), false);
        return Err(window_error(error));
    }
    geometry.mode = mode;
    Ok(())
}

#[tauri::command]
pub fn close_task_overlay(window: WebviewWindow) -> OverlayResult {
    overlay_window(&window)?;
    window.close().map_err(window_error)
}

#[tauri::command]
pub fn show_main_window(window: WebviewWindow) -> OverlayResult {
    overlay_window(&window)?;
    focus_main_window(window.app_handle()).map_err(window_error)
}

#[tauri::command]
pub fn drag_task_overlay(window: WebviewWindow) -> OverlayResult {
    overlay_window(&window)?;
    window.start_dragging().map_err(window_error)
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() == MAIN && window.app_handle().tray_by_id(TRAY).is_some() {
        api.prevent_close();
        let _ = window.hide();
    } else if window.label() == OVERLAY {
        let state = window.app_handle().state::<Overlay>();
        if let Ok(mut geometry) = state.geometry.lock()
            && geometry.mode == Mode::Expanded
            && let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor())
        {
            geometry.expanded_size = size.to_logical(scale);
        }
    }
}

pub fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("whereami-open", "Open WhereAmI").build(app)?;
    let overlay = MenuItemBuilder::with_id("whereami-overlay", "Show Task Overlay").build(app)?;
    let quit = MenuItemBuilder::with_id("whereami-quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&open, &overlay, &quit]).build()?;
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("WhereAmI")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "whereami-open" => {
                let _ = focus_main_window(app);
            }
            "whereami-overlay" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_overlay_window(&app);
                });
            }
            "whereami-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }) {
                let _ = focus_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

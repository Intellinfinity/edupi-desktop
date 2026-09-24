use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt as _;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt as _;
#[cfg(windows)]
use std::os::windows::process::CommandExt as _;
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{Color, NewWindowResponse},
    AppHandle, Emitter, Manager, RunEvent, Theme, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

mod computer_use;
mod reminder_notification;

const WINDOW_LABEL: &str = "main";
const DESKTOP_API_TOKEN_ENV: &str = "PI_DESKTOP_API_TOKEN";
const DESKTOP_INSTANCE_ID_ENV: &str = "PI_DESKTOP_INSTANCE_ID";
const DESKTOP_INSTANCE_ID_HEADER: &str = "x-pi-desktop-instance";
const EDUPI_DATA_ROOT_ENV: &str = "EDUPI_DATA_ROOT";
const EDUPI_PROJECT_ROOT_ENV: &str = "EDUPI_PROJECT_ROOT";
const EDUPI_WORKSPACE_ENV: &str = "EDUPI_WORKSPACE";
const EDUPI_CORE_ROOT_ENV: &str = "EDUPI_CORE_ROOT";
const EDUPI_DATA_ALLOWED_ROOT_ENV: &str = "EDUPI_DATA_ALLOWED_ROOT";
const EDUPI_CORE_ALLOWED_ROOT_ENV: &str = "EDUPI_CORE_ALLOWED_ROOT";
const EDUPI_DATA_PREF_KEY: &str = "edupiDataRoot";
const MOBILE_BRIDGE_PREF_KEY: &str = "mobileBridgeEnabled";
const SAFE_MODE_FLAG: &str = "--safe-mode";
const MANAGED_DATA_DIRECTORY: &str = "edupi-data";
const FALLBACK_PERSISTED_MISSING: &str = "persisted_missing";
const FALLBACK_PERSISTED_NO_KEY: &str = "persisted_no_key";
const FALLBACK_PERSISTED_UNREADABLE: &str = "persisted_unreadable";
const FALLBACK_PERSISTED_CORRUPT: &str = "persisted_corrupt";
const FALLBACK_PERSISTED_NON_OBJECT: &str = "persisted_non_object";
const FALLBACK_PERSISTED_INVALID: &str = "persisted_invalid";
const FALLBACK_PERSISTED_RELATIVE: &str = "persisted_relative";
const FALLBACK_PERSISTED_SYMLINK: &str = "persisted_symlink";
const FALLBACK_PERSISTED_NOT_DIRECTORY: &str = "persisted_not_directory";
const FALLBACK_PERSISTED_FILESYSTEM_ROOT: &str = "persisted_filesystem_root";
#[cfg(not(feature = "custom-protocol"))]
const DEV_SERVER_URL: &str = "http://127.0.0.1:30141";
/// Preferred localhost port for the packaged Next server. Keeping this stable
/// matters because the webview's localStorage is origin-scoped (`host:port`).
#[cfg(feature = "custom-protocol")]
const DESKTOP_SERVER_PORT: u16 = 38471;
#[cfg(feature = "custom-protocol")]
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(30);
const RESUME_MONITOR_INTERVAL: Duration = Duration::from_secs(15);
const RESUME_GAP_THRESHOLD: Duration = Duration::from_secs(45);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MIN_WINDOW_WIDTH: f64 = 800.0;
const MIN_WINDOW_HEIGHT: f64 = 600.0;

const LIGHT_WINDOW_BG: Color = Color(247, 247, 245, 255);
const DARK_WINDOW_BG: Color = Color(28, 28, 30, 255);

struct DesktopServer {
    child: Mutex<Option<Child>>,
}

struct DesktopResumeMonitor {
    stopped: Arc<AtomicBool>,
}

impl DesktopResumeMonitor {
    fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

impl Drop for DesktopResumeMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}

fn resume_gap_detected(previous: SystemTime, current: SystemTime, threshold: Duration) -> bool {
    current
        .duration_since(previous)
        .map(|elapsed| elapsed >= threshold)
        .unwrap_or(false)
}

fn start_desktop_resume_monitor(app_handle: AppHandle) -> io::Result<DesktopResumeMonitor> {
    let stopped = Arc::new(AtomicBool::new(false));
    let thread_stopped = stopped.clone();
    thread::Builder::new()
        .name("edupi-resume-monitor".into())
        .spawn(move || {
            let mut previous = SystemTime::now();
            while !thread_stopped.load(Ordering::Relaxed) {
                thread::sleep(RESUME_MONITOR_INTERVAL);
                if thread_stopped.load(Ordering::Relaxed) {
                    break;
                }
                let current = SystemTime::now();
                if resume_gap_detected(previous, current, RESUME_GAP_THRESHOLD) {
                    let _ = app_handle.emit("edupi://resume", ());
                }
                previous = current;
            }
        })?;
    Ok(DesktopResumeMonitor { stopped })
}

/// When true, closing the main window quits the app; otherwise it hides to tray.
struct CloseQuits(Mutex<bool>);

struct DesktopApiToken(String);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeStatus {
    safe_mode: bool,
    diagnostics_path: String,
    mobile_bridge_enabled: bool,
    mobile_url: Option<String>,
    restart_required: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EduPiRootStatus {
    data_root: String,
    data_source: String,
    core_root: String,
    core_source: String,
    fallback_reason: Option<String>,
    can_change_data_root: bool,
    restart_required: bool,
}

fn generate_random_hex() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn load_or_generate_desktop_api_token() -> Result<String, String> {
    if let Ok(value) = env::var(DESKTOP_API_TOKEN_ENV) {
        let value = value.trim();
        if value.len() >= 32 {
            return Ok(value.to_string());
        }
    }

    generate_random_hex()
}

#[tauri::command]
fn get_desktop_api_token(token: tauri::State<'_, DesktopApiToken>) -> String {
    token.0.clone()
}

fn safe_mode_requested() -> bool {
    args_request_safe_mode(env::args_os())
        || matches!(env::var("EDUPI_SAFE_MODE").as_deref(), Ok("1" | "true" | "yes"))
}

fn args_request_safe_mode<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    args.into_iter().any(|argument| argument.as_ref() == std::ffi::OsStr::new(SAFE_MODE_FLAG))
}

fn mobile_bridge_enabled_from_prefs(app: &AppHandle) -> bool {
    read_ui_prefs(app)
        .get(MOBILE_BRIDGE_PREF_KEY)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn local_lan_ip() -> Option<IpAddr> {
    // UDP connect only asks the OS which interface it would use; it does not
    // send a packet to the documentation address.
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    socket.local_addr().ok().map(|address| address.ip())
}

fn desktop_diagnostics_path(app: &AppHandle) -> String {
    app.path()
        .app_config_dir()
        .map(|path| path.join("startup-diagnostics.jsonl").to_string_lossy().into_owned())
        .unwrap_or_else(|_| "startup-diagnostics.jsonl".into())
}

fn record_native_startup_diagnostic(
    app: &AppHandle,
    stage: &str,
    component: &str,
    error: &str,
    log_path: Option<&Path>,
) {
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    let path = config_dir.join("startup-diagnostics.jsonl");
    let mut hasher = DefaultHasher::new();
    error.hash(&mut hasher);
    let record = serde_json::json!({
        "at": chrono_like_timestamp(),
        "stage": stage,
        "component": component,
        "errorCode": format!("START-RUST-{:016x}", hasher.finish()),
        "logPath": log_path.map(|value| value.to_string_lossy().into_owned()),
    });
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", record);
    }
}

fn chrono_like_timestamp() -> String {
    // Keep the native shell dependency-free; the server-side reader only
    // needs an ordered timestamp.
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn mobile_gateway_reachable(address: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream.write_all(b"GET /mobile HTTP/1.1\r\nHost: mobile.local\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut response = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    while response.len() < 4096 {
        let Ok(size) = stream.read(&mut chunk) else { return false };
        if size == 0 { break; }
        response.extend_from_slice(&chunk[..size]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") { break; }
    }
    let header = String::from_utf8_lossy(&response).to_ascii_lowercase();
    header.starts_with("http/1.1 200 ") && header.contains("\r\nx-edupi-mobile-gateway: 1\r\n")
}

fn mobile_bridge_status(app: &AppHandle, restart_required: bool) -> DesktopRuntimeStatus {
    let enabled = mobile_bridge_enabled_from_prefs(app);
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .or_else(|| {
            #[cfg(feature = "custom-protocol")]
            {
                read_last_server_port(app)
            }
            #[cfg(not(feature = "custom-protocol"))]
            {
                Some(30141)
            }
        });
    let mobile_url = if enabled {
        local_lan_ip().filter(|ip| !ip.is_loopback() && !ip.is_unspecified()).zip(port).filter(|(ip, port)| {
            mobile_gateway_reachable(SocketAddr::new(*ip, *port))
        }).map(|(ip, port)| {
            match ip {
                IpAddr::V6(value) => format!("http://[{value}]:{port}/mobile"),
                IpAddr::V4(value) => format!("http://{value}:{port}/mobile"),
            }
        })
    } else {
        None
    };
    DesktopRuntimeStatus {
        safe_mode: safe_mode_requested(),
        diagnostics_path: desktop_diagnostics_path(app),
        mobile_bridge_enabled: enabled,
        mobile_url,
        restart_required,
    }
}

#[tauri::command]
fn get_desktop_runtime_status(app: AppHandle) -> DesktopRuntimeStatus {
    mobile_bridge_status(&app, false)
}

#[tauri::command]
fn set_mobile_bridge_enabled(app: AppHandle, enabled: bool) -> Result<DesktopRuntimeStatus, String> {
    let mut prefs = read_ui_prefs(&app);
    if !prefs.is_object() {
        prefs = serde_json::json!({});
    }
    prefs[MOBILE_BRIDGE_PREF_KEY] = serde_json::Value::Bool(enabled);
    write_ui_prefs(&app, &prefs)?;
    Ok(mobile_bridge_status(&app, true))
}

#[tauri::command]
fn restart_normal_mode(app: AppHandle) -> Result<(), String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    let arguments: Vec<_> = env::args_os().skip(1).filter(|argument| argument != SAFE_MODE_FLAG).collect();
    let mut command = Command::new(executable);
    command.args(arguments).env_remove("EDUPI_SAFE_MODE");
    command.spawn().map_err(|error| error.to_string())?;
    app.exit(0);
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quit_application(app: &AppHandle) {
    if let Some(server) = app.try_state::<DesktopServer>() {
        server.stop();
    }
    app.exit(0);
}

impl DesktopServer {
    #[cfg(not(feature = "custom-protocol"))]
    fn empty() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    fn running(child: Child) -> Self {
        Self {
            child: Mutex::new(Some(child)),
        }
    }

    fn stop(&self) {
        let Ok(mut guard) = self.child.lock() else {
            return;
        };
        let Some(mut child) = guard.take() else {
            return;
        };

        terminate_process_tree(&mut child);
    }
}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        unsafe {
            // The Node server owns its process group, so this also stops any
            // agent/tool subprocesses that are active when the App quits.
            libc::kill(-(child.id() as i32), libc::SIGTERM);
        }

        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }

        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(windows)]
    {
        // taskkill /T terminates the packaged Node server and any agent/tool
        // subprocesses it started. CREATE_NO_WINDOW avoids flashing a console.
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for DesktopServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn open_external(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return Err("Unsupported external URL scheme".into());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .arg(url.as_str())
            .status()
            .map_err(|error| error.to_string())?;
        return status
            .success()
            .then_some(())
            .ok_or_else(|| "System URL opener failed".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url.as_str()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url.as_str())
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening external URLs is unsupported".into())
}

fn open_path_with_default_app(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // explorer.exe applies the default file association without going
        // through the cmd parser, where `&` or `^` in an otherwise legal path
        // (`C:\src\R&D\notes.txt`) would be read as a command separator.
        Command::new("explorer.exe")
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening local paths is unsupported on this platform".into())
}

fn reveal_path_in_file_manager(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .args(["-R"])
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", path.to_string_lossy()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(path)
        };
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Reveal in folder is unsupported on this platform".into())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Only http, https, and mailto URLs can be opened externally".into());
    }
    open_external(&parsed)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    open_path_with_default_app(Path::new(&path))
}

#[tauri::command]
fn reveal_item_in_dir(path: String) -> Result<(), String> {
    reveal_path_in_file_manager(Path::new(&path))
}

#[tauri::command]
fn set_close_quits(app: AppHandle, quit: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<CloseQuits>() {
        *state
            .0
            .lock()
            .map_err(|_| "close-behavior lock poisoned".to_string())? = quit;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) -> Result<(), String> {
    quit_application(&app);
    Ok(())
}

#[tauri::command]
fn show_main_window_cmd(app: AppHandle) -> Result<(), String> {
    show_main_window(&app);
    Ok(())
}

/// Persist the UI theme outside the webview origin so cold starts keep the
/// user's light/dark choice even when the local server port changes.
#[tauri::command]
fn set_ui_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let theme =
        normalize_theme(&theme).ok_or_else(|| "theme must be \"light\" or \"dark\"".to_string())?;
    write_ui_prefs_theme(&app, theme)?;
    apply_window_theme(&app, theme);
    Ok(())
}

#[tauri::command]
fn get_update_proxy(app: AppHandle) -> Result<Option<String>, String> {
    read_update_proxy_from_path(&update_proxy_path(&app)?)
}

#[tauri::command]
fn set_update_proxy(app: AppHandle, proxy: String) -> Result<Option<String>, String> {
    write_update_proxy_file(&update_proxy_path(&app)?, &proxy)
}

#[tauri::command]
fn get_edupi_root_status(app: AppHandle) -> Result<EduPiRootStatus, String> {
    edupi_launch_roots(&app)
        .map(|roots| roots.status)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_edupi_data_root(app: AppHandle, path: String) -> Result<EduPiRootStatus, String> {
    let current = edupi_launch_roots(&app).map_err(|error| error.to_string())?;
    if !current.status.can_change_data_root {
        return Err("EduPi data root is controlled by an environment override".into());
    }
    let root = validate_selected_data_root(path).map_err(|error| error.to_string())?;
    ensure_data_directories(&root).map_err(|error| error.to_string())?;
    write_edupi_data_root_pref(&app, &root).map_err(|error| error.to_string())?;
    let mut status = edupi_launch_roots(&app)
        .map_err(|error| error.to_string())?
        .status;
    status.restart_required = true;
    Ok(status)
}

#[tauri::command]
fn reset_edupi_data_root(app: AppHandle) -> Result<EduPiRootStatus, String> {
    let current = edupi_launch_roots(&app).map_err(|error| error.to_string())?;
    if !current.status.can_change_data_root {
        return Err("EduPi data root is controlled by an environment override".into());
    }
    remove_edupi_data_root_pref(&app).map_err(|error| error.to_string())?;
    let mut status = edupi_launch_roots(&app)
        .map_err(|error| error.to_string())?
        .status;
    status.restart_required = true;
    Ok(status)
}

fn ui_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join("ui-prefs.json"))
}

fn update_proxy_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join("updater-proxy.json"))
}

fn normalize_theme(theme: &str) -> Option<&'static str> {
    match theme {
        "light" => Some("light"),
        "dark" => Some("dark"),
        _ => None,
    }
}

fn read_ui_prefs(app: &AppHandle) -> serde_json::Value {
    let Ok(path) = ui_prefs_path(app) else {
        return serde_json::json!({});
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_ui_prefs(app: &AppHandle, prefs: &serde_json::Value) -> Result<(), String> {
    let path = ui_prefs_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn normalize_update_proxy(raw: &str) -> Result<Option<String>, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let url = Url::parse(value).map_err(|_| "更新代理地址无效".to_string())?;
    let port = url.port().filter(|port| *port > 0);
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || port.is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("只支持不含凭据的本机 HTTP 代理地址".into());
    }
    Ok(Some(format!("http://127.0.0.1:{}", port.unwrap())))
}

fn read_update_proxy_from_path(path: &Path) -> Result<Option<String>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
            return Err("更新代理设置文件无效".into());
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("更新代理设置不可读取".into()),
        _ => {}
    }
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("更新代理设置不可读取".into()),
    };
    let prefs: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "更新代理设置文件无效".to_string())?;
    let object = prefs
        .as_object()
        .ok_or_else(|| "更新代理设置文件无效".to_string())?;
    match object.get("updateProxy") {
        Some(serde_json::Value::String(value)) => normalize_update_proxy(value)?
            .ok_or_else(|| "更新代理设置文件无效".to_string())
            .map(Some),
        _ => Err("更新代理设置文件无效".into()),
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> io::Result<()> {
    let source_wide: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: both buffers are owned, stable, NUL-terminated UTF-16 paths for
    // the duration of the call; source and destination live in one directory.
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn write_update_proxy_file(path: &Path, raw: &str) -> Result<Option<String>, String> {
    let proxy = normalize_update_proxy(raw)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
            return Err("更新代理设置文件无效".into());
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => return Err("更新代理设置不可读取".into()),
        _ => {}
    }
    if proxy.is_none() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(None),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("更新代理设置不可清除".into()),
        };
    }
    let mut prefs = match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|_| "更新代理设置文件无效".to_string())?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => serde_json::json!({}),
        Err(_) => return Err("更新代理设置不可读取".into()),
    };
    let object = prefs
        .as_object_mut()
        .ok_or_else(|| "更新代理设置文件无效".to_string())?;
    if let Some(value) = &proxy {
        object.insert(
            "updateProxy".into(),
            serde_json::Value::String(value.clone()),
        );
    } else {
        object.remove("updateProxy");
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "更新代理设置不可保存".to_string())?;
    }
    let bytes =
        serde_json::to_vec_pretty(&prefs).map_err(|_| "更新代理设置不可保存".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "更新代理设置不可保存".to_string())?
        .as_nanos();
    let temporary =
        path.with_file_name(format!(".updater-proxy-{}-{nonce}.tmp", std::process::id()));
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "更新代理设置不可保存".to_string())?;
        file.write_all(&bytes)
            .map_err(|_| "更新代理设置不可保存".to_string())?;
        file.sync_all()
            .map_err(|_| "更新代理设置不可保存".to_string())?;
        drop(file);
        replace_file_atomically(&temporary, path)
            .map_err(|_| "更新代理设置不可保存".to_string())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result?;
    Ok(proxy)
}

/// Source adaptation: abcwyc/pi-agent-desktop@deee754.
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg_attr(not(test), allow(dead_code))]
enum WebviewCacheLayout {
    Linux,
    Windows,
    Macos,
}

fn last_version_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(directory.join("last-version.json"))
}

fn read_last_version_from_path(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value
        .get("version")
        .and_then(|version| version.as_str())
        .map(str::to_string)
}

fn read_last_version(app: &AppHandle) -> Option<String> {
    read_last_version_from_path(&last_version_path(app).ok()?)
}

fn should_reconcile_webview_cache(last_version: Option<&str>, current_version: &str) -> bool {
    last_version != Some(current_version)
}

fn write_last_version_to_path(path: &Path, version: &str) -> Result<(), io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(&serde_json::json!({ "version": version }))
        .map_err(io::Error::other)?;
    fs::write(path, raw)
}

fn write_last_version(app: &AppHandle) {
    if let Ok(path) = last_version_path(app) {
        let _ = write_last_version_to_path(&path, APP_VERSION);
    }
}

fn remove_bounded_cache_tree(root: &Path, candidate: &Path) -> Result<(), io::Error> {
    let metadata = match fs::symlink_metadata(candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "webview cache target is not a normal directory: {}",
                candidate.display()
            ),
        ));
    }
    let canonical_root = dunce::canonicalize(root)?;
    let canonical_candidate = dunce::canonicalize(candidate)?;
    if canonical_candidate == canonical_root || !canonical_candidate.starts_with(&canonical_root) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "webview cache target escapes app data: {}",
                candidate.display()
            ),
        ));
    }
    fs::remove_dir_all(canonical_candidate)
}

fn clear_webview_caches_for_layout(
    layout: WebviewCacheLayout,
    app_data_dir: &Path,
    home_dir: Option<&Path>,
    identifier: &str,
) -> Result<(), io::Error> {
    match layout {
        WebviewCacheLayout::Linux => {
            let cache = app_data_dir.join("WebKitCache");
            remove_bounded_cache_tree(app_data_dir, &cache)
        }
        WebviewCacheLayout::Windows => {
            let webview = app_data_dir.join("EBWebView");
            let metadata = match fs::symlink_metadata(&webview) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(error),
            };
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "webview data root is not a normal directory: {}",
                        webview.display()
                    ),
                ));
            }
            for entry in fs::read_dir(&webview)? {
                let entry = entry?;
                let cache = entry.path().join("Cache");
                remove_bounded_cache_tree(app_data_dir, &cache)?;
            }
            Ok(())
        }
        WebviewCacheLayout::Macos => {
            let Some(home) = home_dir else {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "home directory is unavailable for macOS webview cache cleanup",
                ));
            };
            // WKWebView keeps persistent website data (LocalStorage, IndexedDB,
            // cookies) under ~/Library/WebKit/<identifier>. Only the disposable
            // HTTP/WebKit cache lives under ~/Library/Caches/<identifier>/WebKit.
            // Deleting the former would silently sign users out and erase local
            // web state during an upgrade.
            // Source: https://v2.tauri.app/reference/javascript/api/namespacepath/#appcachedir
            let cache = home
                .join("Library")
                .join("Caches")
                .join(identifier)
                .join("WebKit");
            remove_bounded_cache_tree(&home.join("Library").join("Caches"), &cache)
        }
    }
}

/// Clear only the app-specific webview cache after an application version
/// change. Preferences and `edupi-data` are outside these bounded targets.
fn clear_webview_caches(app: &AppHandle) -> Result<(), io::Error> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| io::Error::other(error.to_string()))?;
    let identifier = app.config().identifier.as_str();

    #[cfg(target_os = "linux")]
    return clear_webview_caches_for_layout(
        WebviewCacheLayout::Linux,
        &app_data_dir,
        None,
        identifier,
    );

    #[cfg(target_os = "windows")]
    return clear_webview_caches_for_layout(
        WebviewCacheLayout::Windows,
        &app_data_dir,
        None,
        identifier,
    );

    #[cfg(target_os = "macos")]
    return clear_webview_caches_for_layout(
        WebviewCacheLayout::Macos,
        &app_data_dir,
        env::var_os("HOME").as_deref().map(Path::new),
        identifier,
    );

    #[allow(unreachable_code)]
    Ok(())
}

fn reconcile_cache_version_state(
    last_version: Option<&str>,
    current_version: &str,
    cleanup: impl FnOnce() -> Result<(), io::Error>,
) -> bool {
    if !should_reconcile_webview_cache(last_version, current_version) {
        return true;
    }
    cleanup().is_ok()
}

fn reconcile_webview_cache_for_version(app: &AppHandle) -> bool {
    reconcile_cache_version_state(read_last_version(app).as_deref(), APP_VERSION, || {
        clear_webview_caches(app)
    })
}

fn read_stored_theme(app: &AppHandle) -> Option<&'static str> {
    read_ui_prefs(app)
        .get("theme")
        .and_then(|value| value.as_str())
        .and_then(normalize_theme)
}

fn write_ui_prefs_theme(app: &AppHandle, theme: &str) -> Result<(), String> {
    let mut prefs = read_ui_prefs(app);
    if !prefs.is_object() {
        prefs = serde_json::json!({});
    }
    prefs["theme"] = serde_json::Value::String(theme.to_string());
    write_ui_prefs(app, &prefs)
}

fn write_edupi_data_root_pref(app: &AppHandle, root: &str) -> Result<(), String> {
    let mut prefs = read_ui_prefs(app);
    if !prefs.is_object() {
        prefs = serde_json::json!({});
    }
    prefs[EDUPI_DATA_PREF_KEY] = serde_json::Value::String(root.to_string());
    write_ui_prefs(app, &prefs)
}

fn remove_edupi_data_root_pref(app: &AppHandle) -> Result<(), String> {
    let mut prefs = read_ui_prefs(app);
    if let Some(object) = prefs.as_object_mut() {
        object.remove(EDUPI_DATA_PREF_KEY);
    } else {
        prefs = serde_json::json!({});
    }
    write_ui_prefs(app, &prefs)
}

#[cfg(feature = "custom-protocol")]
fn read_last_server_port(app: &AppHandle) -> Option<u16> {
    read_ui_prefs(app)
        .get("serverPort")
        .and_then(|value| value.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
}

#[cfg(feature = "custom-protocol")]
fn write_last_server_port(app: &AppHandle, port: u16) {
    let Ok(path) = ui_prefs_path(app) else {
        return;
    };
    let _ = update_server_port_in_prefs(&path, port);
}

#[cfg(feature = "custom-protocol")]
fn update_server_port_in_prefs(path: &Path, port: u16) -> Result<bool, io::Error> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let prefs = serde_json::json!({ "serverPort": port });
            let updated = serde_json::to_string_pretty(&prefs).map_err(io::Error::other)?;
            fs::write(path, updated)?;
            return Ok(true);
        }
        Err(error) => return Err(error),
    };
    let mut prefs: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let Some(object) = prefs.as_object_mut() else {
        return Ok(false);
    };
    object.insert("serverPort".to_string(), serde_json::Value::from(port));
    let updated = serde_json::to_string_pretty(&prefs).map_err(io::Error::other)?;
    fs::write(path, updated)?;
    Ok(true)
}

fn theme_background_color(theme: &str) -> Color {
    if theme == "dark" {
        DARK_WINDOW_BG
    } else {
        LIGHT_WINDOW_BG
    }
}

fn theme_bootstrap_script(theme: &str) -> String {
    // Runs before page scripts so localStorage/class match the persisted
    // preference even on a fresh webview origin (new localhost port).
    format!(
        r#"(function(){{try{{localStorage.setItem("pi-theme","{theme}");var d="{theme}"==="dark";document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}}catch(e){{}}}})();"#
    )
}

fn apply_window_theme(app: &AppHandle, theme: &str) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    let tauri_theme = if theme == "dark" {
        Theme::Dark
    } else {
        Theme::Light
    };
    let _ = window.set_theme(Some(tauri_theme));
    let _ = window.set_background_color(Some(theme_background_color(theme)));
}

fn same_origin(candidate: &Url, app_url: &Url) -> bool {
    candidate.scheme() == app_url.scheme()
        && candidate.host_str() == app_url.host_str()
        && candidate.port_or_known_default() == app_url.port_or_known_default()
}

fn build_window(app: &tauri::AppHandle, app_url: Url) -> tauri::Result<WebviewWindow> {
    let navigation_origin = app_url.clone();
    let stored_theme = read_stored_theme(app);

    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(app_url))
        .title("EduPi")
        .inner_size(1440.0, 900.0)
        .center()
        .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        .resizable(true)
        // Pi Agent already handles browser drag/drop for image attachments.
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if same_origin(url, &navigation_origin) {
                true
            } else {
                let _ = open_external(url);
                false
            }
        })
        .on_new_window(|url, _features| {
            let _ = open_external(&url);
            NewWindowResponse::Deny
        })
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        });

    // Force the native window chrome/background to match an explicit UI theme
    // before the page paints — otherwise macOS dark mode flashes a black
    // webview while the user has chosen light mode.
    if let Some(theme) = stored_theme {
        let tauri_theme = if theme == "dark" {
            Theme::Dark
        } else {
            Theme::Light
        };
        builder = builder
            .theme(Some(tauri_theme))
            .background_color(theme_background_color(theme))
            .initialization_script(theme_bootstrap_script(theme));
    }

    // Hide the native title bar. macOS keeps the traffic-light controls
    // (overlaid on our own top bar); other platforms go fully frameless and
    // rely on custom window controls drawn in the web content instead.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }

    builder.build()
}

#[cfg(all(feature = "custom-protocol", unix))]
fn login_shell_path() -> Option<String> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let output = Command::new(shell)
        .args(["-l", "-c", "/usr/bin/env"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("PATH="))
        .map(str::to_string)
        .filter(|path| !path.is_empty())
}

#[cfg(all(feature = "custom-protocol", windows))]
fn login_shell_path() -> Option<String> {
    env::var("PATH").ok().filter(|path| !path.is_empty())
}

#[cfg(all(feature = "custom-protocol", target_os = "macos"))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/Pi Agent Server.app/Contents/MacOS/node")
}

#[cfg(all(feature = "custom-protocol", target_os = "windows"))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/node/node.exe")
}

#[cfg(all(feature = "custom-protocol", target_os = "linux"))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/node/node")
}

#[cfg(feature = "custom-protocol")]
fn child_process_compatible_path(path: &Path) -> PathBuf {
    // Tauri resolves its Windows resource directory from a canonicalized
    // executable path. `std::fs::canonicalize` uses the verbatim `\\?\C:\...`
    // form on Windows, but Node's entry-point resolver is not verbatim-path
    // aware and reduces that argument to the bare drive (`C:`). Simplify the
    // path before it crosses the process boundary. On non-Windows platforms
    // this is intentionally a no-op.
    dunce::simplified(path).to_path_buf()
}

#[cfg(feature = "custom-protocol")]
fn server_process_path(node_path: &Path) -> Option<std::ffi::OsString> {
    let inherited = login_shell_path().unwrap_or_default();
    let mut paths = vec![node_path.parent()?.to_path_buf()];
    paths.extend(env::split_paths(&inherited));
    env::join_paths(paths).ok()
}

struct EduPiLaunchRoots {
    data_root: String,
    core_root: String,
    core_allowed_root: String,
    data_allowed_root: String,
    core_validation_mode: &'static str,
    status: EduPiRootStatus,
}

fn first_configured_root(names: &[&str]) -> Option<(String, String)> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|value| ((*name).to_string(), value))
    })
}

fn validate_edupi_directory(name: &str, value: String) -> Result<String, io::Error> {
    let path = PathBuf::from(&value);
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{name} must be an absolute directory: {}", path.display()),
        ));
    }
    if !path.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{name} does not exist: {}", path.display()),
        ));
    }
    Ok(dunce::canonicalize(path)?.to_string_lossy().into_owned())
}

fn edupi_root_label(name: &str) -> &str {
    match name {
        "EDUPI_DATA_ROOT" => "EduPi data root",
        "EDUPI_CORE_ROOT" => "EduPi Core root",
        "EDUPI_WORKSPACE" => "EduPi workspace",
        _ => "EduPi project root",
    }
}

fn default_allowed_root(root: &str) -> Result<String, io::Error> {
    let path = Path::new(root);
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("cannot default an allowed root from a relative root: {root}"),
        ));
    }
    path.parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("cannot default an allowed root from root: {root}"),
            )
        })
}

fn edupi_allowed_root(name: &str, root: &str) -> Result<String, io::Error> {
    let value = first_configured_root(&[name])
        .map(|(_, value)| value)
        .unwrap_or(default_allowed_root(root)?);

    validate_edupi_directory(name, value)
}

fn is_filesystem_root(path: &Path) -> bool {
    let text = path.to_string_lossy();
    let is_separator = |value: char| value == '/' || value == '\\';
    if text == "/" || text == "\\" || (!text.is_empty() && text.chars().all(is_separator)) {
        return true;
    }
    let is_drive_root = |value: &str| {
        let bytes = value.as_bytes();
        bytes.len() == 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && is_separator(bytes[2] as char)
    };
    if is_drive_root(&text) {
        return true;
    }
    if let Some(verbatim) = text.strip_prefix("\\\\?\\") {
        if is_drive_root(verbatim) {
            return true;
        }
        if let Some(unc) = verbatim
            .strip_prefix("UNC\\")
            .or_else(|| verbatim.strip_prefix("UNC/"))
        {
            let parts: Vec<_> = unc
                .split(is_separator)
                .filter(|part| !part.is_empty())
                .collect();
            return parts.len() == 2;
        }
    }
    if let Some(unc) = text.strip_prefix("\\\\") {
        let parts: Vec<_> = unc
            .split(is_separator)
            .filter(|part| !part.is_empty())
            .collect();
        return parts.len() == 2;
    }
    let mut components = path.components();
    matches!(
        components.next(),
        Some(Component::RootDir) | Some(Component::Prefix(_))
    ) && components.next().is_none()
}

fn validate_selected_data_root(value: String) -> Result<String, io::Error> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root must be an absolute directory",
        ));
    }
    let metadata = fs::symlink_metadata(&path)?;
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root cannot be a symlink",
        ));
    }
    if !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root must be an existing directory",
        ));
    }
    let canonical = dunce::canonicalize(path)?;
    if is_filesystem_root(&canonical) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root cannot be a filesystem root",
        ));
    }
    Ok(canonical.to_string_lossy().into_owned())
}

fn ensure_data_directories(root: &str) -> Result<(String, String, String), io::Error> {
    let root_path = Path::new(root);
    let edupi = root_path.join(".edupi");
    if let Ok(metadata) = fs::symlink_metadata(&edupi) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "EduPi data directory is not a normal directory: {}",
                    edupi.display()
                ),
            ));
        }
    }
    fs::create_dir_all(&edupi)?;
    let canonical_edupi = dunce::canonicalize(&edupi)?;
    if !is_inside_path(root_path, &canonical_edupi) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "EduPi data directory escapes the data root: {}",
                edupi.display()
            ),
        ));
    }
    for directory in ["memory", "output", "locks"] {
        let path = edupi.join(directory);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "EduPi data directory is not a normal directory: {}",
                        path.display()
                    ),
                ));
            }
        }
        fs::create_dir_all(&path)?;
        let canonical = dunce::canonicalize(&path)?;
        if !is_inside_path(root_path, &canonical) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "EduPi data directory escapes the data root: {}",
                    path.display()
                ),
            ));
        }
    }
    Ok((
        edupi.join("memory").to_string_lossy().into_owned(),
        edupi.join("output").to_string_lossy().into_owned(),
        edupi.join("locks").to_string_lossy().into_owned(),
    ))
}

fn is_inside_path(root: &Path, candidate: &Path) -> bool {
    candidate == root || candidate.starts_with(root)
}

fn managed_data_root(app: &AppHandle) -> Result<String, io::Error> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| io::Error::other(error.to_string()))?
        .join(MANAGED_DATA_DIRECTORY);
    fs::create_dir_all(&root)?;
    let root = dunce::canonicalize(root)?;
    ensure_data_directories(&root.to_string_lossy())?;
    Ok(root.to_string_lossy().into_owned())
}

fn persisted_data_root_from_prefs(path: &Path) -> Result<Result<String, &'static str>, io::Error> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Err(FALLBACK_PERSISTED_NO_KEY))
        }
        Err(_) => return Ok(Err(FALLBACK_PERSISTED_UNREADABLE)),
    };
    let prefs: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(Err(FALLBACK_PERSISTED_CORRUPT)),
    };
    if !prefs.is_object() {
        return Ok(Err(FALLBACK_PERSISTED_NON_OBJECT));
    }
    let Some(value) = prefs.get(EDUPI_DATA_PREF_KEY) else {
        return Ok(Err(FALLBACK_PERSISTED_NO_KEY));
    };
    let Some(value) = value.as_str() else {
        return Ok(Err(FALLBACK_PERSISTED_INVALID));
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Ok(Err(FALLBACK_PERSISTED_RELATIVE));
    }
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Err(FALLBACK_PERSISTED_MISSING))
        }
        Err(_) => return Ok(Err(FALLBACK_PERSISTED_UNREADABLE)),
    };
    if metadata.file_type().is_symlink() {
        return Ok(Err(FALLBACK_PERSISTED_SYMLINK));
    }
    if !metadata.is_dir() {
        return Ok(Err(FALLBACK_PERSISTED_NOT_DIRECTORY));
    }
    let canonical = dunce::canonicalize(path)
        .map_err(|_| io::Error::other("persisted root cannot be canonicalized"))?;
    if is_filesystem_root(&canonical) {
        return Ok(Err(FALLBACK_PERSISTED_FILESYSTEM_ROOT));
    }
    if ensure_data_directories(&canonical.to_string_lossy()).is_err() {
        return Ok(Err(FALLBACK_PERSISTED_INVALID));
    }
    Ok(Ok(canonical.to_string_lossy().into_owned()))
}

fn persisted_data_root(app: &AppHandle) -> Result<Result<String, &'static str>, io::Error> {
    let path = ui_prefs_path(app).map_err(io::Error::other)?;
    persisted_data_root_from_prefs(&path)
}

fn resolve_data_root(app: &AppHandle) -> Result<(String, &'static str, Option<String>), io::Error> {
    if let Some((name, value)) = first_configured_root(&[
        EDUPI_DATA_ROOT_ENV,
        EDUPI_PROJECT_ROOT_ENV,
        EDUPI_WORKSPACE_ENV,
    ]) {
        let root = validate_edupi_directory(edupi_root_label(&name), value)?;
        ensure_data_directories(&root)?;
        return Ok((root, "environment", None));
    }

    match persisted_data_root(app)? {
        Ok(root) => return Ok((root, "persisted", None)),
        Err(FALLBACK_PERSISTED_NO_KEY) => {}
        Err(reason) => {
            let root = managed_data_root(app)?;
            return Ok((root, "managed", Some(reason.to_string())));
        }
    }

    Ok((managed_data_root(app)?, "managed", None))
}

fn bundled_core_root(app: &AppHandle) -> Result<String, io::Error> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| io::Error::other(error.to_string()))?;
    let root = resource_dir.join("resources/edupi-core");
    validate_edupi_directory(
        "bundled EduPi Core root",
        root.to_string_lossy().into_owned(),
    )
}

fn resolve_core_root(app: &AppHandle) -> Result<(String, &'static str, &'static str), io::Error> {
    if let Some((_, value)) = first_configured_root(&[EDUPI_CORE_ROOT_ENV]) {
        return Ok((
            validate_edupi_directory("EduPi Core root", value)?,
            "environment",
            "external",
        ));
    }
    Ok((bundled_core_root(app)?, "bundled", "bundled"))
}

fn build_root_status(
    data_root: String,
    data_source: &str,
    core_root: String,
    core_source: &str,
    fallback_reason: Option<String>,
) -> EduPiRootStatus {
    EduPiRootStatus {
        data_root,
        data_source: data_source.to_string(),
        core_root,
        core_source: core_source.to_string(),
        fallback_reason,
        can_change_data_root: data_source != "environment",
        restart_required: false,
    }
}

fn edupi_launch_roots(app: &AppHandle) -> Result<EduPiLaunchRoots, io::Error> {
    let (data_root, data_source, fallback_reason) = resolve_data_root(app)?;
    let (core_root, core_source, core_validation_mode) = resolve_core_root(app)?;
    let data_allowed_root = edupi_allowed_root(EDUPI_DATA_ALLOWED_ROOT_ENV, &data_root)?;
    let core_allowed_root = edupi_allowed_root(EDUPI_CORE_ALLOWED_ROOT_ENV, &core_root)?;
    let status = build_root_status(
        data_root.clone(),
        data_source,
        core_root.clone(),
        core_source,
        fallback_reason,
    );
    Ok(EduPiLaunchRoots {
        data_root,
        core_root,
        core_allowed_root,
        data_allowed_root,
        core_validation_mode,
        status,
    })
}

#[cfg(not(feature = "custom-protocol"))]
fn edupi_project_root() -> Result<String, io::Error> {
    env::var("EDUPI_PROJECT_ROOT").map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "EDUPI_PROJECT_ROOT is not configured; choose the EduPi workspace before starting the desktop app",
        )
    })
}

#[cfg(feature = "custom-protocol")]
fn choose_port(app: &AppHandle) -> io::Result<u16> {
    let mut candidates = Vec::with_capacity(36);
    if let Some(last) = read_last_server_port(app) {
        candidates.push(last);
    }
    candidates.push(DESKTOP_SERVER_PORT);
    for offset in 1u16..=32 {
        candidates.push(DESKTOP_SERVER_PORT.saturating_add(offset));
    }

    for port in candidates {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            let chosen = listener.local_addr()?.port();
            drop(listener);
            write_last_server_port(app, chosen);
            return Ok(chosen);
        }
    }

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let chosen = listener.local_addr()?.port();
    drop(listener);
    write_last_server_port(app, chosen);
    Ok(chosen)
}

#[cfg(feature = "custom-protocol")]
fn response_has_instance_id(response: &[u8], expected_instance_id: &str) -> bool {
    let Ok(response) = std::str::from_utf8(response) else {
        return false;
    };
    let Some((headers, _)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let mut lines = headers.lines();
    let Some(status) = lines.next() else {
        return false;
    };
    if !(status.starts_with("HTTP/1.1 204 ") || status.starts_with("HTTP/1.0 204 ")) {
        return false;
    }

    lines.any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case(DESKTOP_INSTANCE_ID_HEADER)
                && value.trim() == expected_instance_id
        })
    })
}

#[cfg(feature = "custom-protocol")]
fn server_identity_matches(address: SocketAddr, expected_instance_id: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(200)) else {
        return false;
    };
    let timeout = Some(Duration::from_millis(500));
    if stream.set_read_timeout(timeout).is_err() || stream.set_write_timeout(timeout).is_err() {
        return false;
    }

    let request = format!(
        "GET /api/desktop/identity HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 512];
    while response.len() < 8 * 1024 {
        let Ok(read) = stream.read(&mut chunk) else {
            return false;
        };
        if read == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    response_has_instance_id(&response, expected_instance_id)
}

#[cfg(feature = "custom-protocol")]
fn wait_for_server(
    child: &mut Child,
    address: SocketAddr,
    expected_instance_id: &str,
    log_path: &Path,
) -> io::Result<()> {
    let deadline = Instant::now() + SERVER_START_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!(
                "Pi Agent server exited early with {status}; see {}",
                log_path.display()
            )));
        }
        if server_identity_matches(address, expected_instance_id) {
            // Re-check after the HTTP handshake. A losing child can exit with
            // EADDRINUSE while another process is answering on the same port.
            if let Some(status) = child.try_wait()? {
                return Err(io::Error::other(format!(
                    "Pi Agent server exited during startup with {status}; see {}",
                    log_path.display()
                )));
            }
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        format!(
            "Pi Agent server did not start within {} seconds; see {}",
            SERVER_START_TIMEOUT.as_secs(),
            log_path.display()
        ),
    ))
}

#[cfg(feature = "custom-protocol")]
fn start_packaged_server(
    app: &tauri::AppHandle,
    desktop_api_token: &str,
    desktop_instance_id: &str,
) -> Result<(Url, DesktopServer), Box<dyn std::error::Error>> {
    let resource_dir = child_process_compatible_path(&app.path().resource_dir()?);
    let node_path = bundled_node_path(&resource_dir);
    if !node_path.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("Bundled Node runtime is missing: {}", node_path.display()),
        )
        .into());
    }

    let server_dir = resource_dir.join("resources/server");
    let server_script = server_dir.join("desktop-server.cjs");
    if !server_script.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "Bundled Next.js server is missing: {}",
                server_script.display()
            ),
        )
        .into());
    }

    let log_dir = app.path().app_log_dir()?;
    fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("server.log");
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let stderr = stdout.try_clone()?;

    let roots = edupi_launch_roots(app)?;
    let port = choose_port(app)?;
    let mobile_enabled = mobile_bridge_enabled_from_prefs(app);
    let desktop_state_dir = app.path().app_config_dir()?;
    fs::create_dir_all(&desktop_state_dir)?;
    let mut command = Command::new(&node_path);
    command
        .arg(&server_script)
        .current_dir(&server_dir)
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .env("EDUPI_PROJECT_ROOT", &roots.data_root)
        .env("EDUPI_DATA_ROOT", &roots.data_root)
        .env("EDUPI_CORE_ROOT", &roots.core_root)
        .env("EDUPI_CORE_VALIDATION_MODE", roots.core_validation_mode)
        .env("EDUPI_CORE_ALLOWED_ROOT", &roots.core_allowed_root)
        .env("EDUPI_DATA_ALLOWED_ROOT", &roots.data_allowed_root)
        .env(
            "EDUPI_OPENCONNECTOR_CATALOG_ROOT",
            resource_dir.join("resources/open-connector"),
        )
        .env("PI_DESKTOP_STATE_DIR", &desktop_state_dir)
        .env("PI_WEB_PARENT_PID", std::process::id().to_string())
        .env("EDUPI_SAFE_MODE", if safe_mode_requested() { "1" } else { "0" })
        .env("EDUPI_MOBILE_BRIDGE_ENABLED", if mobile_enabled { "1" } else { "0" })
        .env(DESKTOP_API_TOKEN_ENV, desktop_api_token)
        .env(DESKTOP_INSTANCE_ID_ENV, desktop_instance_id)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    if mobile_enabled {
        if let Some(ip) = local_lan_ip().filter(|ip| !ip.is_loopback() && !ip.is_unspecified()) {
            command.env("EDUPI_MOBILE_BRIDGE_HOST", ip.to_string());
        }
    }

    if let Some(path) = server_process_path(&node_path) {
        command.env("PATH", path);
    }

    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn()?;

    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    if let Err(error) = wait_for_server(&mut child, address, desktop_instance_id, &log_path) {
        let server = DesktopServer::running(child);
        server.stop();
        return Err(error.into());
    }

    let url = format!("http://127.0.0.1:{port}").parse()?;
    Ok((url, DesktopServer::running(child)))
}

#[cfg(all(test, feature = "custom-protocol"))]
mod tests {
    use super::{
        build_root_status, child_process_compatible_path, clear_webview_caches_for_layout,
        default_allowed_root, ensure_data_directories, is_filesystem_root, mobile_gateway_reachable,
        args_request_safe_mode,
        normalize_update_proxy, read_update_proxy_from_path, write_update_proxy_file,
        persisted_data_root_from_prefs, read_last_version_from_path, reconcile_cache_version_state,
        response_has_instance_id, resume_gap_detected, should_reconcile_webview_cache,
        update_server_port_in_prefs, validate_selected_data_root, write_last_version_to_path,
        WebviewCacheLayout, FALLBACK_PERSISTED_CORRUPT, FALLBACK_PERSISTED_MISSING,
        FALLBACK_PERSISTED_NON_OBJECT, FALLBACK_PERSISTED_NOT_DIRECTORY, FALLBACK_PERSISTED_NO_KEY,
        FALLBACK_PERSISTED_SYMLINK,
    };
    use std::fs;
    use std::io::{self, Read, Write};
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, SystemTime};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn native_window_allows_the_800px_accessibility_viewport() {
        assert_eq!(super::MIN_WINDOW_WIDTH, 800.0);
        assert_eq!(super::MIN_WINDOW_HEIGHT, 600.0);
    }

    #[test]
    fn safe_mode_argument_is_explicit_and_does_not_match_similar_flags() {
        assert!(args_request_safe_mode(["edupi", "--safe-mode"]));
        assert!(!args_request_safe_mode(["edupi", "--safe-mode=1"]));
        assert!(!args_request_safe_mode(["edupi", "--safe"]));
    }

    #[test]
    fn mobile_status_requires_the_actual_gateway_not_an_occupied_port() {
        for (response, expected) in [
            ("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", false),
            ("HTTP/1.1 200 OK\r\nX-EduPi-Mobile-Gateway: 1\r\nContent-Length: 0\r\n\r\n", true),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 256];
                stream.read(&mut request).unwrap();
                stream.write_all(response.as_bytes()).unwrap();
            });
            assert_eq!(mobile_gateway_reachable(address), expected);
            server.join().unwrap();
        }
    }

    #[test]
    fn detects_a_long_system_clock_gap_without_treating_a_normal_poll_as_resume() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        assert!(!resume_gap_detected(
            start,
            start + Duration::from_secs(15),
            Duration::from_secs(45)
        ));
        assert!(resume_gap_detected(
            start,
            start + Duration::from_secs(60),
            Duration::from_secs(45)
        ));
        assert!(!resume_gap_detected(
            start,
            SystemTime::UNIX_EPOCH,
            Duration::from_secs(45)
        ));
    }

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("edupi-{label}-{}-{id}", std::process::id()));
            fs::create_dir(&path).expect("create isolated test root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(windows)]
    #[test]
    fn simplifies_verbatim_windows_path_before_launching_node() {
        let path = Path::new(
            r"\\?\C:\Users\毕良霞\AppData\Local\Pi Agent\resources\server\desktop-server.cjs",
        );

        assert_eq!(
            child_process_compatible_path(path),
            PathBuf::from(
                r"C:\Users\毕良霞\AppData\Local\Pi Agent\resources\server\desktop-server.cjs"
            )
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn leaves_non_windows_path_unchanged() {
        let path = Path::new("/Applications/Pi Agent.app/Contents/Resources/server");
        assert_eq!(child_process_compatible_path(path), PathBuf::from(path));
    }

    #[test]
    fn packaged_server_handshake_requires_the_expected_instance_header() {
        let expected = "instance-123";
        let matching = b"HTTP/1.1 204 No Content\r\nx-pi-desktop-instance: instance-123\r\n\r\n";
        let wrong = b"HTTP/1.1 204 No Content\r\nx-pi-desktop-instance: other\r\n\r\n";
        let body_spoof = b"HTTP/1.1 204 No Content\r\nContent-Type: text/plain\r\n\r\ninstance-123";

        assert!(response_has_instance_id(matching, expected));
        assert!(!response_has_instance_id(wrong, expected));
        assert!(!response_has_instance_id(body_spoof, expected));
    }

    #[test]
    fn allowed_roots_default_to_the_parent_of_an_absolute_root() {
        #[cfg(unix)]
        assert_eq!(default_allowed_root("/tmp/edupi-data").unwrap(), "/tmp");
        #[cfg(windows)]
        assert_eq!(default_allowed_root(r"C:\edupi-data").unwrap(), r"C:\");
        assert!(default_allowed_root("relative/edupi-data").is_err());
    }

    #[test]
    fn selected_directory_is_canonicalized_and_data_children_are_created() {
        let temp = TempRoot::new("selected-data");
        let selected = temp.path().join("selected");
        fs::create_dir(&selected).expect("create selected directory");

        let root = validate_selected_data_root(selected.to_string_lossy().into_owned()).unwrap();
        assert_eq!(Path::new(&root), dunce::canonicalize(&selected).unwrap());
        let (memory, output, locks) = ensure_data_directories(&root).unwrap();
        for directory in [memory, output, locks] {
            assert!(
                Path::new(&directory).is_dir(),
                "created data directory: {directory}"
            );
            assert!(Path::new(&directory).starts_with(&root));
        }
    }

    #[test]
    fn selected_directory_rejects_a_filesystem_root() {
        assert!(
            validate_selected_data_root(Path::new("/").to_string_lossy().into_owned()).is_err()
        );
        assert!(is_filesystem_root(Path::new("/")));
        for root in [
            r"C:\",
            "C:/",
            r"\\server\share\",
            r"\\?\C:\",
            r"\\?\UNC\server\share\",
        ] {
            assert!(
                is_filesystem_root(Path::new(root)),
                "expected filesystem root: {root}"
            );
        }
        for child in [
            r"C:\Users\teacher",
            "C:/Users/teacher",
            r"\\server\share\folder",
            r"\\?\C:\Users\teacher",
            r"\\?\UNC\server\share\folder",
        ] {
            assert!(
                !is_filesystem_root(Path::new(child)),
                "ordinary child must remain allowed: {child}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn selected_directory_rejects_a_symlink_root() {
        let temp = TempRoot::new("selected-symlink");
        let target = temp.path().join("target");
        let link = temp.path().join("link");
        fs::create_dir(&target).expect("create symlink target");
        std::os::unix::fs::symlink(&target, &link).expect("create symlink");
        let error = validate_selected_data_root(link.to_string_lossy().into_owned()).unwrap_err();
        assert!(error.to_string().contains("symlink"));
    }

    #[test]
    fn persisted_root_parser_accepts_valid_path_and_creates_children() {
        let temp = TempRoot::new("persisted-valid");
        let selected = temp.path().join("selected");
        fs::create_dir(&selected).expect("create persisted directory");
        let prefs = temp.path().join("ui-prefs.json");
        fs::write(
            &prefs,
            serde_json::json!({ "edupiDataRoot": selected }).to_string(),
        )
        .expect("write prefs");

        let result = persisted_data_root_from_prefs(&prefs).unwrap().unwrap();
        assert_eq!(Path::new(&result), dunce::canonicalize(&selected).unwrap());
        for child in ["memory", "output", "locks"] {
            assert!(Path::new(&result).join(".edupi").join(child).is_dir());
        }
    }

    #[test]
    fn persisted_root_parser_reports_corrupt_and_missing_directory_reasons() {
        let temp = TempRoot::new("persisted-reasons");
        let corrupt = temp.path().join("corrupt.json");
        fs::write(&corrupt, "{not-json").expect("write corrupt prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&corrupt).unwrap(),
            Err(FALLBACK_PERSISTED_CORRUPT)
        );

        let missing = temp.path().join("missing.json");
        let missing_root = temp.path().join("not-present");
        fs::write(
            &missing,
            serde_json::json!({ "edupiDataRoot": missing_root }).to_string(),
        )
        .expect("write missing prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&missing).unwrap(),
            Err(FALLBACK_PERSISTED_MISSING)
        );

        let no_key = temp.path().join("no-key.json");
        fs::write(&no_key, serde_json::json!({ "theme": "dark" }).to_string())
            .expect("write no-key prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&no_key).unwrap(),
            Err(FALLBACK_PERSISTED_NO_KEY)
        );

        let non_object = temp.path().join("non-object.json");
        fs::write(&non_object, "[]").expect("write non-object prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&non_object).unwrap(),
            Err(FALLBACK_PERSISTED_NON_OBJECT)
        );

        let file = temp.path().join("file");
        fs::write(&file, "not a directory").expect("write non-directory root");
        let not_directory = temp.path().join("not-directory.json");
        fs::write(
            &not_directory,
            serde_json::json!({ "edupiDataRoot": file }).to_string(),
        )
        .expect("write non-directory prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&not_directory).unwrap(),
            Err(FALLBACK_PERSISTED_NOT_DIRECTORY)
        );

        #[cfg(unix)]
        {
            let symlink = temp.path().join("symlink");
            let symlink_prefs = temp.path().join("symlink.json");
            std::os::unix::fs::symlink(temp.path(), &symlink).expect("create persisted symlink");
            fs::write(
                &symlink_prefs,
                serde_json::json!({ "edupiDataRoot": symlink }).to_string(),
            )
            .expect("write symlink prefs");
            assert_eq!(
                persisted_data_root_from_prefs(&symlink_prefs).unwrap(),
                Err(FALLBACK_PERSISTED_SYMLINK)
            );
        }
    }

    #[test]
    fn root_status_preserves_fallback_reason_and_editability() {
        let status = build_root_status(
            "/tmp/managed".into(),
            "managed",
            "/tmp/core".into(),
            "bundled",
            Some(FALLBACK_PERSISTED_CORRUPT.into()),
        );
        assert_eq!(
            status.fallback_reason.as_deref(),
            Some(FALLBACK_PERSISTED_CORRUPT)
        );
        assert!(status.can_change_data_root);

        let environment = build_root_status(
            "/tmp/environment".into(),
            "environment",
            "/tmp/core".into(),
            "environment",
            None,
        );
        assert!(!environment.can_change_data_root);
        assert_eq!(environment.fallback_reason, None);
    }

    #[test]
    fn passive_server_port_persistence_preserves_invalid_preferences() {
        let temp = TempRoot::new("port-prefs");
        let corrupt = temp.path().join("corrupt.json");
        let corrupt_bytes = b"{not-json";
        fs::write(&corrupt, corrupt_bytes).expect("write corrupt prefs");
        assert!(!update_server_port_in_prefs(&corrupt, 38471).unwrap());
        assert_eq!(fs::read(&corrupt).unwrap(), corrupt_bytes);
        assert_eq!(
            persisted_data_root_from_prefs(&corrupt).unwrap(),
            Err(FALLBACK_PERSISTED_CORRUPT)
        );

        let non_object = temp.path().join("non-object.json");
        let non_object_bytes = b"[\"keep\"]";
        fs::write(&non_object, non_object_bytes).expect("write non-object prefs");
        assert!(!update_server_port_in_prefs(&non_object, 38471).unwrap());
        assert_eq!(fs::read(&non_object).unwrap(), non_object_bytes);
        assert_eq!(
            persisted_data_root_from_prefs(&non_object).unwrap(),
            Err(FALLBACK_PERSISTED_NON_OBJECT)
        );
    }

    #[test]
    fn passive_server_port_persistence_updates_only_valid_object_port() {
        let temp = TempRoot::new("port-valid-prefs");
        let prefs = temp.path().join("ui-prefs.json");
        let selected = temp.path().join("selected-data");
        fs::create_dir(&selected).expect("create selected data");
        fs::write(
            &prefs,
            serde_json::json!({ "edupiDataRoot": selected, "theme": "dark" }).to_string(),
        )
        .expect("write valid prefs");

        assert!(update_server_port_in_prefs(&prefs, 38471).unwrap());
        let updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&prefs).unwrap()).unwrap();
        assert_eq!(updated["serverPort"], 38471);
        assert_eq!(updated["theme"], "dark");
        assert_eq!(
            updated["edupiDataRoot"],
            selected.to_string_lossy().as_ref()
        );
    }

    #[test]
    fn passive_server_port_persistence_creates_a_valid_prefs_file_when_missing() {
        let temp = TempRoot::new("port-missing-prefs");
        let prefs = temp.path().join("nested").join("ui-prefs.json");

        assert!(update_server_port_in_prefs(&prefs, 38471).unwrap());
        let updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&prefs).unwrap()).unwrap();
        assert_eq!(updated, serde_json::json!({ "serverPort": 38471 }));
    }

    #[test]
    fn update_proxy_accepts_only_local_http_without_credentials_or_paths() {
        assert_eq!(normalize_update_proxy("").unwrap(), None);
        assert_eq!(
            normalize_update_proxy(" http://127.0.0.1:7897 ").unwrap(),
            Some("http://127.0.0.1:7897".into())
        );
        for invalid in [
            "https://127.0.0.1:7897",
            "http://localhost:7897",
            "http://127.0.0.1",
            "http://127.0.0.1:0",
            "http://127.0.0.1:7897/path",
            "http://127.0.0.1:7897/?token=x",
            "http://user:pass@127.0.0.1:7897",
            "http://192.168.1.2:7897",
        ] {
            assert!(normalize_update_proxy(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn update_proxy_file_never_rewrites_teacher_prefs_and_preserves_corrupt_files() {
        let temp = TempRoot::new("updater-proxy-prefs");
        let teacher_prefs = temp.path().join("ui-prefs.json");
        let teacher_bytes = serde_json::json!({ "edupiDataRoot": "/teacher/data", "theme": "dark", "serverPort": 38471 }).to_string();
        fs::write(&teacher_prefs, &teacher_bytes).unwrap();
        let proxy_file = temp.path().join("updater-proxy.json");
        assert_eq!(read_update_proxy_from_path(&proxy_file).unwrap(), None);
        assert_eq!(
            write_update_proxy_file(&proxy_file, "http://127.0.0.1:7897").unwrap(),
            Some("http://127.0.0.1:7897".into())
        );
        assert_eq!(
            read_update_proxy_from_path(&proxy_file).unwrap(),
            Some("http://127.0.0.1:7897".into())
        );
        assert_eq!(
            write_update_proxy_file(&proxy_file, "http://127.0.0.1:7898").unwrap(),
            Some("http://127.0.0.1:7898".into())
        );
        assert_eq!(write_update_proxy_file(&proxy_file, "").unwrap(), None);
        assert_eq!(read_update_proxy_from_path(&proxy_file).unwrap(), None);
        assert_eq!(fs::read_to_string(&teacher_prefs).unwrap(), teacher_bytes);
        for invalid in ["{}", "{\"updateProxy\":\"\"}"] {
            fs::write(&proxy_file, invalid).unwrap();
            assert!(read_update_proxy_from_path(&proxy_file).is_err());
        }
        fs::write(&proxy_file, b"{broken").unwrap();
        assert!(write_update_proxy_file(&proxy_file, "http://127.0.0.1:7897").is_err());
        assert_eq!(fs::read(&proxy_file).unwrap(), b"{broken");
        assert_eq!(write_update_proxy_file(&proxy_file, "").unwrap(), None);
        assert_eq!(read_update_proxy_from_path(&proxy_file).unwrap(), None);
        assert_eq!(fs::read_to_string(&teacher_prefs).unwrap(), teacher_bytes);
    }

    #[test]
    fn passive_startup_distinguishes_unconfigured_prefs_from_a_missing_configured_root() {
        let temp = TempRoot::new("startup-order-prefs");
        let absent = temp.path().join("absent").join("ui-prefs.json");

        assert_eq!(
            persisted_data_root_from_prefs(&absent).unwrap(),
            Err(FALLBACK_PERSISTED_NO_KEY)
        );
        assert!(update_server_port_in_prefs(&absent, 38471).unwrap());
        assert_eq!(
            persisted_data_root_from_prefs(&absent).unwrap(),
            Err(FALLBACK_PERSISTED_NO_KEY)
        );

        let missing_target = temp.path().join("missing-target");
        let configured = temp.path().join("configured.json");
        fs::write(
            &configured,
            serde_json::json!({ "edupiDataRoot": missing_target }).to_string(),
        )
        .expect("write configured missing-root prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&configured).unwrap(),
            Err(FALLBACK_PERSISTED_MISSING)
        );
        assert!(update_server_port_in_prefs(&configured, 38472).unwrap());
        let updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&configured).unwrap()).unwrap();
        assert_eq!(updated["serverPort"], 38472);
        assert_eq!(
            updated["edupiDataRoot"],
            missing_target.to_string_lossy().as_ref()
        );
        assert_eq!(
            persisted_data_root_from_prefs(&configured).unwrap(),
            Err(FALLBACK_PERSISTED_MISSING)
        );
    }

    #[test]
    fn webview_cache_version_state_handles_absent_same_old_and_corrupt_files() {
        let temp = TempRoot::new("cache-version-state");
        let state = temp.path().join("last-version.json");

        assert_eq!(read_last_version_from_path(&state), None);
        assert!(should_reconcile_webview_cache(None, "0.3.1"));

        write_last_version_to_path(&state, "0.3.1").expect("write current version");
        assert_eq!(
            read_last_version_from_path(&state).as_deref(),
            Some("0.3.1")
        );
        assert!(!should_reconcile_webview_cache(
            read_last_version_from_path(&state).as_deref(),
            "0.3.1",
        ));

        write_last_version_to_path(&state, "0.3.0").expect("write old version");
        assert!(should_reconcile_webview_cache(
            read_last_version_from_path(&state).as_deref(),
            "0.3.1",
        ));

        fs::write(&state, "{not-json").expect("write corrupt version state");
        assert_eq!(read_last_version_from_path(&state), None);
        assert!(should_reconcile_webview_cache(
            read_last_version_from_path(&state).as_deref(),
            "0.3.1",
        ));

        let cleanup_succeeded = reconcile_cache_version_state(None, "0.3.1", || {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "cache is locked",
            ))
        });
        assert!(!cleanup_succeeded);
        if cleanup_succeeded {
            write_last_version_to_path(&state, "0.3.1").unwrap();
        }
        assert!(should_reconcile_webview_cache(
            read_last_version_from_path(&state).as_deref(),
            "0.3.1",
        ));
    }

    #[test]
    fn webview_cache_cleanup_is_bounded_and_preserves_edupi_data_and_preferences() {
        let temp = TempRoot::new("cache-boundaries");

        let linux_data = temp.path().join("linux/app-data");
        fs::create_dir_all(linux_data.join("WebKitCache/nested")).expect("create Linux cache");
        fs::create_dir_all(linux_data.join("edupi-data")).expect("create Linux EduPi data");
        fs::write(linux_data.join("WebKitCache/nested/cache.bin"), "cache").unwrap();
        fs::write(linux_data.join("edupi-data/teacher.json"), "keep").unwrap();
        fs::write(linux_data.join("ui-prefs.json"), "keep").unwrap();
        clear_webview_caches_for_layout(
            WebviewCacheLayout::Linux,
            &linux_data,
            None,
            "com.example.edupi",
        )
        .unwrap();
        assert!(!linux_data.join("WebKitCache").exists());
        assert!(linux_data.join("edupi-data/teacher.json").is_file());
        assert!(linux_data.join("ui-prefs.json").is_file());

        let windows_data = temp.path().join("windows/app-data");
        fs::create_dir_all(windows_data.join("EBWebView/profile-a/Cache")).unwrap();
        fs::create_dir_all(windows_data.join("EBWebView/profile-a/Local Storage")).unwrap();
        fs::create_dir_all(windows_data.join("EBWebView/profile-b/Cache")).unwrap();
        fs::create_dir_all(windows_data.join("edupi-data")).unwrap();
        fs::write(
            windows_data.join("EBWebView/profile-a/Cache/cache.bin"),
            "cache",
        )
        .unwrap();
        fs::write(
            windows_data.join("EBWebView/profile-a/Local Storage/state"),
            "keep",
        )
        .unwrap();
        fs::write(windows_data.join("edupi-data/teacher.json"), "keep").unwrap();
        clear_webview_caches_for_layout(
            WebviewCacheLayout::Windows,
            &windows_data,
            None,
            "com.example.edupi",
        )
        .unwrap();
        assert!(!windows_data.join("EBWebView/profile-a/Cache").exists());
        assert!(!windows_data.join("EBWebView/profile-b/Cache").exists());
        assert!(windows_data
            .join("EBWebView/profile-a/Local Storage/state")
            .is_file());
        assert!(windows_data.join("edupi-data/teacher.json").is_file());

        #[cfg(unix)]
        {
            let external_profile = temp.path().join("external-webview-profile");
            fs::create_dir_all(external_profile.join("Cache")).unwrap();
            fs::write(external_profile.join("Cache/external.bin"), "keep").unwrap();
            std::os::unix::fs::symlink(
                &external_profile,
                windows_data.join("EBWebView/profile-link"),
            )
            .unwrap();
            let error = clear_webview_caches_for_layout(
                WebviewCacheLayout::Windows,
                &windows_data,
                None,
                "com.example.edupi",
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(external_profile.join("Cache/external.bin").is_file());
        }

        let mac_data = temp.path().join("mac/app-data");
        let mac_home = temp.path().join("mac/home");
        fs::create_dir_all(mac_data.join("edupi-data")).unwrap();
        fs::create_dir_all(mac_home.join("Library/Caches/com.example.edupi/WebKit")).unwrap();
        fs::create_dir_all(
            mac_home.join("Library/WebKit/com.example.edupi/WebsiteData/LocalStorage"),
        )
        .unwrap();
        fs::create_dir_all(mac_home.join("Library/WebKit/com.other.app")).unwrap();
        fs::write(mac_data.join("edupi-data/teacher.json"), "keep").unwrap();
        fs::write(mac_data.join("ui-prefs.json"), "keep").unwrap();
        fs::write(
            mac_home.join("Library/Caches/com.example.edupi/WebKit/cache.bin"),
            "cache",
        )
        .unwrap();
        fs::write(
            mac_home
                .join("Library/WebKit/com.example.edupi/WebsiteData/LocalStorage/teacher-state"),
            "keep",
        )
        .unwrap();
        fs::write(
            mac_home.join("Library/WebKit/com.other.app/cache.bin"),
            "keep",
        )
        .unwrap();
        clear_webview_caches_for_layout(
            WebviewCacheLayout::Macos,
            &mac_data,
            Some(&mac_home),
            "com.example.edupi",
        )
        .unwrap();
        assert!(!mac_home
            .join("Library/Caches/com.example.edupi/WebKit")
            .exists());
        assert!(mac_home
            .join("Library/WebKit/com.example.edupi/WebsiteData/LocalStorage/teacher-state")
            .is_file());
        assert!(mac_home
            .join("Library/WebKit/com.other.app/cache.bin")
            .is_file());
        assert!(mac_data.join("edupi-data/teacher.json").is_file());
        assert!(mac_data.join("ui-prefs.json").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn child_process_core_root_normalization_strips_verbatim_prefix_without_truncating_path() {
        let verbatim = Path::new(r"\\?\C:\Users\teacher\AppData\Local\EduPi\resources\edupi-core");
        let normalized = child_process_compatible_path(verbatim);
        let text = normalized.to_string_lossy();
        assert!(!text.starts_with(r"\\?\"));
        assert!(text.starts_with(r"C:\Users\teacher\AppData\Local\EduPi\"));
        assert!(text.ends_with(r"resources\edupi-core"));
    }
}

#[cfg(not(feature = "custom-protocol"))]
fn start_development_server(
    _app: &tauri::AppHandle,
) -> Result<(Url, DesktopServer), Box<dyn std::error::Error>> {
    Ok((DEV_SERVER_URL.parse()?, DesktopServer::empty()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if safe_mode_requested() {
        env::set_var("EDUPI_SAFE_MODE", "1");
    }
    let desktop_api_token = load_or_generate_desktop_api_token()
        .expect("failed to create desktop API authorization token");
    let desktop_instance_id =
        generate_random_hex().expect("failed to create desktop server instance id");
    #[cfg(feature = "custom-protocol")]
    let server_api_token = desktop_api_token.clone();
    #[cfg(feature = "custom-protocol")]
    let server_instance_id = desktop_instance_id.clone();
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // Register first so a second executable focuses this window instead
        // of starting another server and WebView.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }));
    }
    let app = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(CloseQuits(Mutex::new(false)))
        .manage(DesktopApiToken(desktop_api_token))
        .manage(computer_use::ComputerUseState::new())
        .invoke_handler(tauri::generate_handler![
            reminder_notification::send_reminder_notification,
            reminder_notification::get_notification_permission_status,
            get_desktop_api_token,
            get_desktop_runtime_status,
            set_mobile_bridge_enabled,
            restart_normal_mode,
            open_external_url,
            open_path,
            reveal_item_in_dir,
            set_close_quits,
            quit_app,
            show_main_window_cmd,
            set_ui_theme,
            get_update_proxy,
            set_update_proxy,
            get_edupi_root_status,
            set_edupi_data_root,
            reset_edupi_data_root,
            computer_use::computer_use_status,
            computer_use::computer_use_set_enabled,
            computer_use::computer_use_emergency_stop,
            computer_use::computer_use_request_permission,
            computer_use::computer_use_execute
        ])
        .setup(move |app| {
            // The updater public key is embedded at compile time by the release
            // workflow. Local development builds intentionally omit it, which
            // keeps unsigned builds from accepting production updates.
            if let Some(public_key) = option_env!("PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY")
                .map(str::trim)
                .filter(|key| !key.is_empty())
            {
                app.handle().plugin(
                    tauri_plugin_updater::Builder::new()
                        .pubkey(public_key)
                        .build(),
                )?;
            }

            #[cfg(feature = "custom-protocol")]
            let (url, server) = match start_packaged_server(app.handle(), &server_api_token, &server_instance_id) {
                Ok(value) => value,
                Err(error) => {
                    record_native_startup_diagnostic(
                        app.handle(),
                        "server",
                        "packaged-next-server",
                        &error.to_string(),
                        None,
                    );
                    return Err(error);
                }
            };
            #[cfg(not(feature = "custom-protocol"))]
            let (url, server) = start_development_server(app.handle())?;

            app.manage(server);
            app.manage(start_desktop_resume_monitor(app.handle().clone())?);
            #[cfg(target_os = "macos")]
            reminder_notification::install_notification_delegate(app.handle())?;
            // Reconcile stale hashed web assets before the first window load.
            let webview_cache_reconciled = reconcile_webview_cache_for_version(app.handle());
            if let Err(error) = build_window(app.handle(), url) {
                record_native_startup_diagnostic(
                    app.handle(),
                    "window",
                    "main-webview",
                    &error.to_string(),
                    None,
                );
                return Err(error.into());
            }
            // A failed window build must leave the version mismatch in place
            // so the next launch retries cache reconciliation.
            // A failed cache cleanup also stays pending for the next launch.
            if webview_cache_reconciled {
                write_last_version(app.handle());
            }

            let quick_entry_item =
                MenuItem::with_id(app, "quick_entry", "Quick Entry", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show EduPi", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit EduPi", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quick_entry_item, &show_item, &quit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| std::io::Error::other("missing default window icon"))?;

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("EduPi")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quick_entry" => {
                        show_main_window(app);
                        let _ = app.emit("edupi://quick-entry", ());
                    }
                    "show" => show_main_window(app),
                    "quit" => quit_application(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let quit = window
                        .app_handle()
                        .try_state::<CloseQuits>()
                        .and_then(|state| state.0.lock().ok().map(|guard| *guard))
                        .unwrap_or(false);
                    if quit {
                        quit_application(window.app_handle());
                    } else {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Pi Agent desktop app");

    app.run(|app_handle, event| match event {
        RunEvent::Exit => {
            if let Some(monitor) = app_handle.try_state::<DesktopResumeMonitor>() {
                monitor.stop();
            }
            if let Some(server) = app_handle.try_state::<DesktopServer>() {
                server.stop();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                if let Some(window) = app_handle.get_webview_window(WINDOW_LABEL) {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        }
        _ => {}
    });
}

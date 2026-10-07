// EduPi safety host for NomiFun Computer Use.
// NomiFun core source: https://github.com/nomifun/nomifun-desktop
// SPDX-License-Identifier: Apache-2.0

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt as _;

use nomi_computer::{permissions, set_host_app_label, ComputerTool};
use nomi_config::config::ComputerConfig;
use nomi_tools::Tool;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::Mutex as AsyncMutex;

const MAX_TEXT_BYTES: usize = 20_000;
const MAX_LAUNCH_BYTES: usize = 2_048;
const MAX_KEY_BYTES: usize = 96;

pub struct ComputerUseState {
    enabled: AtomicBool,
    tool: Arc<ComputerTool>,
    execution_lock: AsyncMutex<()>,
    snapshot_id: Mutex<Option<String>>,
    sequence: AtomicU64,
}

impl ComputerUseState {
    pub fn new() -> Self {
        set_host_app_label("EduPi");
        Self {
            enabled: AtomicBool::new(false),
            tool: Arc::new(ComputerTool::new(&ComputerConfig::default())),
            execution_lock: AsyncMutex::new(()),
            snapshot_id: Mutex::new(None),
            sequence: AtomicU64::new(0),
        }
    }

    fn clear_snapshot(&self) {
        if let Ok(mut guard) = self.snapshot_id.lock() {
            *guard = None;
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        let now = now_ms();
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        format!("{prefix}-{now:x}-{sequence:x}")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseStatus {
    enabled: bool,
    accessibility: Option<bool>,
    screen_recording: Option<bool>,
    host: ComputerUseHostIdentity,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseHostIdentity {
    app_name: String,
    app_version: String,
    platform: String,
    process_id: u32,
    executable_path: Option<String>,
    bundle_path: Option<String>,
    bundle_id: String,
    signing_team: Option<String>,
}

fn application_bundle_path(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

fn host_identity(app: &AppHandle) -> ComputerUseHostIdentity {
    static IDENTITY: OnceLock<ComputerUseHostIdentity> = OnceLock::new();
    IDENTITY
        .get_or_init(|| {
            let executable = std::env::current_exe().ok();
            let bundle = executable.as_deref().and_then(application_bundle_path);
            let signing_team = if cfg!(target_os = "macos") {
                bundle
                    .as_ref()
                    .and_then(|path| {
                        std::process::Command::new("/usr/bin/codesign")
                            .args(["-d", "--verbose=4"])
                            .arg(path)
                            .output()
                            .ok()
                    })
                    .and_then(|output| {
                        String::from_utf8_lossy(&output.stderr)
                            .lines()
                            .find_map(|line| {
                                line.strip_prefix("TeamIdentifier=")
                                    .filter(|value| !value.is_empty() && *value != "not set")
                                    .map(str::to_owned)
                            })
                    })
            } else {
                None
            };
            ComputerUseHostIdentity {
                app_name: app
                    .config()
                    .product_name
                    .clone()
                    .unwrap_or_else(|| "EduPi".into()),
                app_version: env!("CARGO_PKG_VERSION").into(),
                platform: std::env::consts::OS.into(),
                process_id: std::process::id(),
                executable_path: executable.map(|path| path.to_string_lossy().into_owned()),
                bundle_path: bundle.map(|path| path.to_string_lossy().into_owned()),
                bundle_id: app.config().identifier.clone(),
                signing_team,
            }
        })
        .clone()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseImage {
    media_type: String,
    data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseResult {
    content: String,
    is_error: bool,
    images: Vec<ComputerUseImage>,
    snapshot_id: Option<String>,
    operation_id: String,
}

fn status(state: &ComputerUseState, app: &AppHandle) -> ComputerUseStatus {
    let permissions = permissions::permission_status();
    ComputerUseStatus {
        enabled: state.enabled.load(Ordering::SeqCst),
        accessibility: permissions.accessibility,
        screen_recording: permissions.screen_recording,
        host: host_identity(app),
    }
}

#[tauri::command]
pub fn computer_use_status(
    app: AppHandle,
    state: State<'_, ComputerUseState>,
) -> ComputerUseStatus {
    status(&state, &app)
}

#[tauri::command]
pub fn computer_use_set_enabled(
    app: AppHandle,
    enabled: bool,
    state: State<'_, ComputerUseState>,
) -> ComputerUseStatus {
    state.enabled.store(enabled, Ordering::SeqCst);
    if !enabled {
        state.clear_snapshot();
    }
    status(&state, &app)
}

#[tauri::command]
pub fn computer_use_emergency_stop(
    app: AppHandle,
    state: State<'_, ComputerUseState>,
) -> ComputerUseStatus {
    state.enabled.store(false, Ordering::SeqCst);
    state.clear_snapshot();
    status(&state, &app)
}

#[tauri::command]
pub fn computer_use_request_permission(
    app: AppHandle,
    permission: String,
    state: State<'_, ComputerUseState>,
) -> Result<ComputerUseStatus, String> {
    match permission.as_str() {
        "accessibility" => {
            permissions::request_accessibility();
        }
        "screen_recording" => {
            permissions::request_screen_recording();
        }
        _ => return Err("Unknown computer-use permission".to_string()),
    }
    Ok(status(&state, &app))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn request_expired(expires_at_ms: u64) -> bool {
    expires_at_ms == 0 || now_ms() > u128::from(expires_at_ms)
}

fn action(value: &Value) -> Result<&str, String> {
    value
        .as_object()
        .and_then(|object| object.get("action"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Computer action must contain a string action".to_string())
}

fn exact_keys(object: &Map<String, Value>, allowed: &[&str]) -> Result<(), String> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("Unsupported computer-use parameter: {key}"));
    }
    Ok(())
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    max_bytes: usize,
) -> Result<&'a str, String> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} is required"))?;
    if value.len() > max_bytes || value.contains('\0') {
        return Err(format!("{key} is too large or contains a null byte"));
    }
    Ok(value)
}

fn optional_i64(object: &Map<String, Value>, key: &str) -> Result<Option<i64>, String> {
    object
        .get(key)
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| format!("{key} must be an integer"))
        })
        .transpose()
}

fn required_i64(object: &Map<String, Value>, key: &str) -> Result<i64, String> {
    optional_i64(object, key)?.ok_or_else(|| format!("{key} is required"))
}

fn bounded_i32(value: i64, key: &str) -> Result<(), String> {
    if i32::try_from(value).is_err() {
        return Err(format!(
            "{key} is outside the supported desktop coordinate range"
        ));
    }
    Ok(())
}

fn validate_snapshot_id(object: &Map<String, Value>) -> Result<(), String> {
    let value = required_string(object, "snapshot_id", 96)?;
    if !value.starts_with("snapshot-")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("snapshot_id is invalid".to_string());
    }
    Ok(())
}

fn validate_input(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Computer action must be an object".to_string())?;
    let action = action(value)?;
    match action {
        "observe" | "cursor_position" | "list_windows" => exact_keys(object, &["action"]),
        "screenshot" => {
            exact_keys(object, &["action", "display"])?;
            if let Some(display) = optional_i64(object, "display")? {
                if display < 0 || u32::try_from(display).is_err() {
                    return Err("display is outside the supported range".to_string());
                }
            }
            Ok(())
        }
        "wait" => {
            exact_keys(object, &["action", "seconds"])?;
            if let Some(seconds) = object.get("seconds").and_then(Value::as_f64) {
                if !(0.0..=5.0).contains(&seconds) {
                    return Err("seconds must be between 0 and 5".to_string());
                }
            } else if object.contains_key("seconds") {
                return Err("seconds must be a number".to_string());
            }
            Ok(())
        }
        "click_element" | "right_click_element" | "double_click_element" => {
            exact_keys(object, &["action", "ref", "snapshot_id"])?;
            let element_ref = required_i64(object, "ref")?;
            if element_ref <= 0 || u32::try_from(element_ref).is_err() {
                return Err("ref is outside the supported range".to_string());
            }
            validate_snapshot_id(object)
        }
        "set_element_value" => {
            exact_keys(object, &["action", "ref", "text", "snapshot_id"])?;
            let element_ref = required_i64(object, "ref")?;
            if element_ref <= 0 || u32::try_from(element_ref).is_err() {
                return Err("ref is outside the supported range".to_string());
            }
            required_string(object, "text", MAX_TEXT_BYTES)?;
            validate_snapshot_id(object)
        }
        "launch" => {
            exact_keys(object, &["action", "target", "app"])?;
            required_string(object, "target", MAX_LAUNCH_BYTES)?;
            if object.contains_key("app") {
                required_string(object, "app", MAX_LAUNCH_BYTES)?;
            }
            Ok(())
        }
        "left_click" | "right_click" | "middle_click" | "double_click" | "triple_click"
        | "mouse_move" => {
            exact_keys(object, &["action", "x", "y", "snapshot_id"])?;
            bounded_i32(required_i64(object, "x")?, "x")?;
            bounded_i32(required_i64(object, "y")?, "y")?;
            validate_snapshot_id(object)
        }
        "left_click_drag" => {
            exact_keys(
                object,
                &[
                    "action",
                    "start_x",
                    "start_y",
                    "end_x",
                    "end_y",
                    "snapshot_id",
                ],
            )?;
            for key in ["start_x", "start_y", "end_x", "end_y"] {
                bounded_i32(required_i64(object, key)?, key)?;
            }
            validate_snapshot_id(object)
        }
        "type" => {
            exact_keys(object, &["action", "text", "snapshot_id"])?;
            required_string(object, "text", MAX_TEXT_BYTES)?;
            validate_snapshot_id(object)
        }
        "key" => {
            exact_keys(object, &["action", "key", "snapshot_id"])?;
            let key = required_string(object, "key", MAX_KEY_BYTES)?;
            if !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'_'))
            {
                return Err("key contains unsupported characters".to_string());
            }
            validate_snapshot_id(object)
        }
        "scroll" => {
            exact_keys(
                object,
                &["action", "direction", "amount", "x", "y", "snapshot_id"],
            )?;
            let direction = required_string(object, "direction", 8)?;
            if !matches!(direction, "up" | "down" | "left" | "right") {
                return Err("direction must be up, down, left, or right".to_string());
            }
            if let Some(amount) = optional_i64(object, "amount")? {
                if !(1..=100).contains(&amount) {
                    return Err("amount must be between 1 and 100".to_string());
                }
            }
            for key in ["x", "y"] {
                if let Some(value) = optional_i64(object, key)? {
                    bounded_i32(value, key)?;
                }
            }
            validate_snapshot_id(object)
        }
        "focus_window" => {
            exact_keys(object, &["action", "window_id", "snapshot_id"])?;
            let window_id = required_i64(object, "window_id")?;
            if window_id <= 0 || u32::try_from(window_id).is_err() {
                return Err("window_id is outside the supported range".to_string());
            }
            validate_snapshot_id(object)
        }
        _ => Err("Unsupported computer-use action".to_string()),
    }
}

fn establishes_snapshot(action: &str) -> bool {
    matches!(action, "observe" | "screenshot" | "list_windows")
}

fn mutates_desktop(action: &str) -> bool {
    !matches!(
        action,
        "observe" | "screenshot" | "cursor_position" | "list_windows" | "wait"
    )
}

fn requires_snapshot(action: &str) -> bool {
    mutates_desktop(action) && action != "launch"
}

fn audit_details(value: &Value) -> Value {
    let Some(object) = value.as_object() else {
        return json!({});
    };
    let action = object
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    match action {
        "click_element" | "right_click_element" | "double_click_element" | "set_element_value" => {
            json!({ "ref": object.get("ref"), "textBytes": object.get("text").and_then(Value::as_str).map(str::len) })
        }
        "left_click" | "right_click" | "middle_click" | "double_click" | "triple_click"
        | "mouse_move" => {
            json!({ "x": object.get("x"), "y": object.get("y") })
        }
        "left_click_drag" => json!({
            "startX": object.get("start_x"), "startY": object.get("start_y"),
            "endX": object.get("end_x"), "endY": object.get("end_y")
        }),
        "type" => json!({ "textBytes": object.get("text").and_then(Value::as_str).map(str::len) }),
        "key" => json!({ "key": object.get("key") }),
        "scroll" => json!({ "direction": object.get("direction"), "amount": object.get("amount") }),
        "focus_window" => json!({ "windowId": object.get("window_id") }),
        "screenshot" => json!({ "display": object.get("display") }),
        "launch" => json!({ "targetProvided": true, "appProvided": object.contains_key("app") }),
        "wait" => json!({ "seconds": object.get("seconds") }),
        _ => json!({}),
    }
}

fn short_text(value: Option<&str>, max_chars: usize) -> String {
    let normalized = value
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.chars().count() <= max_chars {
        normalized
    } else {
        format!(
            "{}…",
            normalized.chars().take(max_chars).collect::<String>()
        )
    }
}

fn approval_message(value: &Value) -> String {
    let action = value
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    match action {
        "observe" => "读取当前桌面的无障碍结构和屏幕画面".to_string(),
        "screenshot" => "截取当前桌面画面".to_string(),
        "list_windows" => "读取当前打开的窗口列表".to_string(),
        "cursor_position" => "读取鼠标位置".to_string(),
        "click_element" | "right_click_element" | "double_click_element" => {
            format!(
                "操作桌面元素 [{}]",
                value.get("ref").and_then(Value::as_i64).unwrap_or(0)
            )
        }
        "set_element_value" | "type" => format!(
            "向当前桌面控件输入：{}",
            short_text(value.get("text").and_then(Value::as_str), 80)
        ),
        "launch" => format!(
            "打开应用或文件：{}",
            short_text(value.get("target").and_then(Value::as_str), 100)
        ),
        "key" => format!(
            "发送按键：{}",
            value.get("key").and_then(Value::as_str).unwrap_or("")
        ),
        "scroll" => format!(
            "滚动桌面：{}",
            value.get("direction").and_then(Value::as_str).unwrap_or("")
        ),
        "focus_window" => format!(
            "切换到窗口 {}",
            value.get("window_id").and_then(Value::as_i64).unwrap_or(0)
        ),
        "left_click_drag" => "在桌面上拖动鼠标".to_string(),
        _ => format!("执行桌面操作：{action}"),
    }
}

async fn confirm_native_action(app: &AppHandle, input: &Value) -> Result<bool, String> {
    let app = app.clone();
    let message = approval_message(input);
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title("EduPi 桌面控制")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "允许".to_string(),
                "取消".to_string(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|error| format!("Desktop confirmation failed: {error}"))
}

fn append_audit(app: &AppHandle, record: &Value) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let path = log_dir.join("computer-use-audit.jsonl");
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, record).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn computer_use_execute(
    app: AppHandle,
    input: Value,
    expires_at_ms: u64,
    state: State<'_, ComputerUseState>,
) -> Result<ComputerUseResult, String> {
    if request_expired(expires_at_ms) {
        return Err("Desktop control request expired before execution.".to_string());
    }
    if !state.enabled.load(Ordering::SeqCst) {
        return Err(
            "Desktop control is off. Enable it in EduPi application settings first.".to_string(),
        );
    }
    validate_input(&input)?;
    let action = action(&input)?.to_string();
    let _execution = state.execution_lock.lock().await;
    if !state.enabled.load(Ordering::SeqCst) {
        return Err("Desktop control was stopped before this action began.".to_string());
    }

    if requires_snapshot(&action) {
        let supplied = input
            .get("snapshot_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "A fresh snapshot_id is required for this action".to_string())?;
        let current = state
            .snapshot_id
            .lock()
            .map_err(|_| "Desktop snapshot state is unavailable".to_string())?
            .clone();
        if current.as_deref() != Some(supplied) {
            return Err(
                "That desktop snapshot is stale. Observe the desktop again before acting."
                    .to_string(),
            );
        }
    }

    if action != "wait" && !confirm_native_action(&app, &input).await? {
        return Err("The teacher declined this desktop-control action.".to_string());
    }
    if request_expired(expires_at_ms) {
        return Err("Desktop control request expired while awaiting confirmation.".to_string());
    }
    if !state.enabled.load(Ordering::SeqCst) {
        return Err(
            "Desktop control was stopped while this action awaited confirmation.".to_string(),
        );
    }

    let operation_id = state.next_id("computer");
    let started = json!({
        "timestampMs": now_ms(),
        "operationId": operation_id,
        "action": action,
        "status": "started",
        "details": audit_details(&input),
    });
    append_audit(&app, &started)?;

    if mutates_desktop(&action) {
        state.clear_snapshot();
    }
    let mut forwarded = input.clone();
    if let Some(object) = forwarded.as_object_mut() {
        object.remove("snapshot_id");
    }
    let result = state.tool.execute(forwarded).await;

    let snapshot_id = if !result.is_error && establishes_snapshot(&action) {
        let snapshot_id = state.next_id("snapshot");
        if let Ok(mut guard) = state.snapshot_id.lock() {
            *guard = Some(snapshot_id.clone());
        }
        Some(snapshot_id)
    } else {
        None
    };
    let completed = json!({
        "timestampMs": now_ms(),
        "operationId": operation_id,
        "action": action,
        "status": "completed",
        "isError": result.is_error,
    });
    append_audit(&app, &completed)?;

    let mut content = result.content;
    if let Some(snapshot_id) = &snapshot_id {
        content.push_str(&format!("\n\nSnapshot id: {snapshot_id}"));
    }
    Ok(ComputerUseResult {
        content,
        is_error: result.is_error,
        images: result
            .images
            .into_iter()
            .map(|image| ComputerUseImage {
                media_type: image.media_type,
                data: image.data,
            })
            .collect(),
        snapshot_id,
        operation_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_identity_uses_the_running_bundle_not_a_search_result() {
        assert_eq!(
            application_bundle_path(Path::new(
                "/Applications/EduPi.app/Contents/MacOS/pi-agent-desktop"
            )),
            Some(PathBuf::from("/Applications/EduPi.app"))
        );
        assert_eq!(
            application_bundle_path(Path::new("/tmp/target/pi-agent-desktop")),
            None
        );
    }

    #[test]
    fn rejects_unknown_fields_and_unbounded_inputs() {
        assert!(validate_input(&json!({"action": "observe", "script": "bad"})).is_err());
        assert!(validate_input(&json!({"action": "wait", "seconds": 6})).is_err());
        assert!(validate_input(
            &json!({"action": "key", "key": "cmd;rm", "snapshot_id": "snapshot-a"})
        )
        .is_err());
    }

    #[test]
    fn every_coordinate_or_element_action_requires_a_snapshot() {
        assert!(validate_input(&json!({"action": "left_click", "x": 1, "y": 2})).is_err());
        assert!(validate_input(&json!({"action": "click_element", "ref": 1})).is_err());
        assert!(validate_input(
            &json!({"action": "left_click", "x": 1, "y": 2, "snapshot_id": "snapshot-a"})
        )
        .is_ok());
    }

    #[test]
    fn audit_details_never_store_typed_text_or_launch_targets() {
        let typed = audit_details(
            &json!({"action": "type", "text": "private answer", "snapshot_id": "snapshot-a"}),
        );
        let launched = audit_details(&json!({"action": "launch", "target": "/private/file"}));
        assert!(!typed.to_string().contains("private answer"));
        assert!(!launched.to_string().contains("/private/file"));
    }

    #[test]
    fn reads_establish_snapshots_and_mutations_invalidate_them() {
        assert!(establishes_snapshot("observe"));
        assert!(establishes_snapshot("screenshot"));
        assert!(requires_snapshot("focus_window"));
        assert!(!requires_snapshot("launch"));
        assert!(mutates_desktop("type"));
        assert!(!mutates_desktop("list_windows"));
    }

    #[test]
    fn expired_or_missing_deadlines_fail_closed() {
        assert!(request_expired(0));
        assert!(request_expired(1));
        assert!(!request_expired(u64::MAX));
    }
}

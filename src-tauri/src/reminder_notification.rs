#[cfg(target_os = "macos")]
use objc2::{
    define_class, msg_send,
    runtime::{NSObject, NSObjectProtocol, ProtocolObject},
    AnyThread, DefinedClass,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSDictionary, NSString};
#[cfg(target_os = "macos")]
use objc2_user_notifications::{
    UNNotification, UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSettings,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Emitter};

const MAX_PENDING_NOTIFICATION_TARGETS: usize = 128;
static NOTIFICATION_TARGETS: OnceLock<Mutex<VecDeque<(String, Option<Target>)>>> = OnceLock::new();
static PENDING_NOTIFICATION_OPENS: OnceLock<Mutex<VecDeque<Option<Target>>>> = OnceLock::new();
#[cfg(target_os = "macos")]
const PERSISTED_TARGET_KEY: &str = "edupi.reminder.target.v1";
#[cfg(target_os = "macos")]
const MAX_PERSISTED_TARGET_BYTES: usize = 1024;
#[cfg(target_os = "macos")]
static OPENED_NOTIFICATION_IDS: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

fn pending_targets() -> &'static Mutex<VecDeque<(String, Option<Target>)>> {
    NOTIFICATION_TARGETS.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn store_notification_target(id: String, target: Option<Target>) {
    if let Ok(mut targets) = pending_targets().lock() {
        targets.push_front((id, target));
        targets.truncate(MAX_PENDING_NOTIFICATION_TARGETS);
    }
}

fn take_notification_target(id: &str) -> Option<Option<Target>> {
    let mut targets = pending_targets().lock().ok()?;
    let index = targets.iter().position(|(pending, _)| pending == id)?;
    targets.remove(index).map(|(_, target)| target)
}

fn pending_notification_opens() -> &'static Mutex<VecDeque<Option<Target>>> {
    PENDING_NOTIFICATION_OPENS.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn enqueue_notification_open(target: Option<Target>) {
    let mut opens = pending_notification_opens()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    opens.push_back(target);
    while opens.len() > MAX_PENDING_NOTIFICATION_TARGETS {
        opens.pop_front();
    }
}

#[tauri::command]
pub fn take_pending_reminder_open() -> Vec<Option<Target>> {
    let mut opens = pending_notification_opens()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    opens.drain(..).collect()
}

#[cfg(target_os = "macos")]
fn first_default_action_for_notification(id: &str) -> bool {
    let opened = OPENED_NOTIFICATION_IDS.get_or_init(|| Mutex::new(VecDeque::new()));
    let Ok(mut opened) = opened.lock() else {
        return false;
    };
    if opened.iter().any(|previous| previous == id) {
        return false;
    }
    opened.push_front(id.to_string());
    opened.truncate(MAX_PENDING_NOTIFICATION_TARGETS);
    true
}

#[cfg(target_os = "macos")]
fn foreground_presentation_options() -> UNNotificationPresentationOptions {
    UNNotificationPresentationOptions::List
        | UNNotificationPresentationOptions::Banner
        | UNNotificationPresentationOptions::Sound
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct NotificationDelegateIvars {
    app: Option<AppHandle>,
}

#[cfg(target_os = "macos")]
define_class!(
    // SAFETY: NSObject has no subclassing requirements and the delegate does
    // not implement Drop.
    #[unsafe(super(NSObject))]
    #[ivars = NotificationDelegateIvars]
    struct EduPiNotificationDelegate;

    // SAFETY: NSObjectProtocol has no additional requirements.
    unsafe impl NSObjectProtocol for EduPiNotificationDelegate {}

    // SAFETY: The two implemented optional methods match the protocol selectors.
    unsafe impl UNUserNotificationCenterDelegate for EduPiNotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((foreground_presentation_options(),));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let request = response.notification().request();
            // SAFETY: Apple defines this static as an immutable NSString.
            let default_action = unsafe { UNNotificationDefaultActionIdentifier };
            if &*response.actionIdentifier() == default_action {
                let identifier = request.identifier().to_string();
                if first_default_action_for_notification(&identifier) {
                    let target = take_notification_target(&identifier).unwrap_or_else(|| {
                        target_from_notification_user_info(&request.content(), &identifier)
                    });
                    if let Some(app) = self.ivars().app.as_ref() {
                        activate(app, &target);
                    }
                }
            }
            completion_handler.call(());
        }
    }
);

#[cfg(target_os = "macos")]
impl EduPiNotificationDelegate {
    fn new(app: AppHandle) -> objc2::rc::Retained<Self> {
        let this = Self::alloc().set_ivars(NotificationDelegateIvars { app: Some(app) });
        // SAFETY: The selector and signature match NSObject init.
        unsafe { msg_send![super(this), init] }
    }
}

#[cfg(target_os = "macos")]
pub fn install_notification_delegate(app: &AppHandle) -> Result<(), String> {
    if tauri::is_dev() {
        return Ok(());
    }

    let center = UNUserNotificationCenter::currentNotificationCenter();
    let delegate = EduPiNotificationDelegate::new(app.clone());
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // UNUserNotificationCenter keeps its delegate weak; retain this one
    // process-lifetime object so it remains callable.
    std::mem::forget(delegate);
    Ok(())
}

static WAITING: AtomicUsize = AtomicUsize::new(0);
struct Waiting;
impl Drop for Waiting {
    fn drop(&mut self) {
        WAITING.fetch_sub(1, Ordering::SeqCst);
    }
}

fn acquire_waiting() -> Result<Waiting, String> {
    WAITING
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
            (count < 16).then_some(count + 1)
        })
        .map_err(|_| "notification_busy".to_string())?;
    Ok(Waiting)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPermissionStatus {
    authorization_status: isize,
    notification_center_setting: isize,
    alert_setting: isize,
    sound_setting: isize,
    alert_style: isize,
}

#[cfg(target_os = "macos")]
fn read_notification_settings(app: &AppHandle) -> Result<NotificationPermissionStatus, String> {
    use block2::RcBlock;
    use objc2_user_notifications::UNUserNotificationCenter;
    use std::ptr::NonNull;
    use std::sync::mpsc;

    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let completion = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: UserNotifications keeps the settings object alive
            // for the duration of this callback.
            let settings = unsafe { settings.as_ref() };
            let _ = sender.send(NotificationPermissionStatus {
                authorization_status: settings.authorizationStatus().0,
                notification_center_setting: settings.notificationCenterSetting().0,
                alert_setting: settings.alertSetting().0,
                sound_setting: settings.soundSetting().0,
                alert_style: settings.alertStyle().0,
            });
        });
        center.getNotificationSettingsWithCompletionHandler(&completion);
    })
    .map_err(|_| "notification_status_unavailable".to_string())?;

    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "notification_status_timeout".to_string())
}

#[cfg(not(target_os = "macos"))]
fn read_notification_settings(_app: &AppHandle) -> Result<NotificationPermissionStatus, String> {
    Ok(NotificationPermissionStatus {
        authorization_status: -1,
        notification_center_setting: -1,
        alert_setting: -1,
        sound_setting: -1,
        alert_style: -1,
    })
}

#[tauri::command]
pub fn get_notification_permission_status(
    app: AppHandle,
) -> Result<NotificationPermissionStatus, String> {
    read_notification_settings(&app)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    id: String,
    attempted_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    reminder_id: String,
    task_id: String,
    kind: String,
}

#[cfg(target_os = "macos")]
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTarget {
    version: u8,
    notification_id: String,
    target: Target,
}

fn valid_target(target: &Target) -> bool {
    !target.reminder_id.is_empty()
        && target.reminder_id.len() <= 64
        && !target.task_id.is_empty()
        && target.task_id.len() <= 500
        && matches!(target.kind.as_str(), "ready" | "failed" | "due" | "brief")
}

#[cfg(target_os = "macos")]
fn encode_persisted_target(identifier: &str, target: &Target) -> Option<String> {
    if identifier.is_empty() || identifier.len() > 128 || !valid_target(target) {
        return None;
    }
    let encoded = serde_json::to_string(&PersistedTarget {
        version: 1,
        notification_id: identifier.to_string(),
        target: target.clone(),
    })
    .ok()?;
    (encoded.len() <= MAX_PERSISTED_TARGET_BYTES).then_some(encoded)
}

#[cfg(target_os = "macos")]
fn decode_persisted_target(identifier: &str, encoded: &str) -> Option<Target> {
    if encoded.len() > MAX_PERSISTED_TARGET_BYTES {
        return None;
    }
    let persisted: PersistedTarget = serde_json::from_str(encoded).ok()?;
    (persisted.version == 1
        && persisted.notification_id == identifier
        && valid_target(&persisted.target))
    .then_some(persisted.target)
}

#[cfg(target_os = "macos")]
fn set_persisted_target_user_info(
    content: &objc2_user_notifications::UNMutableNotificationContent,
    identifier: &str,
    target: &Target,
) -> Result<(), String> {
    let encoded = encode_persisted_target(identifier, target)
        .ok_or_else(|| "invalid_notification".to_string())?;
    let key = NSString::from_str(PERSISTED_TARGET_KEY);
    let value = NSString::from_str(&encoded);
    let user_info = NSDictionary::from_slices(&[&*key], &[&*value]);
    // SAFETY: Both the key and value are NSString objects, which are valid
    // AnyObject dictionary entries. UserNotifications copies the dictionary.
    unsafe { content.setUserInfo(user_info.cast_unchecked()) };
    Ok(())
}

#[cfg(target_os = "macos")]
fn target_from_notification_user_info(
    content: &objc2_user_notifications::UNNotificationContent,
    identifier: &str,
) -> Option<Target> {
    let key = NSString::from_str(PERSISTED_TARGET_KEY);
    let encoded = content
        .userInfo()
        .objectForKey(&key)?
        .downcast::<NSString>()
        .ok()?;
    decode_persisted_target(identifier, &encoded.to_string())
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderNotification {
    title: String,
    body: String,
    target: Option<Target>,
    claims: Vec<Claim>,
}

fn valid(request: &ReminderNotification) -> bool {
    !request.title.is_empty()
        && request.title.len() <= 512
        && request.body.len() <= 2048
        && !request.claims.is_empty()
        && request.claims.len() <= 1000
        && request.claims.iter().all(|claim| {
            !claim.id.is_empty() && claim.id.len() <= 64 && claim.attempted_at.len() <= 80
        })
        && request.target.as_ref().map_or(true, valid_target)
}

fn activate(app: &AppHandle, target: &Option<Target>) {
    super::show_main_window(app);
    // The WebView may not have installed its listener yet when a notification
    // launches the application. The event wakes a live listener; the command
    // is the single source of pending click targets for both paths.
    enqueue_notification_open(target.clone());
    let _ = app.emit("edupi://reminder-open", target);
}

#[cfg(target_os = "macos")]
fn required_authorization_options() -> objc2_user_notifications::UNAuthorizationOptions {
    use objc2_user_notifications::UNAuthorizationOptions;

    UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound
}

#[cfg(target_os = "macos")]
fn request_authorization(app: &AppHandle) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSError;
    use objc2_user_notifications::UNUserNotificationCenter;
    use std::sync::mpsc;
    use std::time::Duration;

    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let completion = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = sender.send(granted.as_bool());
        });
        center.requestAuthorizationWithOptions_completionHandler(
            required_authorization_options(),
            &completion,
        );
    })
    .map_err(|_| "notification_permission_unavailable")?;

    receiver
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "notification_permission_timeout")?
        .then_some(())
        .ok_or_else(|| "notification_permission_denied".to_string())
}

#[cfg(target_os = "macos")]
fn deliver(app: &AppHandle, request: &ReminderNotification) -> Result<(), String> {
    if tauri::is_dev() {
        notify_rust::Notification::new()
            .summary(&request.title)
            .body(&request.body)
            .show()
            .map_err(|_| "notification_failed".to_string())?;
        return Ok(());
    }

    use block2::RcBlock;
    use objc2_foundation::NSError;
    use objc2_user_notifications::{UNMutableNotificationContent, UNNotificationSound};
    use std::sync::mpsc;

    let identifier = format!(
        "edupi-{}-{}",
        request.claims[0].id,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    store_notification_target(identifier.clone(), request.target.clone());
    let title = request.title.clone();
    let body = request.body.clone();
    let target = request.target.clone();
    let (sender, receiver) = mpsc::channel::<bool>();
    app.run_on_main_thread(move || {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        content.setThreadIdentifier(&NSString::from_str("edupi-reminders"));
        if let Some(target) = target.as_ref() {
            if set_persisted_target_user_info(&content, &identifier, target).is_err() {
                let _ = sender.send(false);
                return;
            }
        }
        let notification_request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&identifier),
            &content,
            None,
        );
        let completion = RcBlock::new(move |error: *mut NSError| {
            let _ = sender.send(error.is_null());
        });
        let center = UNUserNotificationCenter::currentNotificationCenter();
        center
            .addNotificationRequest_withCompletionHandler(&notification_request, Some(&completion));
    })
    .map_err(|_| "notification_failed".to_string())?;

    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "notification_failed".to_string())?
        .then_some(())
        .ok_or_else(|| "notification_failed".to_string())
}

#[cfg(target_os = "windows")]
fn deliver(app: &AppHandle, request: &ReminderNotification) -> Result<(), String> {
    let handle = app.clone();
    let target = request.target.clone();
    tauri_winrt_notification::Toast::new(&app.config().identifier)
        .title(&request.title)
        .text1(&request.body)
        .on_activated(move |_| {
            activate(&handle, &target);
            Ok(())
        })
        .show()
        .map_err(|_| "notification_failed".to_string())
}

#[cfg(target_os = "linux")]
fn deliver(app: &AppHandle, request: &ReminderNotification) -> Result<(), String> {
    let notification = notify_rust::Notification::new()
        .summary(&request.title)
        .body(&request.body)
        .action("default", "打开")
        .show()
        .map_err(|_| "notification_failed")?;
    notification.wait_for_action(|action| {
        if action == "default" {
            activate(app, &request.target);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn send_reminder_notification(
    app: AppHandle,
    request: ReminderNotification,
) -> Result<(), String> {
    if !valid(&request) {
        return Err("invalid_notification".into());
    }
    #[cfg(target_os = "macos")]
    if !tauri::is_dev() {
        request_authorization(&app)?;
    }

    let waiting = acquire_waiting()?;

    #[cfg(target_os = "macos")]
    {
        let result = deliver(&app, &request);
        drop(waiting);
        if let Err(error) = result {
            let _ = app.emit("edupi://reminder-failed", &request.claims);
            return Err(error);
        }
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("edupi-notification".into())
            .spawn(move || {
                let _waiting = waiting;
                let result = deliver(&app, &request);
                if result.is_err() {
                    let _ = app.emit("edupi://reminder-failed", &request.claims);
                }
                let _ = sender.send(result);
            })
            .map_err(|_| "notification_failed".to_string())?;
        return receiver
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| "notification_failed".to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::thread::Builder::new()
            .name("edupi-notification".into())
            .spawn(move || {
                let _waiting = waiting;
                if deliver(&app, &request).is_err() {
                    let _ = app.emit("edupi://reminder-failed", &request.claims);
                }
            })
            .map_err(|_| "notification_failed".to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_notifications_remain_visible_while_edupi_is_foreground() {
        let options = foreground_presentation_options();
        assert!(options.contains(UNNotificationPresentationOptions::List));
        assert!(options.contains(UNNotificationPresentationOptions::Banner));
        assert!(options.contains(UNNotificationPresentationOptions::Sound));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn notification_targets_are_bounded_and_consumed_once() {
        if let Ok(mut targets) = pending_targets().lock() {
            targets.clear();
        }
        for index in 0..=(MAX_PENDING_NOTIFICATION_TARGETS + 1) {
            store_notification_target(format!("target-{index}"), None);
        }
        let target_count = pending_targets()
            .lock()
            .map(|targets| targets.len())
            .unwrap_or_default();
        assert_eq!(target_count, MAX_PENDING_NOTIFICATION_TARGETS);
        assert!(take_notification_target("target-0").is_none());
        let consumed_target = take_notification_target("target-2");
        assert!(consumed_target.is_some());
        assert!(consumed_target.unwrap().is_none());
        assert!(take_notification_target("target-2").is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_notification_authorization_requests_alert_and_sound() {
        let options = required_authorization_options();
        assert!(options.contains(objc2_user_notifications::UNAuthorizationOptions::Alert));
        assert!(options.contains(objc2_user_notifications::UNAuthorizationOptions::Sound));
        assert!(!options.contains(objc2_user_notifications::UNAuthorizationOptions::CriticalAlert));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn persisted_target_survives_process_memory_loss_and_rejects_tampering() {
        let id = "edupi-r1-123456";
        let target = Target {
            reminder_id: "r1".into(),
            task_id: "teacher-task-1".into(),
            kind: "ready".into(),
        };
        let encoded = encode_persisted_target(id, &target).unwrap();
        assert!(encoded.len() <= MAX_PERSISTED_TARGET_BYTES);
        assert_eq!(
            decode_persisted_target(id, &encoded).unwrap().task_id,
            target.task_id
        );
        assert!(decode_persisted_target("edupi-r1-654321", &encoded).is_none());
        assert!(decode_persisted_target(id, &"x".repeat(MAX_PERSISTED_TARGET_BYTES + 1)).is_none());

        let malformed = encoded.replace("\"ready\"", "\"open_url\"");
        assert!(decode_persisted_target(id, &malformed).is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn persisted_target_round_trips_through_notification_user_info() {
        let id = "edupi-r2-123456";
        let target = Target {
            reminder_id: "r2".into(),
            task_id: "teacher-task-2".into(),
            kind: "failed".into(),
        };
        let content = objc2_user_notifications::UNMutableNotificationContent::new();
        set_persisted_target_user_info(&content, id, &target).unwrap();
        let decoded = target_from_notification_user_info(&content, id).unwrap();
        assert_eq!(decoded.reminder_id, target.reminder_id);
        assert_eq!(decoded.task_id, target.task_id);
        assert_eq!(decoded.kind, target.kind);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_default_action_is_consumed_once_even_when_payload_persists() {
        let id = "edupi-replay-unique";
        assert!(first_default_action_for_notification(id));
        assert!(!first_default_action_for_notification(id));
        assert!(first_default_action_for_notification("edupi-replay-other"));
    }

    #[test]
    fn pending_notification_opens_are_drained_once_in_order_and_bounded() {
        assert!(take_pending_reminder_open().is_empty());
        enqueue_notification_open(Some(Target {
            reminder_id: "r1".into(),
            task_id: "task-1".into(),
            kind: "ready".into(),
        }));
        enqueue_notification_open(None);
        let first = take_pending_reminder_open();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].as_ref().unwrap().task_id, "task-1");
        assert!(first[1].is_none());
        assert!(take_pending_reminder_open().is_empty());

        for index in 0..=MAX_PENDING_NOTIFICATION_TARGETS {
            enqueue_notification_open(Some(Target {
                reminder_id: format!("r{index}"),
                task_id: format!("task-{index}"),
                kind: "ready".into(),
            }));
        }
        let remaining = take_pending_reminder_open();
        assert_eq!(remaining.len(), MAX_PENDING_NOTIFICATION_TARGETS);
        assert_eq!(remaining[0].as_ref().unwrap().task_id, "task-1");
        assert_eq!(
            remaining.last().unwrap().as_ref().unwrap().task_id,
            "task-128"
        );
    }

    #[test]
    fn notification_targets_are_bounded_objects() {
        let mut value = ReminderNotification {
            title: "EduPi".into(),
            body: "已准备".into(),
            claims: vec![Claim {
                id: "r1".into(),
                attempted_at: "2026-09-09".into(),
            }],
            target: Some(Target {
                reminder_id: "r1".into(),
                task_id: "task1".into(),
                kind: "ready".into(),
            }),
        };
        assert!(valid(&value));
        value.target.as_mut().unwrap().kind = "open_url".into();
        assert!(!valid(&value));
        value.target = None;
        assert!(valid(&value));
        value.claims.clear();
        assert!(!valid(&value));
    }
}

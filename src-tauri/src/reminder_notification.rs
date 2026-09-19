use objc2::{
    define_class, msg_send,
    runtime::{NSObject, NSObjectProtocol, ProtocolObject},
    AnyThread, DefinedClass,
};
use objc2_foundation::NSString;
use objc2_user_notifications::{
    UNNotification, UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

const MAX_PENDING_NOTIFICATION_TARGETS: usize = 128;
static NOTIFICATION_TARGETS: OnceLock<Mutex<VecDeque<(String, Option<Target>)>>> = OnceLock::new();

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
    let index = {
        let targets = pending_targets().lock().ok()?;
        targets.iter().position(|(pending, _)| pending == id)
    }?;
    pending_targets()
        .lock()
        .ok()?
        .remove(index)
        .map(|(_, target)| target)
}

#[cfg(target_os = "macos")]
fn foreground_presentation_options() -> UNNotificationPresentationOptions {
    UNNotificationPresentationOptions::List
        | UNNotificationPresentationOptions::Banner
        | UNNotificationPresentationOptions::Sound
}

#[derive(Default)]
struct NotificationDelegateIvars {
    app: Option<AppHandle>,
}

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
            let target = take_notification_target(&request.identifier().to_string());
            // SAFETY: Apple defines this static as an immutable NSString.
            let default_action = unsafe { UNNotificationDefaultActionIdentifier };
            if &*response.actionIdentifier() == default_action {
                if let Some(app) = self.ivars().app.as_ref() {
                    let target = target.unwrap_or(None);
                    activate(app, &target);
                }
            }
            completion_handler.call(());
        }
    }
);

impl EduPiNotificationDelegate {
    fn new(app: AppHandle) -> objc2::rc::Retained<Self> {
        let this = Self::alloc().set_ivars(NotificationDelegateIvars { app: Some(app) });
        // SAFETY: The selector and signature match NSObject init.
        unsafe { msg_send![super(this), init] }
    }
}

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

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    id: String,
    attempted_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    task_id: String,
    kind: String,
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
        && request.target.as_ref().map_or(true, |target| {
            !target.task_id.is_empty()
                && target.task_id.len() <= 500
                && matches!(target.kind.as_str(), "ready" | "failed" | "due" | "brief")
        })
}

fn activate(app: &AppHandle, target: &Option<Target>) {
    super::show_main_window(app);
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
    let (sender, receiver) = mpsc::channel::<bool>();
    app.run_on_main_thread(move || {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        content.setThreadIdentifier(&NSString::from_str("edupi-reminders"));
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

    WAITING
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
            (count < 16).then_some(count + 1)
        })
        .map_err(|_| "notification_busy")?;
    let waiting = Waiting;
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

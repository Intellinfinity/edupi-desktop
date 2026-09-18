use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter};

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
    mac_notification_sys::set_application(if tauri::is_dev() {
        "com.apple.Terminal"
    } else {
        &app.config().identifier
    })
    .map_err(|_| "notification_failed")?;
    let response = mac_notification_sys::Notification::new()
        .title(&request.title)
        .message(&request.body)
        .wait_for_click(true)
        .send()
        .map_err(|_| "notification_failed")?;
    if matches!(
        response,
        mac_notification_sys::NotificationResponse::Click
            | mac_notification_sys::NotificationResponse::ActionButton(_)
    ) {
        activate(app, &request.target);
    }
    Ok(())
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
    request_authorization(&app)?;

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

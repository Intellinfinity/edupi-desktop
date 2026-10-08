use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
const MAX_FILE_BYTES: u64 = 2_100_000;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForegroundSettings {
    grace_days: u16,
    pinned_task_ids: Vec<String>,
    #[serde(default)]
    dismissed_stale_task_ids: Vec<String>,
}

impl ForegroundSettings {
    fn validate(&self) -> Result<(), String> {
        if self.grace_days > 365
            || self.pinned_task_ids.len() > 1000
            || self.dismissed_stale_task_ids.len() > 1000
            || self
                .pinned_task_ids
                .iter()
                .chain(self.dismissed_stale_task_ids.iter())
                .any(|id| id.is_empty() || id.chars().count() > 256)
        {
            return Err("前台设置无效".into());
        }
        Ok(())
    }
}

pub(crate) fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let requested = [
        super::ROUTE1_ISOLATED_CANARY_ENV,
        "EDUPI_DESKTOP_ISOLATED_CANARY",
    ]
    .iter()
    .any(|name| std::env::var(name).as_deref() == Ok("1"));
    let isolated = validated_isolation(
        requested,
        app.try_state::<super::DesktopServer>()
            .map(|server| server.isolated_canary()),
    )?;
    let config = app
        .path()
        .app_config_dir()
        .map_err(|_| "前台设置路径不可用".to_string())?;
    let dir = if isolated {
        let (_, root) = super::first_configured_root(&[
            super::EDUPI_DATA_ROOT_ENV,
            super::EDUPI_PROJECT_ROOT_ENV,
            super::EDUPI_WORKSPACE_ENV,
        ])
        .ok_or_else(|| "隔离前台设置路径不可用".to_string())?;
        super::route1_desktop_state_dir(&config, Path::new(&root), None, true)
            .map_err(|_| "隔离前台设置路径不可用".to_string())?
    } else {
        config
    };
    Ok(dir.join("foreground-prefs.json"))
}

fn validated_isolation(requested: bool, verified: Option<bool>) -> Result<bool, String> {
    match verified {
        Some(true) => Ok(true),
        Some(false) if !requested => Ok(false),
        _ => Err("前台设置运行范围未验证".into()),
    }
}

fn read_settings(path: &Path) -> Result<Option<ForegroundSettings>, String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_FILE_BYTES => {}
        _ => return Err("前台设置文件不可读取".into()),
    }
    let mut raw = String::new();
    fs::File::open(path)
        .map_err(|_| "前台设置不可读取".to_string())?
        .take(MAX_FILE_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(|_| "前台设置不可读取".to_string())?;
    if raw.len() as u64 > MAX_FILE_BYTES {
        return Err("前台设置文件过大".into());
    }
    let settings: ForegroundSettings =
        serde_json::from_str(&raw).map_err(|_| "前台设置文件无效".to_string())?;
    settings.validate()?;
    Ok(Some(settings))
}

fn write_settings(path: &Path, settings: &ForegroundSettings) -> Result<(), String> {
    settings.validate()?;
    let bytes = serde_json::to_vec(settings).map_err(|_| "前台设置无效".to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("前台设置文件过大".into());
    }
    read_settings(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "前台设置路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "前台设置不可保存".to_string())?;
    let temporary = parent.join(format!(".foreground-{}.tmp", super::generate_random_hex()?));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "前台设置不可保存".to_string())?;
        file.write_all(&bytes)
            .map_err(|_| "前台设置不可保存".to_string())?;
        file.sync_all()
            .map_err(|_| "前台设置不可保存".to_string())?;
        drop(file);
        super::replace_file_atomically(&temporary, path).map_err(|_| "前台设置不可保存".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub fn get_foreground_settings(app: AppHandle) -> Result<Option<ForegroundSettings>, String> {
    read_settings(&settings_path(&app)?)
}

#[tauri::command]
pub fn set_foreground_settings(app: AppHandle, settings: ForegroundSettings) -> Result<(), String> {
    write_settings(&settings_path(&app)?, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unverified_canary_or_uninitialized_server_never_falls_back_to_public_preferences() {
        assert_eq!(validated_isolation(false, Some(false)).unwrap(), false);
        assert_eq!(validated_isolation(true, Some(true)).unwrap(), true);
        assert!(validated_isolation(true, Some(false)).is_err());
        assert!(validated_isolation(true, None).is_err());
        assert!(validated_isolation(false, None).is_err());
    }
    #[test]
    fn preferences_survive_reopen_and_invalid_changes_preserve_previous_bytes() {
        let dir = std::env::temp_dir().join(format!(
            "edupi-foreground-prefs-{}",
            crate::generate_random_hex().unwrap()
        ));
        let path = dir.join("foreground-prefs.json");
        assert_eq!(read_settings(&path).unwrap(), None);
        let settings = ForegroundSettings {
            grace_days: 7,
            pinned_task_ids: vec!["synthetic-task".into()],
            dismissed_stale_task_ids: vec!["synthetic-old-festival".into()],
        };
        write_settings(&path, &settings).unwrap();
        assert_eq!(read_settings(&path).unwrap(), Some(settings.clone()));
        let before = fs::read(&path).unwrap();
        assert!(write_settings(
            &path,
            &ForegroundSettings {
                grace_days: 366,
                ..settings
            }
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let oversized = ForegroundSettings {
            grace_days: 3,
            pinned_task_ids: vec!["\0".repeat(256); 1000],
            dismissed_stale_task_ids: vec!["\0".repeat(256); 1000],
        };
        assert!(write_settings(&path, &oversized).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(read_settings(&path).unwrap().unwrap().grace_days, 7);
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}

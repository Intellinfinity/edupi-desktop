use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::AppHandle;

const MAX_ENTRIES: usize = 100;
const MAX_BYTES: u64 = 32 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AmbientCaptureEntry {
    session_id: String,
    message_id: String,
    occurred_at: String,
    #[serde(default)]
    cancel_requested: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Outbox {
    version: u8,
    entries: Vec<AmbientCaptureEntry>,
}

fn locked() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn valid_id(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:@/+~=-".contains(&byte))
}

fn valid_time(value: &str) -> bool {
    let bytes = value.as_bytes();
    let shape = bytes.len() == 24
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'.'
        && bytes[23] == b'Z'
        && bytes.iter().enumerate().all(|(index, byte)| {
            [4, 7, 10, 13, 16, 19, 23].contains(&index) || byte.is_ascii_digit()
        });
    if !shape {
        return false;
    }
    let Ok(year) = value[0..4].parse::<u16>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u8>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u8>() else {
        return false;
    };
    let Ok(hour) = value[11..13].parse::<u8>() else {
        return false;
    };
    let Ok(minute) = value[14..16].parse::<u8>() else {
        return false;
    };
    let Ok(second) = value[17..19].parse::<u8>() else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60
}

impl AmbientCaptureEntry {
    fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.session_id, 256)
            || !valid_id(&self.message_id, 128)
            || !valid_time(&self.occurred_at)
        {
            return Err("待核验请求身份无效".into());
        }
        Ok(())
    }
}

fn validate_outbox(value: &Outbox) -> Result<(), String> {
    if value.version != 1 || value.entries.len() > MAX_ENTRIES {
        return Err("待核验请求文件无效".into());
    }
    let mut identities = HashSet::new();
    for entry in &value.entries {
        entry.validate()?;
        if !identities.insert((entry.session_id.as_str(), entry.message_id.as_str())) {
            return Err("待核验请求身份重复".into());
        }
    }
    Ok(())
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(super::foreground_prefs::settings_path(app)?
        .with_file_name("ambient-capture-outbox-v1.json"))
}

fn read_outbox(path: &Path) -> Result<Outbox, String> {
    let metadata = match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Outbox {
                version: 1,
                entries: vec![],
            });
        }
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_BYTES =>
        {
            metadata
        }
        _ => return Err("待核验请求文件不可读取".into()),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let parent = path
            .parent()
            .ok_or_else(|| "待核验请求路径无效".to_string())?;
        let directory = fs::metadata(parent).map_err(|_| "待核验请求路径无效".to_string())?;
        if metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
            || metadata.uid() != directory.uid()
        {
            return Err("待核验请求文件权限无效".into());
        }
    }
    read_outbox_after_stat(path, &metadata)
}

fn read_outbox_after_stat(path: &Path, metadata: &fs::Metadata) -> Result<Outbox, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|_| "待核验请求文件不可读取".to_string())?;
    let opened = file
        .metadata()
        .map_err(|_| "待核验请求文件不可读取".to_string())?;
    if !opened.is_file() || opened.file_type().is_symlink() || opened.len() > MAX_BYTES {
        return Err("待核验请求文件不可读取".into());
    }
    verify_open_file(path, metadata, &opened)?;
    let mut raw = Vec::new();
    (&file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut raw)
        .map_err(|_| "待核验请求文件不可读取".to_string())?;
    if raw.len() as u64 > MAX_BYTES {
        return Err("待核验请求文件过大".into());
    }
    let opened_after = file
        .metadata()
        .map_err(|_| "待核验请求文件不可读取".to_string())?;
    verify_open_file(path, metadata, &opened_after)?;
    let value: Outbox =
        serde_json::from_slice(&raw).map_err(|_| "待核验请求文件无效".to_string())?;
    validate_outbox(&value)?;
    Ok(value)
}

fn verify_open_file(
    path: &Path,
    before: &fs::Metadata,
    opened: &fs::Metadata,
) -> Result<(), String> {
    let current = fs::symlink_metadata(path).map_err(|_| "待核验请求文件不可读取".to_string())?;
    if !current.is_file() || current.file_type().is_symlink() || current.len() > MAX_BYTES {
        return Err("待核验请求文件不可读取".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let same = |left: &fs::Metadata, right: &fs::Metadata| {
            left.dev() == right.dev()
                && left.ino() == right.ino()
                && left.len() == right.len()
                && left.mode() == right.mode()
                && left.uid() == right.uid()
                && left.nlink() == right.nlink()
                && left.mtime() == right.mtime()
                && left.mtime_nsec() == right.mtime_nsec()
                && left.ctime() == right.ctime()
                && left.ctime_nsec() == right.ctime_nsec()
        };
        if !same(before, opened)
            || !same(opened, &current)
            || opened.mode() & 0o077 != 0
            || opened.nlink() != 1
            || current.mode() & 0o077 != 0
            || current.nlink() != 1
        {
            return Err("待核验请求文件身份已变化".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if opened.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || current.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || before.len() != opened.len()
            || opened.len() != current.len()
            || before.last_write_time() != opened.last_write_time()
            || opened.last_write_time() != current.last_write_time()
        {
            return Err("待核验请求文件身份已变化".into());
        }
    }
    Ok(())
}

fn write_outbox(path: &Path, value: &Outbox) -> Result<(), String> {
    validate_outbox(value)?;
    let bytes = serde_json::to_vec(value).map_err(|_| "待核验请求不可保存".to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("待核验请求文件过大".into());
    }
    read_outbox(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "待核验请求路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "待核验请求不可保存".to_string())?;
    let temporary = parent.join(format!(
        ".ambient-capture-{}.tmp",
        super::generate_random_hex()?
    ));
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
            .map_err(|_| "待核验请求不可保存".to_string())?;
        file.write_all(&bytes)
            .map_err(|_| "待核验请求不可保存".to_string())?;
        file.sync_all()
            .map_err(|_| "待核验请求不可保存".to_string())?;
        drop(file);
        super::replace_file_atomically(&temporary, path)
            .map_err(|_| "待核验请求不可保存".to_string())?;
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn remember(path: &Path, entry: AmbientCaptureEntry) -> Result<(), String> {
    entry.validate()?;
    if entry.cancel_requested {
        return Err("待核验请求状态无效".into());
    }
    let _guard = locked()
        .lock()
        .map_err(|_| "待核验请求锁不可用".to_string())?;
    let mut outbox = read_outbox(path)?;
    if let Some(prior) = outbox
        .entries
        .iter()
        .find(|item| item.session_id == entry.session_id && item.message_id == entry.message_id)
    {
        return if *prior == entry {
            Ok(())
        } else {
            Err("待核验请求身份冲突".into())
        };
    }
    if outbox.entries.len() >= MAX_ENTRIES {
        return Err("待核验请求队列已满".into());
    }
    outbox.entries.push(entry);
    write_outbox(path, &outbox)
}

fn clear(path: &Path, session_id: &str, message_id: &str) -> Result<(), String> {
    if !valid_id(session_id, 256) || !valid_id(message_id, 128) {
        return Err("待核验请求身份无效".into());
    }
    let _guard = locked()
        .lock()
        .map_err(|_| "待核验请求锁不可用".to_string())?;
    let mut outbox = read_outbox(path)?;
    let before = outbox.entries.len();
    outbox
        .entries
        .retain(|item| item.session_id != session_id || item.message_id != message_id);
    if outbox.entries.len() == before {
        return Ok(());
    }
    write_outbox(path, &outbox)
}

fn mark_cancel_requested(
    path: &Path,
    session_id: &str,
    message_id: &str,
    occurred_at: &str,
) -> Result<(), String> {
    if !valid_id(session_id, 256) || !valid_id(message_id, 128) || !valid_time(occurred_at) {
        return Err("待核验请求身份无效".into());
    }
    let _guard = locked()
        .lock()
        .map_err(|_| "待核验请求锁不可用".to_string())?;
    let mut outbox = read_outbox(path)?;
    let entry = outbox
        .entries
        .iter_mut()
        .find(|item| item.session_id == session_id && item.message_id == message_id)
        .ok_or_else(|| "待核验请求不存在".to_string())?;
    if entry.occurred_at != occurred_at {
        return Err("待核验请求身份冲突".into());
    }
    if entry.cancel_requested {
        return Ok(());
    }
    entry.cancel_requested = true;
    write_outbox(path, &outbox)
}

#[tauri::command]
pub fn get_ambient_capture_outbox(app: AppHandle) -> Result<Vec<AmbientCaptureEntry>, String> {
    let _guard = locked()
        .lock()
        .map_err(|_| "待核验请求锁不可用".to_string())?;
    Ok(read_outbox(&path(&app)?)?.entries)
}

#[tauri::command]
pub fn remember_ambient_capture(app: AppHandle, entry: AmbientCaptureEntry) -> Result<(), String> {
    remember(&path(&app)?, entry)
}

#[tauri::command]
pub fn clear_ambient_capture(
    app: AppHandle,
    session_id: String,
    message_id: String,
) -> Result<(), String> {
    clear(&path(&app)?, &session_id, &message_id)
}

#[tauri::command]
pub fn mark_ambient_capture_cancel_requested(
    app: AppHandle,
    session_id: String,
    message_id: String,
    occurred_at: String,
) -> Result<(), String> {
    mark_cancel_requested(&path(&app)?, &session_id, &message_id, &occurred_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn cold_reopen_preserves_only_bounded_identity_and_rejects_corruption() {
        let dir = std::env::temp_dir().join(format!(
            "edupi-ambient-outbox-{}",
            crate::generate_random_hex().unwrap()
        ));
        let file = dir.join("ambient-capture-outbox-v1.json");
        let entry = AmbientCaptureEntry {
            session_id: "synthetic-session".into(),
            message_id: "prompt-stable".into(),
            occurred_at: "2026-10-08T00:00:00.000Z".into(),
            cancel_requested: false,
        };
        remember(&file, entry.clone()).unwrap();
        assert_eq!(read_outbox(&file).unwrap().entries, vec![entry.clone()]);
        remember(&file, entry.clone()).unwrap();
        assert!(remember(
            &file,
            AmbientCaptureEntry {
                occurred_at: "2026-10-08T00:00:01.000Z".into(),
                ..entry.clone()
            }
        )
        .is_err());
        assert!(remember(
            &file,
            AmbientCaptureEntry {
                message_id: "invalid-time".into(),
                occurred_at: "2026-02-30T00:00:00.000Z".into(),
                ..entry.clone()
            }
        )
        .is_err());
        assert!(fs::read_to_string(&file).unwrap().contains("prompt-stable"));
        assert!(!fs::read_to_string(&file)
            .unwrap()
            .contains("synthetic teacher text"));
        #[cfg(unix)]
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o077, 0);
        clear(&file, &entry.session_id, &entry.message_id).unwrap();
        assert!(read_outbox(&file).unwrap().entries.is_empty());
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = dir.join("foreign.json");
            fs::write(&target, "{}").unwrap();
            fs::remove_file(&file).unwrap();
            symlink(&target, &file).unwrap();
            assert!(read_outbox(&file).is_err());
            fs::remove_file(&file).unwrap();
        }
        fs::write(&file, "{broken").unwrap();
        #[cfg(unix)]
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(read_outbox(&file).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_identity_never_implies_cancel_but_an_explicit_unsent_mark_survives_reopen() {
        let dir = std::env::temp_dir().join(format!(
            "edupi-ambient-cancel-{}",
            crate::generate_random_hex().unwrap()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("ambient-capture-outbox-v1.json");
        let old = r#"{"version":1,"entries":[{"sessionId":"synthetic-session","messageId":"prompt-stable","occurredAt":"2026-10-08T00:00:00.000Z"}]}"#;
        fs::write(&file, old).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read_outbox(&file).unwrap().entries[0].cancel_requested, false);
        mark_cancel_requested(&file, "synthetic-session", "prompt-stable", "2026-10-08T00:00:00.000Z").unwrap();
        assert_eq!(read_outbox(&file).unwrap().entries[0].cancel_requested, true);
        assert!(!fs::read_to_string(&file).unwrap().contains("teacher text"));
        assert!(mark_cancel_requested(&file, "synthetic-session", "prompt-stable", "2026-10-08T00:00:01.000Z").is_err());
        clear(&file, "synthetic-session", "prompt-stable").unwrap();
        assert!(read_outbox(&file).unwrap().entries.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replacing_the_outbox_between_stat_and_open_never_reads_the_substitute() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!(
            "edupi-ambient-outbox-race-{}",
            crate::generate_random_hex().unwrap()
        ));
        let file = dir.join("ambient-capture-outbox-v1.json");
        let saved = dir.join("saved.json");
        let foreign = dir.join("foreign.json");
        remember(
            &file,
            AmbientCaptureEntry {
                session_id: "original-session".into(),
                message_id: "prompt-original".into(),
                occurred_at: "2026-10-08T00:00:00.000Z".into(),
                cancel_requested: false,
            },
        )
        .unwrap();
        let metadata = fs::symlink_metadata(&file).unwrap();
        let substitute = Outbox {
            version: 1,
            entries: vec![AmbientCaptureEntry {
                session_id: "foreign-session".into(),
                message_id: "prompt-foreign".into(),
                occurred_at: "2026-10-08T00:00:00.000Z".into(),
                cancel_requested: false,
            }],
        };
        fs::write(&foreign, serde_json::to_vec(&substitute).unwrap()).unwrap();
        fs::set_permissions(&foreign, fs::Permissions::from_mode(0o600)).unwrap();
        fs::rename(&file, &saved).unwrap();
        symlink(&foreign, &file).unwrap();
        assert!(read_outbox_after_stat(&file, &metadata).is_err());
        fs::remove_file(&file).unwrap();
        fs::copy(&foreign, &file).unwrap();
        assert!(read_outbox_after_stat(&file, &metadata).is_err());
        let same_inode = fs::symlink_metadata(&file).unwrap();
        fs::write(
            &file,
            serde_json::to_vec(&Outbox {
                version: 1,
                entries: vec![],
            })
            .unwrap(),
        )
        .unwrap();
        assert!(read_outbox_after_stat(&file, &same_inode).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}

//! Holds the installed Windows attestation add-on and its entire source chain
//! against replacement while the Core child is alive. The Core add-on still
//! attests the *data* root and its writers independently; this only protects
//! the code source before Node loads it.
//!
//! The checks mirror Core's `native/windows-runtime-attestation/attestation.cc`.
//! Win32 handle/ACL contracts:
//! https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
//! https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo
//! https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew

use std::{
    ffi::{c_void, OsStr},
    fs, io,
    mem::{offset_of, size_of},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
};

use windows_sys::Win32::{
    Foundation::{
        GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, ERROR_NO_TOKEN, GENERIC_ALL,
        GENERIC_EXECUTE, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
    },
    Globalization::{CompareStringOrdinal, CSTR_EQUAL},
    Security::{
        AclSizeInformation,
        Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
        CreateWellKnownSid, EqualSid, GetAce, GetAclInformation, GetLengthSid,
        GetSecurityDescriptorDacl, GetTokenInformation, IsValidAcl, IsValidSid, IsWellKnownSid,
        LookupAccountNameW, TokenUser, WinBuiltinAdministratorsSid, WinCreatorOwnerSid,
        WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
        DACL_SECURITY_INFORMATION, INHERIT_ONLY_ACE, OWNER_SECURITY_INFORMATION, PSID,
        SECURITY_MAX_SID_SIZE, SID_NAME_USE, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        BusTypeAta, BusTypeNvme, BusTypeRAID, BusTypeSas, BusTypeSata, BusTypeScsi, CreateFileW,
        FileAttributeTagInfo, FileIdInfo, GetDriveTypeW, GetFileInformationByHandleEx,
        GetFinalPathNameByHandleW, GetVolumeInformationByHandleW, DELETE, FILE_APPEND_DATA,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
        FILE_DELETE_CHILD, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO,
        FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_READ_EA,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE, FILE_WRITE_ATTRIBUTES,
        FILE_WRITE_DATA, FILE_WRITE_EA, OPEN_EXISTING, READ_CONTROL, VOLUME_NAME_DOS, WRITE_DAC,
        WRITE_OWNER,
    },
    System::{
        Ioctl::{
            PropertyStandardQuery, StorageDeviceProperty, IOCTL_STORAGE_QUERY_PROPERTY,
            STORAGE_DEVICE_DESCRIPTOR, STORAGE_PROPERTY_QUERY,
        },
        SystemServices::{
            ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE, FILE_PERSISTENT_ACLS,
            FILE_READ_ONLY_VOLUME,
        },
        Threading::{GetCurrentProcess, GetCurrentThread, OpenProcessToken, OpenThreadToken},
        WindowsProgramming::DRIVE_FIXED,
        IO::DeviceIoControl,
    },
};

const NATIVE_SOURCE_RELATIVE: &str =
    "native\\windows-runtime-attestation\\approved\\windows_runtime_attestation.node";
const MAX_PATH_CHARS: usize = 32_760;
const MAX_TOKEN_BYTES: usize = 65_536;

const WRITE_RIGHTS: u32 = FILE_WRITE_DATA
    | FILE_APPEND_DATA
    | FILE_WRITE_EA
    | FILE_WRITE_ATTRIBUTES
    | FILE_DELETE_CHILD
    | DELETE
    | WRITE_DAC
    | WRITE_OWNER
    | GENERIC_WRITE
    | GENERIC_ALL;
// FILE_APPEND_DATA is FILE_ADD_SUBDIRECTORY on a directory. Other accounts
// may add a sibling on an ancestor, but must not replace this existing child.
const ANCESTOR_REPLACEMENT_RIGHTS: u32 = WRITE_RIGHTS & !FILE_APPEND_DATA;
// A private-state directory must not expose its own entries/metadata, and an
// inheritable ACE must not grant those rights to future token or session files.
const PRIVATE_READ_RIGHTS: u32 = FILE_READ_DATA
    | FILE_READ_EA
    | FILE_READ_ATTRIBUTES
    | FILE_TRAVERSE
    | READ_CONTROL
    | GENERIC_READ
    | GENERIC_EXECUTE;
const PRIVATE_STATE_FORBIDDEN_RIGHTS: u32 = WRITE_RIGHTS | PRIVATE_READ_RIGHTS;
const MAX_EXISTING_PRIVATE_OBJECTS: usize = 256;

pub struct WindowsNativeSourceGuard {
    // OwnedHandle is non-inheritable: Node reads the path while the parent
    // keeps every no-share-delete handle open until that child has exited.
    _handles: Vec<OwnedHandle>,
}

impl WindowsNativeSourceGuard {
    pub fn acquire(core_root: &Path) -> io::Result<Self> {
        let source = core_root.join(NATIVE_SOURCE_RELATIVE);
        let prefixes = local_drive_prefixes(&source)?;
        verify_fixed_local_device(&prefixes[0])?;
        let trusted = TrustedSids::new()?;
        let mut handles = Vec::with_capacity(prefixes.len());
        let mut volume_serial = None;

        for (index, prefix) in prefixes.iter().enumerate() {
            let final_file = index + 1 == prefixes.len();
            let share = if final_file {
                FILE_SHARE_READ
            } else {
                FILE_SHARE_READ | FILE_SHARE_WRITE
            };
            // Not sharing DELETE prevents another SID from renaming/replacing
            // any opened component. Not sharing WRITE on the PE prevents an
            // already-open writer and blocks a new writer until child exit.
            let access =
                READ_CONTROL | FILE_READ_ATTRIBUTES | if final_file { FILE_READ_DATA } else { 0 };
            let handle = open_existing(prefix, access, share)?;
            let (attributes, id) = object_identity(&handle)?;
            if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || (attributes & FILE_ATTRIBUTE_DIRECTORY != 0) == final_file
            {
                return Err(denied("native_source_object_invalid"));
            }
            verify_restricted_dacl(&handle, &trusted, final_file, false)?;
            verify_ntfs(&handle)?;
            if let Some(previous) = volume_serial {
                if previous != id.VolumeSerialNumber {
                    return Err(denied("native_source_volume_changed"));
                }
            }
            volume_serial = Some(id.VolumeSerialNumber);
            verify_final_path(&handle, prefix)?;
            handles.push(handle);
        }
        Ok(Self { _handles: handles })
    }
}

/// Optional paths may be absent before the server creates them. An existing
/// object must be inspected through its opened handle, including broken
/// symlinks, and must live on the same verified NTFS volume as the state root.
fn inspect_private_existing(
    path: &Path,
    directory: bool,
    volume_serial: u64,
    trusted: &TrustedSids,
) -> io::Result<Option<OwnedHandle>> {
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(denied("private_state_entry_unreadable")),
    }
    let prefixes = local_drive_prefixes(path)?;
    let prefix = prefixes
        .last()
        .ok_or_else(|| denied("private_state_entry_invalid"))?;
    let probed_id = if directory {
        // A short exclusive probe rejects stale write/delete handles that
        // might predate a previously tightened ACL. The verified private
        // parent prevents another SID from reopening one after it closes.
        // A metadata-only open does not reliably participate in NT share
        // checks. Include directory read data so an earlier writer conflicts.
        let probe = open_existing(
            prefix,
            READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_READ_DATA,
            FILE_SHARE_READ,
        )?;
        let (attributes, id) = object_identity(&probe)?;
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attributes & FILE_ATTRIBUTE_DIRECTORY == 0
            || id.VolumeSerialNumber != volume_serial
        {
            return Err(denied("private_state_entry_invalid"));
        }
        verify_restricted_dacl(&probe, trusted, false, true)?;
        verify_ntfs(&probe)?;
        verify_final_path(&probe, prefix)?;
        Some(id)
    } else {
        None
    };
    // Directories below the fixed root must allow teacher-created children.
    // Files are immutable or atomically replaced by the teacher: no WRITE
    // sharing detects pre-existing writers and prevents in-place mutation,
    // while DELETE sharing preserves config/stop CAS and staging cleanup.
    // Parent DACLs prevent another SID from creating a replacement. This
    // does not defend against a malicious process running as the same user.
    let share = if directory {
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
    } else {
        FILE_SHARE_READ | FILE_SHARE_DELETE
    };
    let handle = open_existing(
        prefix,
        READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_READ_DATA,
        share,
    )?;
    let (attributes, id) = object_identity(&handle)?;
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || (attributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
        || id.VolumeSerialNumber != volume_serial
        || probed_id.is_some_and(|previous| !same_file_id(&previous, &id))
    {
        return Err(denied("private_state_entry_invalid"));
    }
    verify_restricted_dacl(&handle, trusted, false, true)?;
    verify_ntfs(&handle)?;
    verify_final_path(&handle, prefix)?;
    Ok(Some(handle))
}

fn same_file_id(left: &FILE_ID_INFO, right: &FILE_ID_INFO) -> bool {
    left.VolumeSerialNumber == right.VolumeSerialNumber
        && left.FileId.Identifier == right.FileId.Identifier
}

fn bounded_entries(directory: &Path, budget: &mut usize) -> io::Result<Vec<std::path::PathBuf>> {
    let entries =
        fs::read_dir(directory).map_err(|_| denied("private_state_entries_unreadable"))?;
    let mut paths = Vec::new();
    for entry in entries {
        if *budget == 0 {
            return Err(denied("private_state_entries_unbounded"));
        }
        *budget -= 1;
        let entry = entry.map_err(|_| denied("private_state_entries_unreadable"))?;
        paths.push(entry.path());
    }
    Ok(paths)
}

fn inspect_existing_private_contents(
    state_root: &Path,
    volume_serial: u64,
    trusted: &TrustedSids,
    handles: &mut Vec<OwnedHandle>,
) -> io::Result<()> {
    let mut budget = MAX_EXISTING_PRIVATE_OBJECTS;
    for name in [
        "edupi-proactivity.json",
        "edupi-proactivity-stop.json",
        "edupi-ambient-message-ledger.json",
        "mobile-pairings.json",
        "updater-proxy.json",
    ] {
        if let Some(handle) =
            inspect_private_existing(&state_root.join(name), false, volume_serial, trusted)?
        {
            handles.push(handle);
        }
    }
    // Interrupted atomic ledger writes may still contain owner/message
    // bindings. Inspect them before the Core child can read this state root.
    for path in bounded_entries(state_root, &mut budget)? {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if name.starts_with(".edupi-ambient-message-ledger.") && name.ends_with(".tmp") {
            let file = inspect_private_existing(&path, false, volume_serial, trusted)?
                .ok_or_else(|| denied("private_state_entry_changed"))?;
            handles.push(file);
        }
    }

    // The owner credential is <hash>.key. Inspect every existing entry,
    // including interrupted .tmp writes, so a stale secret cannot hide
    // behind a different filename. Unknown nested directories fail closed.
    let owner_dir = state_root.join("edupi-owner-control");
    if let Some(handle) = inspect_private_existing(&owner_dir, true, volume_serial, trusted)? {
        handles.push(handle);
        for path in bounded_entries(&owner_dir, &mut budget)? {
            let file = inspect_private_existing(&path, false, volume_serial, trusted)?
                .ok_or_else(|| denied("private_state_entry_changed"))?;
            handles.push(file);
        }
    }

    // Materials are bounded to one known nesting level: material-staging /
    // stg_* (or interrupted .pending-stg_*) / files. Do not read content or
    // enumerate arbitrary descendants. Unexpected depth or >256 objects
    // fails closed rather than silently omitting private material.
    let staging_root = state_root.join("material-staging");
    if let Some(handle) = inspect_private_existing(&staging_root, true, volume_serial, trusted)? {
        handles.push(handle);
        for staged_dir in bounded_entries(&staging_root, &mut budget)? {
            let directory = inspect_private_existing(&staged_dir, true, volume_serial, trusted)?
                .ok_or_else(|| denied("private_state_entry_changed"))?;
            handles.push(directory);
            for path in bounded_entries(&staged_dir, &mut budget)? {
                let file = inspect_private_existing(&path, false, volume_serial, trusted)?
                    .ok_or_else(|| denied("private_state_entry_changed"))?;
                handles.push(file);
            }
        }
    }
    Ok(())
}

/// Read-only proof for the already-created app-config/route1-isolated/canary
/// tree. Unlike the PE source guard, the last two directories also reject
/// untrusted read ACEs, including inherit-only ACEs that would reach future
/// token files. Existing owner-control keys, activation files and bounded
/// staged materials are checked separately. Every fixed ancestor is held
/// without FILE_SHARE_DELETE and rejects untrusted replacement rights;
/// mutable files allow DELETE for teacher CAS, never WRITE sharing. This
/// does not stop a malicious process running as the same teacher SID.
/// The Core child must keep this guard alive.
pub struct WindowsPrivateStateGuard {
    _handles: Vec<OwnedHandle>,
}

impl WindowsPrivateStateGuard {
    pub fn acquire(state_root: &Path) -> io::Result<Self> {
        let name = state_root
            .file_name()
            .and_then(OsStr::to_str)
            .filter(|name| {
                name.starts_with("edupi-route1-canary-")
                    && name.len() > "edupi-route1-canary-".len()
            });
        if name.is_none()
            || state_root.parent().and_then(Path::file_name) != Some(OsStr::new("route1-isolated"))
        {
            return Err(denied("private_state_path_invalid"));
        }
        let prefixes = local_drive_prefixes(state_root)?;
        if prefixes.len() < 3 {
            return Err(denied("private_state_path_invalid"));
        }
        verify_fixed_local_device(&prefixes[0])?;
        let trusted = TrustedSids::new()?;
        let mut handles = Vec::with_capacity(prefixes.len());
        let mut volume_serial = None;

        for (index, prefix) in prefixes.iter().enumerate() {
            let private = index + 2 >= prefixes.len();
            let probed_id = if private {
                let probe = open_existing(
                    prefix,
                    READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_READ_DATA,
                    FILE_SHARE_READ,
                )?;
                let (attributes, id) = object_identity(&probe)?;
                if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                    || attributes & FILE_ATTRIBUTE_DIRECTORY == 0
                {
                    return Err(denied("private_state_object_invalid"));
                }
                verify_restricted_dacl(&probe, &trusted, false, true)?;
                verify_ntfs(&probe)?;
                verify_final_path(&probe, prefix)?;
                Some(id)
            } else {
                None
            };
            let handle = open_existing(
                prefix,
                READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_READ_DATA,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
            )?;
            let (attributes, id) = object_identity(&handle)?;
            if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || attributes & FILE_ATTRIBUTE_DIRECTORY == 0
                || probed_id.is_some_and(|previous| !same_file_id(&previous, &id))
            {
                return Err(denied("private_state_object_invalid"));
            }
            verify_restricted_dacl(&handle, &trusted, false, private)?;
            verify_ntfs(&handle)?;
            if let Some(previous) = volume_serial {
                if previous != id.VolumeSerialNumber {
                    return Err(denied("private_state_volume_changed"));
                }
            }
            volume_serial = Some(id.VolumeSerialNumber);
            verify_final_path(&handle, prefix)?;
            handles.push(handle);
        }
        let serial = volume_serial.ok_or_else(|| denied("private_state_volume_invalid"))?;
        inspect_existing_private_contents(state_root, serial, &trusted, &mut handles)?;
        Ok(Self { _handles: handles })
    }
}

fn denied(code: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, code)
}

fn wide_null(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn local_drive_prefixes(path: &Path) -> io::Result<Vec<Vec<u16>>> {
    let chars: Vec<u16> = path.as_os_str().encode_wide().collect();
    if chars.len() < 3 || chars.len() > MAX_PATH_CHARS {
        return Err(denied("native_source_path_invalid"));
    }
    let drive = chars[0];
    if !((b'A' as u16..=b'Z' as u16).contains(&drive)
        || (b'a' as u16..=b'z' as u16).contains(&drive))
        || chars[1] != b':' as u16
        || chars[2] != b'\\' as u16
    {
        return Err(denied("native_source_path_invalid"));
    }
    if chars.len() > 3 && chars.last() == Some(&(b'\\' as u16)) {
        return Err(denied("native_source_path_invalid"));
    }
    let drive = if (b'a' as u16..=b'z' as u16).contains(&drive) {
        drive - 32
    } else {
        drive
    };
    let mut cursor = vec![drive, b':' as u16, b'\\' as u16];
    let mut prefixes = vec![cursor.clone()];
    let mut start = 3;
    while start < chars.len() {
        let end = chars[start..]
            .iter()
            .position(|ch| *ch == b'\\' as u16)
            .map_or(chars.len(), |relative| start + relative);
        let part = &chars[start..end];
        if part.is_empty()
            || part == [b'.' as u16]
            || part == [b'.' as u16, b'.' as u16]
            || matches!(part.last(), Some(ch) if *ch == b'.' as u16 || *ch == b' ' as u16)
            || part
                .iter()
                .any(|ch| *ch < 32 || matches!(*ch, 34 | 42 | 47 | 58 | 60 | 62 | 63 | 124))
        {
            return Err(denied("native_source_path_invalid"));
        }
        if cursor.len() > 3 {
            cursor.push(b'\\' as u16);
        }
        cursor.extend_from_slice(part);
        prefixes.push(cursor.clone());
        start = end + 1;
    }
    Ok(prefixes)
}

fn open_existing(path: &[u16], access: u32, share: u32) -> io::Result<OwnedHandle> {
    let mut name = path.to_vec();
    name.push(0);
    // SAFETY: name is NUL-terminated; CreateFileW returns an owned handle.
    let raw = unsafe {
        CreateFileW(
            name.as_ptr(),
            access,
            share,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE || raw.is_null() {
        return Err(denied("native_source_open_failed"));
    }
    // SAFETY: valid unique Win32 HANDLE, not inherited or used elsewhere.
    Ok(unsafe { OwnedHandle::from_raw_handle(raw.cast()) })
}

fn object_identity(handle: &OwnedHandle) -> io::Result<(u32, FILE_ID_INFO)> {
    let raw = handle.as_raw_handle().cast();
    let mut tag = FILE_ATTRIBUTE_TAG_INFO::default();
    let mut id = FILE_ID_INFO::default();
    // SAFETY: output structs have the exact Win32 layouts and valid lengths.
    if unsafe {
        GetFileInformationByHandleEx(
            raw,
            FileAttributeTagInfo,
            (&raw mut tag).cast(),
            size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    } == 0
        || unsafe {
            GetFileInformationByHandleEx(
                raw,
                FileIdInfo,
                (&raw mut id).cast(),
                size_of::<FILE_ID_INFO>() as u32,
            )
        } == 0
    {
        return Err(denied("native_source_identity_failed"));
    }
    Ok((tag.FileAttributes, id))
}

fn verify_final_path(handle: &OwnedHandle, expected: &[u16]) -> io::Result<()> {
    let mut final_path = vec![0u16; 32_768];
    // SAFETY: buffer is writable for its declared length.
    let length = unsafe {
        GetFinalPathNameByHandleW(
            handle.as_raw_handle().cast(),
            final_path.as_mut_ptr(),
            final_path.len() as u32,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    } as usize;
    let mut expected_final = vec![b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    expected_final.extend_from_slice(expected);
    if length == 0 || length >= final_path.len() || length != expected_final.len() {
        return Err(denied("native_source_path_mismatch"));
    }
    // SAFETY: both buffers are valid for their exact explicit lengths.
    if unsafe {
        CompareStringOrdinal(
            final_path.as_ptr(),
            length as i32,
            expected_final.as_ptr(),
            expected_final.len() as i32,
            1,
        )
    } != CSTR_EQUAL
    {
        return Err(denied("native_source_path_mismatch"));
    }
    Ok(())
}

fn verify_ntfs(handle: &OwnedHandle) -> io::Result<()> {
    let mut fs_name = [0u16; 32];
    let mut flags = 0u32;
    // SAFETY: the output pointers and capacities are valid.
    if unsafe {
        GetVolumeInformationByHandleW(
            handle.as_raw_handle().cast(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            &raw mut flags,
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    } == 0
        || flags & FILE_PERSISTENT_ACLS == 0
        || flags & FILE_READ_ONLY_VOLUME != 0
        || fs_name[4] != 0
    {
        return Err(denied("native_source_filesystem_invalid"));
    }
    let ntfs = [b'N' as u16, b'T' as u16, b'F' as u16, b'S' as u16];
    // SAFETY: both spans contain four UTF-16 units.
    if unsafe { CompareStringOrdinal(fs_name.as_ptr(), 4, ntfs.as_ptr(), 4, 1) } != CSTR_EQUAL {
        return Err(denied("native_source_filesystem_invalid"));
    }
    Ok(())
}

fn verify_fixed_local_device(drive_root: &[u16]) -> io::Result<()> {
    let mut drive = drive_root.to_vec();
    drive.push(0);
    // SAFETY: drive is NUL-terminated.
    if unsafe { GetDriveTypeW(drive.as_ptr()) } != DRIVE_FIXED {
        return Err(denied("native_source_drive_invalid"));
    }
    let volume = [
        b'\\' as u16,
        b'\\' as u16,
        b'.' as u16,
        b'\\' as u16,
        drive_root[0],
        b':' as u16,
        0,
    ];
    // SAFETY: volume is NUL-terminated; valid handle transferred to OwnedHandle.
    let raw = unsafe {
        CreateFileW(
            volume.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE || raw.is_null() {
        return Err(denied("native_source_volume_open_failed"));
    }
    // SAFETY: unique valid volume handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let query = STORAGE_PROPERTY_QUERY {
        PropertyId: StorageDeviceProperty,
        QueryType: PropertyStandardQuery,
        AdditionalParameters: [0],
    };
    // u64 backing keeps STORAGE_DEVICE_DESCRIPTOR suitably aligned.
    let mut result = [0u64; 512];
    let mut returned = 0u32;
    // SAFETY: all input/output buffers are valid and length-matched.
    if unsafe {
        DeviceIoControl(
            handle.as_raw_handle().cast(),
            IOCTL_STORAGE_QUERY_PROPERTY,
            (&raw const query).cast(),
            size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            result.as_mut_ptr().cast(),
            size_of::<[u64; 512]>() as u32,
            &raw mut returned,
            null_mut(),
        )
    } == 0
        || (returned as usize) < offset_of!(STORAGE_DEVICE_DESCRIPTOR, RawDeviceProperties)
    {
        return Err(denied("native_source_device_query_failed"));
    }
    // SAFETY: output size was validated; the buffer is aligned and initialized.
    let descriptor = unsafe { &*(result.as_ptr().cast::<STORAGE_DEVICE_DESCRIPTOR>()) };
    if descriptor.Size > returned || descriptor.RemovableMedia {
        return Err(denied("native_source_media_invalid"));
    }
    if !matches!(
        descriptor.BusType,
        BusTypeScsi | BusTypeAta | BusTypeRAID | BusTypeSas | BusTypeSata | BusTypeNvme
    ) {
        return Err(denied("native_source_bus_invalid"));
    }
    Ok(())
}

fn current_user_sid() -> io::Result<Vec<usize>> {
    let mut thread_token: HANDLE = null_mut();
    // A thread impersonation token would make the process user SID ambiguous.
    // SAFETY: output pointer is valid; pseudo-handle is supplied by Windows.
    if unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &raw mut thread_token) } != 0 {
        // SAFETY: successful OpenThreadToken returned an owned HANDLE.
        drop(unsafe { OwnedHandle::from_raw_handle(thread_token.cast()) });
        return Err(denied("native_source_impersonation_token"));
    }
    // SAFETY: reads thread-local last-error immediately after the failed call.
    if unsafe { GetLastError() } != ERROR_NO_TOKEN {
        return Err(denied("native_source_token_failed"));
    }
    let mut process_token: HANDLE = null_mut();
    // SAFETY: output pointer is valid; pseudo-handle is supplied by Windows.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut process_token) } == 0 {
        return Err(denied("native_source_token_failed"));
    }
    // SAFETY: successful OpenProcessToken returned an owned HANDLE.
    let token = unsafe { OwnedHandle::from_raw_handle(process_token.cast()) };
    let mut length = 0u32;
    // SAFETY: the initial zero-length query asks Windows for the buffer size.
    unsafe {
        GetTokenInformation(
            token.as_raw_handle().cast(),
            TokenUser,
            null_mut(),
            0,
            &raw mut length,
        )
    };
    // SAFETY: immediately retrieves last-error from the size query.
    if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER
        || length < size_of::<TOKEN_USER>() as u32
        || length as usize > MAX_TOKEN_BYTES
    {
        return Err(denied("native_source_token_failed"));
    }
    let words = (length as usize).div_ceil(size_of::<usize>());
    let mut data = vec![0usize; words];
    // SAFETY: word buffer is aligned for TOKEN_USER and has `length` bytes.
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle().cast(),
            TokenUser,
            data.as_mut_ptr().cast(),
            length,
            &raw mut length,
        )
    } == 0
        || length < size_of::<TOKEN_USER>() as u32
    {
        return Err(denied("native_source_token_failed"));
    }
    // SAFETY: successful TokenUser query initialized the buffer.
    let sid = unsafe { (*(data.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    // SAFETY: SID pointer is part of the returned token buffer.
    if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
        return Err(denied("native_source_token_failed"));
    }
    Ok(data)
}

fn well_known_sid(kind: i32) -> io::Result<Vec<usize>> {
    let mut data = vec![0usize; (SECURITY_MAX_SID_SIZE as usize).div_ceil(size_of::<usize>())];
    let mut length = SECURITY_MAX_SID_SIZE;
    // SAFETY: aligned writable buffer is at least SECURITY_MAX_SID_SIZE.
    if unsafe { CreateWellKnownSid(kind, null_mut(), data.as_mut_ptr().cast(), &raw mut length) }
        == 0
    {
        return Err(denied("native_source_sid_failed"));
    }
    Ok(data)
}

fn trusted_installer_sid() -> Option<Vec<usize>> {
    let account = wide_null(OsStr::new("NT SERVICE\\TrustedInstaller"));
    let mut sid_length = 0u32;
    let mut domain_length = 0u32;
    let mut use_type: SID_NAME_USE = 0;
    // SAFETY: first call requests the exact SID/domain buffer lengths.
    unsafe {
        LookupAccountNameW(
            null(),
            account.as_ptr(),
            null_mut(),
            &raw mut sid_length,
            null_mut(),
            &raw mut domain_length,
            &raw mut use_type,
        )
    };
    // SAFETY: reads the error from the immediately preceding lookup.
    if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER
        || sid_length == 0
        || sid_length > MAX_TOKEN_BYTES as u32
        || domain_length > 32_768
    {
        return None;
    }
    let mut sid = vec![0usize; (sid_length as usize).div_ceil(size_of::<usize>())];
    let mut domain = vec![0u16; domain_length as usize + 1];
    // SAFETY: both buffers have the advertised sizes and are writable.
    if unsafe {
        LookupAccountNameW(
            null(),
            account.as_ptr(),
            sid.as_mut_ptr().cast(),
            &raw mut sid_length,
            domain.as_mut_ptr(),
            &raw mut domain_length,
            &raw mut use_type,
        )
    } == 0
        || unsafe { IsValidSid(sid.as_mut_ptr().cast()) } == 0
    {
        return None;
    }
    Some(sid)
}

struct TrustedSids {
    user: Vec<usize>,
    system: Vec<usize>,
    admins: Vec<usize>,
    installer: Option<Vec<usize>>,
}

impl TrustedSids {
    fn new() -> io::Result<Self> {
        Ok(Self {
            user: current_user_sid()?,
            system: well_known_sid(WinLocalSystemSid)?,
            admins: well_known_sid(WinBuiltinAdministratorsSid)?,
            installer: trusted_installer_sid(),
        })
    }

    fn contains(&self, sid: PSID) -> bool {
        if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
            return false;
        }
        let user = unsafe { (*(self.user.as_ptr().cast::<TOKEN_USER>())).User.Sid };
        let always_trusted: [PSID; 3] = [
            user,
            self.system.as_ptr().cast_mut().cast(),
            self.admins.as_ptr().cast_mut().cast(),
        ];
        always_trusted
            .into_iter()
            .chain(
                self.installer
                    .as_ref()
                    .map(|data| data.as_ptr().cast_mut().cast()),
            )
            .any(|candidate| unsafe { EqualSid(sid, candidate) } != 0)
    }

    fn contains_private(&self, sid: PSID) -> bool {
        if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
            return false;
        }
        let user = unsafe { (*(self.user.as_ptr().cast::<TOKEN_USER>())).User.Sid };
        let private_trusted: [PSID; 3] = [
            user,
            self.system.as_ptr().cast_mut().cast(),
            self.admins.as_ptr().cast_mut().cast(),
        ];
        private_trusted
            .into_iter()
            .any(|candidate| unsafe { EqualSid(sid, candidate) } != 0)
    }
}

struct LocalDescriptor(*mut c_void);

impl Drop for LocalDescriptor {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: GetSecurityInfo returns a LocalFree-owned descriptor.
            unsafe { LocalFree(self.0) };
        }
    }
}

fn verify_restricted_dacl(
    handle: &OwnedHandle,
    trusted: &TrustedSids,
    target: bool,
    private: bool,
) -> io::Result<()> {
    let invalid = || {
        denied(if private {
            "private_state_acl_untrusted"
        } else {
            "native_source_acl_untrusted"
        })
    };
    let unreadable = || {
        denied(if private {
            "private_state_acl_unreadable"
        } else {
            "native_source_acl_unreadable"
        })
    };
    let mut owner: PSID = null_mut();
    let mut dacl: *mut ACL = null_mut();
    let mut raw_descriptor = null_mut();
    // SAFETY: handle is live and all out-pointers are valid. Descriptor is
    // immediately wrapped so every failure path releases its allocation.
    let status = unsafe {
        GetSecurityInfo(
            handle.as_raw_handle().cast(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &raw mut owner,
            null_mut(),
            &raw mut dacl,
            null_mut(),
            &raw mut raw_descriptor,
        )
    };
    let descriptor = LocalDescriptor(raw_descriptor);
    if status != 0 || descriptor.0.is_null() {
        return Err(unreadable());
    }
    let mut dacl_present = 0;
    let mut dacl_defaulted = 0;
    let mut checked_dacl: *mut ACL = null_mut();
    // SAFETY: descriptor remains live; output pointers are valid.
    if unsafe {
        GetSecurityDescriptorDacl(
            descriptor.0,
            &raw mut dacl_present,
            &raw mut checked_dacl,
            &raw mut dacl_defaulted,
        )
    } == 0
        || dacl_present == 0
        || checked_dacl.is_null()
        || checked_dacl != dacl
        || if private {
            !trusted.contains_private(owner)
        } else {
            !trusted.contains(owner)
        }
    {
        return Err(invalid());
    }
    let mut info = ACL_SIZE_INFORMATION::default();
    // SAFETY: dacl is part of the still-live descriptor; output struct valid.
    if unsafe { IsValidAcl(dacl) } == 0
        || unsafe {
            GetAclInformation(
                dacl,
                (&raw mut info).cast(),
                size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            )
        } == 0
    {
        return Err(invalid());
    }
    for index in 0..info.AceCount {
        let mut raw_ace: *mut c_void = null_mut();
        // SAFETY: index is within the count supplied by GetAclInformation.
        if unsafe { GetAce(dacl, index, &raw mut raw_ace) } == 0 || raw_ace.is_null() {
            return Err(invalid());
        }
        // SAFETY: GetAce supplies an ACE_HEADER within the valid ACL.
        let header = unsafe { &*(raw_ace.cast::<ACE_HEADER>()) };
        if header.AceType as u32 == ACCESS_DENIED_ACE_TYPE {
            continue;
        }
        if header.AceType as u32 != ACCESS_ALLOWED_ACE_TYPE
            || (header.AceSize as usize) < size_of::<ACCESS_ALLOWED_ACE>()
        {
            return Err(invalid());
        }
        // SAFETY: the prior size check covers the fixed ACCESS_ALLOWED_ACE.
        let ace = unsafe { &*(raw_ace.cast::<ACCESS_ALLOWED_ACE>()) };
        let sid_offset = offset_of!(ACCESS_ALLOWED_ACE, SidStart);
        let sid_available = header.AceSize as usize - sid_offset;
        let sid = (&raw const ace.SidStart).cast_mut().cast();
        // SID header is eight bytes and SubAuthorityCount determines length.
        // Bound it before calling Windows SID validators on an untrusted ACL.
        if sid_available < 8 {
            return Err(invalid());
        }
        // SAFETY: the SidStart address points to at least eight ACE bytes.
        let count = unsafe { *((sid as *const u8).add(1)) } as usize;
        if 8 + count * 4 > sid_available
            || unsafe { IsValidSid(sid) } == 0
            || unsafe { GetLengthSid(sid) } as usize > sid_available
        {
            return Err(invalid());
        }
        let trusted_sid = if private {
            trusted.contains_private(sid)
        } else {
            trusted.contains(sid)
        };
        let forbidden = if private {
            PRIVATE_STATE_FORBIDDEN_RIGHTS
        } else if target {
            WRITE_RIGHTS
        } else {
            ANCESTOR_REPLACEMENT_RIGHTS
        };
        if header.AceFlags as u32 & INHERIT_ONLY_ACE != 0 {
            // Private directories may later create token files. A broad
            // inherit-only ACE is therefore unsafe even when not effective
            // on this directory itself. CREATOR_OWNER maps to the trusted
            // owner because untrusted principals cannot create children.
            if private
                && ace.Mask & forbidden != 0
                && !trusted_sid
                && unsafe { IsWellKnownSid(sid, WinCreatorOwnerSid) } == 0
            {
                return Err(denied("private_state_inherited_acl_untrusted"));
            }
            continue;
        }
        if ace.Mask & forbidden != 0 && !trusted_sid {
            return Err(invalid());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn system32_tool(name: &str) -> io::Result<std::path::PathBuf> {
        let root = std::env::var_os("SystemRoot")
            .ok_or_else(|| denied("fixture_system_root_unavailable"))?;
        let tool = std::path::PathBuf::from(root).join("System32").join(name);
        if !tool.is_file() {
            return Err(denied("fixture_system_tool_unavailable"));
        }
        Ok(tool)
    }

    fn sid_from_whoami_csv(value: &str) -> io::Result<&str> {
        let start = value
            .find("S-1-")
            .ok_or_else(|| denied("fixture_sid_unavailable"))?;
        let sid = value[start..]
            .split(|ch: char| !(ch == 'S' || ch == '-' || ch.is_ascii_digit()))
            .next()
            .unwrap_or("");
        if sid.len() <= "S-1-".len() {
            return Err(denied("fixture_sid_unavailable"));
        }
        Ok(sid)
    }

    #[test]
    fn extracts_sid_without_csv_quotes_or_crlf() {
        assert_eq!(
            sid_from_whoami_csv("\"runner\",\"S-1-5-21-1234\"\r\n").unwrap(),
            "S-1-5-21-1234"
        );
    }

    #[test]
    fn rejects_noncanonical_source_spellings() {
        for source in [
            "relative",
            "\\\\server\\share",
            "\\\\?\\C:\\root",
            "C:relative",
            "C:\\root\\.",
            "C:\\root\\..",
            "C:\\root\\x ",
            "C:\\root\\x:stream",
            "C:\\root\\x/y",
            "C:\\root\\x\\",
        ] {
            assert!(local_drive_prefixes(Path::new(source)).is_err(), "{source}");
        }
        assert_eq!(
            local_drive_prefixes(Path::new("c:\\root\\asset.node"))
                .unwrap()
                .len(),
            3
        );
    }

    fn isolated_root_with_bytes(source: Option<&Path>) -> io::Result<std::path::PathBuf> {
        let sid_output = Command::new(system32_tool("whoami.exe")?)
            .args(["/user", "/fo", "csv", "/nh"])
            .output()?;
        if !sid_output.status.success() {
            return Err(denied("fixture_sid_unavailable"));
        }
        let text = String::from_utf8_lossy(&sid_output.stdout);
        let sid = sid_from_whoami_csv(&text)?;
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos();
        let parent = std::env::var_os("USERPROFILE")
            .map(std::path::PathBuf::from)
            .ok_or_else(|| denied("fixture_user_profile_unavailable"))?;
        let mut last_error = None;
        for index in 0..2 {
            let root = parent.join(format!(
                "edupi-source-guard-{}-{suffix}-{index}",
                std::process::id()
            ));
            if let Err(error) = fs::create_dir(&root) {
                last_error = Some(error);
                continue;
            }
            let prepared = (|| {
                let output = Command::new(system32_tool("icacls.exe")?)
                    .arg(&root)
                    .args(["/inheritance:r", "/grant:r"])
                    .arg(format!("*{sid}:(OI)(CI)F"))
                    .arg("*S-1-5-18:(OI)(CI)F")
                    .output()?;
                if !output.status.success() {
                    return Err(denied("fixture_acl_setup_failed"));
                }
                let addon = root.join(NATIVE_SOURCE_RELATIVE);
                fs::create_dir_all(addon.parent().unwrap())?;
                let bytes = match source {
                    Some(file) => fs::read(file)?,
                    None => b"isolated-pe-fixture".to_vec(),
                };
                fs::write(addon, bytes)?;
                WindowsNativeSourceGuard::acquire(&root)?;
                Ok(())
            })();
            if prepared.is_ok() {
                return Ok(root);
            }
            last_error = prepared.err();
            let _ = fs::remove_dir_all(root);
        }
        Err(last_error.unwrap_or_else(|| denied("fixture_no_verified_ntfs_parent")))
    }

    fn isolated_root() -> io::Result<std::path::PathBuf> {
        isolated_root_with_bytes(None)
    }

    fn grant_everyone_write(path: &Path) -> io::Result<()> {
        let output = Command::new(system32_tool("icacls.exe")?)
            .arg(path)
            .args(["/grant", "*S-1-1-0:F"])
            .output()?;
        if !output.status.success() {
            return Err(denied("fixture_acl_weakening_failed"));
        }
        Ok(())
    }

    fn isolated_state_root() -> io::Result<(std::path::PathBuf, std::path::PathBuf)> {
        let fixture_root = isolated_root()?;
        let state = fixture_root
            .join("route1-isolated")
            .join("edupi-route1-canary-fixture");
        let prepared = (|| {
            fs::create_dir_all(&state)?;
            WindowsPrivateStateGuard::acquire(&state)?;
            Ok(())
        })();
        if let Err(error) = prepared {
            let _ = fs::remove_dir_all(&fixture_root);
            return Err(error);
        }
        Ok((fixture_root, state))
    }

    fn grant_everyone(path: &Path, rights: &str) -> io::Result<()> {
        let output = Command::new(system32_tool("icacls.exe")?)
            .arg(path)
            .args(["/grant", rights])
            .output()?;
        if !output.status.success() {
            return Err(denied("fixture_acl_weakening_failed"));
        }
        Ok(())
    }

    fn existing_sensitive_files(
        state: &Path,
    ) -> io::Result<(std::path::PathBuf, std::path::PathBuf)> {
        fs::write(state.join("edupi-proactivity.json"), b"{\"version\":2}")?;
        fs::write(
            state.join("edupi-proactivity-stop.json"),
            b"{\"version\":1}",
        )?;
        fs::write(
            state.join("edupi-ambient-message-ledger.json"),
            b"{\"version\":1}",
        )?;
        fs::write(
            state.join(".edupi-ambient-message-ledger.fixture.tmp"),
            b"{}",
        )?;
        fs::write(state.join("mobile-pairings.json"), b"{}")?;
        fs::write(state.join("updater-proxy.json"), b"{}")?;
        let owner_dir = state.join("edupi-owner-control");
        fs::create_dir(&owner_dir)?;
        let key = owner_dir.join("00000000000000000000000000000000.key");
        fs::write(&key, b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")?;
        let staged_dir = state.join("material-staging/stg_00000000000000000000000000000000");
        fs::create_dir_all(&staged_dir)?;
        let material = staged_dir.join("material.pdf");
        fs::write(&material, b"%PDF-isolated-material")?;
        fs::write(staged_dir.join("descriptor.json"), b"{}")?;
        Ok((key, material))
    }

    #[test]
    fn existing_sensitive_files_are_guarded_without_breaking_atomic_update() -> io::Result<()> {
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            let (key, material) = existing_sensitive_files(&state)?;
            let guard = WindowsPrivateStateGuard::acquire(&state)?;
            assert!(key.is_file());
            assert!(fs::OpenOptions::new().write(true).open(&key).is_err());
            // The old file handle permits DELETE but not WRITE: a teacher
            // can atomically replace config and remove a settled material.
            let next = state.join(".edupi-proactivity-next.tmp");
            fs::write(&next, b"{\"version\":2,\"next\":true}")?;
            fs::rename(&next, state.join("edupi-proactivity.json"))?;
            let newly_inherited = inspect_private_existing(
                &state.join("edupi-proactivity.json"),
                false,
                object_identity(&guard._handles[0])?.1.VolumeSerialNumber,
                &TrustedSids::new()?,
            )?;
            assert!(newly_inherited.is_some());
            fs::remove_file(&material)?;
            fs::remove_file(state.join("edupi-proactivity-stop.json"))?;
            drop(guard);
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)
    }

    #[test]
    fn rejects_existing_sensitive_file_with_explicit_everyone_acl() -> io::Result<()> {
        for case in 0..8 {
            let (fixture_root, state) = isolated_state_root()?;
            let result = (|| {
                let (key, material) = existing_sensitive_files(&state)?;
                let path = match case {
                    0 => state.join("edupi-proactivity.json"),
                    1 => state.join("edupi-proactivity-stop.json"),
                    2 => state.join("edupi-ambient-message-ledger.json"),
                    3 => state.join(".edupi-ambient-message-ledger.fixture.tmp"),
                    4 => state.join("mobile-pairings.json"),
                    5 => state.join("updater-proxy.json"),
                    6 => key,
                    _ => material,
                };
                let permission = if case == 1 {
                    "*S-1-1-0:W"
                } else {
                    "*S-1-1-0:R"
                };
                grant_everyone(&path, permission)?;
                assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
                Ok(())
            })();
            let cleanup = fs::remove_dir_all(&fixture_root);
            result.and(cleanup)?;
        }
        Ok(())
    }

    #[test]
    fn rejects_stale_writer_handles_before_holding_mutable_private_state() -> io::Result<()> {
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            existing_sensitive_files(&state)?;
            let config = state.join("edupi-proactivity.json");
            let config_path = local_drive_prefixes(&config)?;
            let writer = open_existing(
                config_path.last().unwrap(),
                FILE_WRITE_DATA,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            )?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            drop(writer);
            WindowsPrivateStateGuard::acquire(&state)?;

            let owner_dir = state.join("edupi-owner-control");
            let owner_path = local_drive_prefixes(&owner_dir)?;
            let writer = open_existing(
                owner_path.last().unwrap(),
                FILE_WRITE_DATA,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            )?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            drop(writer);
            WindowsPrivateStateGuard::acquire(&state)?;
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)
    }

    #[test]
    fn rejects_existing_owner_directory_and_broken_config_symlink() -> io::Result<()> {
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            existing_sensitive_files(&state)?;
            grant_everyone(&state.join("edupi-owner-control"), "*S-1-1-0:R")?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)?;

        use std::os::windows::fs::symlink_file;
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            symlink_file(
                state.join("nonexistent-config-target"),
                state.join("edupi-proactivity.json"),
            )?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)
    }

    #[test]
    fn private_state_requires_the_exact_route1_canary_shape() {
        for path in [
            "C:\\AppData\\other\\edupi-route1-canary-one",
            "C:\\AppData\\route1-isolated\\teacher-data",
            "C:\\AppData\\route1-isolated\\edupi-route1-canary-",
            "C:\\AppData\\route1-isolated\\..\\edupi-route1-canary-one",
        ] {
            assert!(WindowsPrivateStateGuard::acquire(Path::new(path)).is_err());
        }
    }

    #[test]
    fn protected_private_state_and_inherited_token_stay_restricted() -> io::Result<()> {
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            let guard = WindowsPrivateStateGuard::acquire(&state)?;
            let token = state.join("token-fixture.json");
            fs::write(&token, b"isolated-token-fixture")?;
            let token_path = local_drive_prefixes(&token)?;
            let token_handle = open_existing(
                token_path.last().unwrap(),
                READ_CONTROL | FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
            )?;
            verify_restricted_dacl(&token_handle, &TrustedSids::new()?, false, true)?;
            drop(guard);
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)
    }

    #[test]
    fn private_state_rejects_everyone_read_on_parent_and_child() -> io::Result<()> {
        for weaken_parent in [true, false] {
            let (fixture_root, state) = isolated_state_root()?;
            let result = (|| {
                let target = if weaken_parent {
                    state.parent().unwrap()
                } else {
                    state.as_path()
                };
                grant_everyone(target, "*S-1-1-0:R")?;
                assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
                Ok(())
            })();
            let cleanup = fs::remove_dir_all(&fixture_root);
            result.and(cleanup)?;
        }
        Ok(())
    }

    #[test]
    fn private_state_rejects_inheritable_everyone_read_and_write() -> io::Result<()> {
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            grant_everyone(&state, "*S-1-1-0:(OI)(CI)(IO)R")?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)?;

        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            grant_everyone(&state, "*S-1-1-0:F")?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)
    }

    #[test]
    fn private_state_rejects_ancestor_delete_child_and_reparse() -> io::Result<()> {
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            grant_everyone(&fixture_root, "*S-1-1-0:(DC)")?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)?;

        use std::os::windows::fs::symlink_dir;
        let (fixture_root, state) = isolated_state_root()?;
        let result = (|| {
            let target = state.with_extension("original");
            fs::rename(&state, &target)?;
            symlink_dir(&target, &state)?;
            assert!(WindowsPrivateStateGuard::acquire(&state).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&fixture_root);
        result.and(cleanup)
    }

    #[test]
    fn protected_source_is_held_and_untrusted_writer_is_rejected() -> io::Result<()> {
        let root = isolated_root()?;
        let addon = root.join(NATIVE_SOURCE_RELATIVE);
        let result = (|| {
            let guard = WindowsNativeSourceGuard::acquire(&root)?;
            // FILE_DELETE_CHILD held by the *same* user can override normal
            // share-delete behavior on some NTFS versions. That user is
            // already a trusted principal; this guard targets other SIDs.
            assert!(fs::OpenOptions::new().write(true).open(&addon).is_err());
            drop(guard);
            grant_everyone_write(&addon)?;
            assert!(WindowsNativeSourceGuard::acquire(&root).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&root);
        result.and(cleanup)
    }

    #[test]
    fn rejects_an_untrusted_writable_ancestor() -> io::Result<()> {
        let root = isolated_root()?;
        let result = (|| {
            let source_dir = root.join("native/windows-runtime-attestation");
            grant_everyone_write(&source_dir)?;
            assert!(WindowsNativeSourceGuard::acquire(&root).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&root);
        result.and(cleanup)
    }

    #[test]
    fn rejects_only_parent_delete_child_permission() -> io::Result<()> {
        let root = isolated_root()?;
        let result = (|| {
            let parent = root.join("native/windows-runtime-attestation");
            let output = Command::new(system32_tool("icacls.exe")?)
                .arg(&parent)
                .args(["/grant", "*S-1-1-0:(DC)"])
                .output()?;
            if !output.status.success() {
                return Err(denied("fixture_delete_child_acl_setup_failed"));
            }
            assert!(WindowsNativeSourceGuard::acquire(&root).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&root);
        result.and(cleanup)
    }

    #[test]
    fn rejects_a_reparse_point_in_the_native_source_chain() -> io::Result<()> {
        use std::os::windows::fs::symlink_file;
        let root = isolated_root()?;
        let result = (|| {
            let addon = root.join(NATIVE_SOURCE_RELATIVE);
            let target = addon.with_extension("original.node");
            fs::rename(&addon, &target)?;
            symlink_file(&target, &addon)?;
            assert!(WindowsNativeSourceGuard::acquire(&root).is_err());
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&root);
        result.and(cleanup)
    }

    #[test]
    #[ignore = "requires an approved native asset path from the scoped Windows probe"]
    fn held_approved_addon_loads_in_node_22() -> io::Result<()> {
        let source = std::env::var_os("EDUPI_NATIVE_ASSET_PROBE_PATH")
            .ok_or_else(|| denied("fixture_approved_asset_unavailable"))?;
        let root = isolated_root_with_bytes(Some(Path::new(&source)))?;
        let result = (|| {
            let addon = root.join(NATIVE_SOURCE_RELATIVE);
            let guard = WindowsNativeSourceGuard::acquire(&root)?;
            let output = Command::new("node.exe")
                .arg("-e")
                .arg("require(process.argv[1]); process.stdout.write('approved-load')")
                .arg(&addon)
                .output()?;
            if !output.status.success() || output.stdout != b"approved-load" {
                return Err(denied("fixture_approved_addon_load_failed"));
            }
            drop(guard);
            Ok(())
        })();
        let cleanup = fs::remove_dir_all(&root);
        result.and(cleanup)
    }
}

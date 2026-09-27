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
    io,
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
        GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
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
        FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
        FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA, FILE_WRITE_EA, OPEN_EXISTING, READ_CONTROL,
        VOLUME_NAME_DOS, WRITE_DAC, WRITE_OWNER,
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
            let handle = open_existing(prefix, READ_CONTROL | FILE_READ_ATTRIBUTES, share)?;
            let (attributes, id) = object_identity(&handle)?;
            if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || (attributes & FILE_ATTRIBUTE_DIRECTORY != 0) == final_file
            {
                return Err(denied("native_source_object_invalid"));
            }
            verify_restricted_dacl(&handle, &trusted, final_file)?;
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
) -> io::Result<()> {
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
        return Err(denied("native_source_acl_unreadable"));
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
        || !trusted.contains(owner)
    {
        return Err(denied("native_source_acl_untrusted"));
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
        return Err(denied("native_source_acl_untrusted"));
    }
    for index in 0..info.AceCount {
        let mut raw_ace: *mut c_void = null_mut();
        // SAFETY: index is within the count supplied by GetAclInformation.
        if unsafe { GetAce(dacl, index, &raw mut raw_ace) } == 0 || raw_ace.is_null() {
            return Err(denied("native_source_acl_untrusted"));
        }
        // SAFETY: GetAce supplies an ACE_HEADER within the valid ACL.
        let header = unsafe { &*(raw_ace.cast::<ACE_HEADER>()) };
        if header.AceType as u32 == ACCESS_DENIED_ACE_TYPE {
            continue;
        }
        if header.AceType as u32 != ACCESS_ALLOWED_ACE_TYPE
            || (header.AceSize as usize) < size_of::<ACCESS_ALLOWED_ACE>()
        {
            return Err(denied("native_source_acl_untrusted"));
        }
        // SAFETY: the prior size check covers the fixed ACCESS_ALLOWED_ACE.
        let ace = unsafe { &*(raw_ace.cast::<ACCESS_ALLOWED_ACE>()) };
        let sid_offset = offset_of!(ACCESS_ALLOWED_ACE, SidStart);
        let sid_available = header.AceSize as usize - sid_offset;
        let sid = (&raw const ace.SidStart).cast_mut().cast();
        // SID header is eight bytes and SubAuthorityCount determines length.
        // Bound it before calling Windows SID validators on an untrusted ACL.
        if sid_available < 8 {
            return Err(denied("native_source_acl_untrusted"));
        }
        // SAFETY: the SidStart address points to at least eight ACE bytes.
        let count = unsafe { *((sid as *const u8).add(1)) } as usize;
        if 8 + count * 4 > sid_available
            || unsafe { IsValidSid(sid) } == 0
            || unsafe { GetLengthSid(sid) } as usize > sid_available
        {
            return Err(denied("native_source_acl_untrusted"));
        }
        if header.AceFlags as u32 & INHERIT_ONLY_ACE != 0 {
            // The final PE is a file; each existing child is inspected on its
            // own handle. No future files are authorized by this guard.
            continue;
        }
        let forbidden = if target {
            WRITE_RIGHTS
        } else {
            ANCESTOR_REPLACEMENT_RIGHTS
        };
        if ace.Mask & forbidden != 0 && !trusted.contains(sid) {
            return Err(denied("native_source_acl_untrusted"));
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

    fn isolated_root() -> io::Result<std::path::PathBuf> {
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
                fs::write(addon, b"isolated-pe-fixture")?;
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
}

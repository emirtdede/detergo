use serde::{Deserialize, Serialize};
use std::fmt;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", content = "message")]
pub enum AppError {
    InvalidPath(String),
    AccessDenied(String),
    PathNotFound(String),
    ScanCancelled(String),
    ScanFailed(String),
    UnsafeDeleteTarget(String),
    RecycleBinFailed(String),
    RecycleBinTooSmall(String),
    RecycleBinDisabled(String),
    RecycleBinNotFound(String),
    RecycleBinPathTooLong(String),
    RecycleBinSharingViolation(String),
    RecycleBinAccessDenied(String),
    RecycleBinAborted(String),
    RecycleBinComFailed(String),
    PermanentDeleteFailed(String),
    SettingsReadFailed(String),
    SettingsWriteFailed(String),
    PlatformUnsupported(String),
    SessionInvalid(String),
    SessionExpired(String),
    PlanInvalid(String),
    PlanExpired(String),
    PlanChanged(String),
    Blocked(String),
    Network(String),
    Unknown(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::InvalidPath(msg) => write!(f, "Invalid path: {}", msg),
            AppError::AccessDenied(msg) => write!(f, "Access denied: {}", msg),
            AppError::PathNotFound(msg) => write!(f, "Path not found: {}", msg),
            AppError::ScanCancelled(msg) => write!(f, "Scan cancelled: {}", msg),
            AppError::ScanFailed(msg) => write!(f, "Scan failed: {}", msg),
            AppError::UnsafeDeleteTarget(msg) => write!(f, "Unsafe delete target: {}", msg),
            AppError::RecycleBinFailed(msg) => write!(f, "Recycle bin operation failed: {}", msg),
            AppError::RecycleBinTooSmall(msg) => {
                write!(
                    f,
                    "Recycle bin capacity is too small for the target: {}",
                    msg
                )
            }
            AppError::RecycleBinDisabled(msg) => {
                write!(f, "Recycle bin is disabled for this drive: {}", msg)
            }
            AppError::RecycleBinNotFound(msg) => write!(f, "Recycle bin not found: {}", msg),
            AppError::RecycleBinPathTooLong(msg) => {
                write!(f, "Path is too long for the recycle bin: {}", msg)
            }
            AppError::RecycleBinSharingViolation(msg) => {
                write!(f, "Recycle bin target is in use: {}", msg)
            }
            AppError::RecycleBinAccessDenied(msg) => {
                write!(f, "Recycle bin access denied: {}", msg)
            }
            AppError::RecycleBinAborted(msg) => {
                write!(f, "Recycle bin operation was aborted: {}", msg)
            }
            AppError::RecycleBinComFailed(msg) => {
                write!(f, "Recycle bin shell operation failed: {}", msg)
            }
            AppError::PermanentDeleteFailed(msg) => write!(f, "Permanent delete failed: {}", msg),
            AppError::SettingsReadFailed(msg) => write!(f, "Settings read failed: {}", msg),
            AppError::SettingsWriteFailed(msg) => write!(f, "Settings write failed: {}", msg),
            AppError::PlatformUnsupported(msg) => write!(f, "Platform unsupported: {}", msg),
            AppError::SessionInvalid(msg) => write!(f, "Invalid scan session: {}", msg),
            AppError::SessionExpired(msg) => write!(f, "Scan session expired: {}", msg),
            AppError::PlanInvalid(msg) => write!(f, "Invalid cleanup plan: {}", msg),
            AppError::PlanExpired(msg) => write!(f, "Cleanup plan expired: {}", msg),
            AppError::PlanChanged(msg) => write!(f, "Cleanup plan changed: {}", msg),
            AppError::Blocked(msg) => write!(f, "Operation blocked for safety: {}", msg),
            AppError::Network(msg) => write!(f, "Network error: {}", msg),
            AppError::Unknown(msg) => write!(f, "Unknown error: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::AccessDenied(err.to_string()),
            std::io::ErrorKind::NotFound => AppError::PathNotFound(err.to_string()),
            _ => AppError::Unknown(err.to_string()),
        }
    }
}

//! Secrets live in the Windows Credential Manager and never leave the Rust side.
//! The frontend can only save, clear, or ask whether a secret exists.

use keyring::Entry;
use serde::Serialize;
use tauri::State;

use crate::roblox::Roblox;

const SERVICE: &str = "com.groupwise.dashboard";
/// Service name used before the rename to Groupwise; secrets found there are moved over on first read.
const LEGACY_SERVICE: &str = "com.roblox.devdashboard";

#[derive(Clone, Copy)]
pub enum Secret {
    ApiKey,
    Cookie,
}

impl Secret {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "apiKey" => Ok(Secret::ApiKey),
            "cookie" => Ok(Secret::Cookie),
            _ => Err(format!("Unknown secret '{name}'")),
        }
    }

    fn user(self) -> &'static str {
        match self {
            Secret::ApiKey => "opencloud-api-key",
            Secret::Cookie => "roblosecurity",
        }
    }

    fn entry(self) -> Result<Entry, String> {
        Entry::new(SERVICE, self.user()).map_err(|e| e.to_string())
    }
}

pub fn read(secret: Secret) -> Option<String> {
    let entry = secret.entry().ok()?;
    if let Some(value) = entry.get_password().ok().filter(|s| !s.is_empty()) {
        return Some(value);
    }
    let legacy = Entry::new(LEGACY_SERVICE, secret.user()).ok()?;
    let value = legacy.get_password().ok().filter(|s| !s.is_empty())?;
    if entry.set_password(&value).is_ok() {
        let _ = legacy.delete_credential();
    }
    Some(value)
}

/// Store a secret from within Rust (used by the Roblox login flow).
pub fn write(secret: Secret, value: &str) -> Result<(), String> {
    secret.entry()?.set_password(value).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretsStatus {
    has_api_key: bool,
    has_cookie: bool,
}

#[tauri::command]
pub fn secrets_status() -> SecretsStatus {
    SecretsStatus {
        has_api_key: read(Secret::ApiKey).is_some(),
        has_cookie: read(Secret::Cookie).is_some(),
    }
}

#[tauri::command]
pub fn save_secret(rb: State<'_, Roblox>, name: &str, value: &str) -> Result<(), String> {
    let mut value = value.trim();
    // Accept a cookie pasted with or without the ".ROBLOSECURITY=" prefix.
    if let Some(rest) = value.strip_prefix(".ROBLOSECURITY=") {
        value = rest.trim();
    }
    if value.is_empty() {
        return Err("Value is empty".into());
    }
    Secret::parse(name)?
        .entry()?
        .set_password(value)
        .map_err(|e| e.to_string())?;
    // Cached data belongs to the old credentials.
    rb.net.clear_cache();
    Ok(())
}

#[tauri::command]
pub fn clear_secret(rb: State<'_, Roblox>, name: &str) -> Result<(), String> {
    match Secret::parse(name)?.entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            rb.net.clear_cache();
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

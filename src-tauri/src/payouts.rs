//! One-time group payouts (Robux from a group's funds to members).
//!
//! Roblox has no Open Cloud payout API, so this uses the website endpoint with the login cookie.
//! It needs an X-CSRF-TOKEN and usually a two-step verification challenge:
//!   1. POST /v1/groups/{id}/payouts  -> 403 with rblx-challenge-id / rblx-challenge-metadata
//!   2. verify the 2SV code           -> verificationToken
//!   3. POST challenge/v1/continue
//!   4. repeat the payout with the rblx-challenge-* headers
//! The challenge is held here between the two commands so the web UI only ever sends the code.

use std::sync::Mutex;

use reqwest::{RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::net::Auth;
use crate::roblox::Roblox;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Payee {
    user_id: u64,
    amount: u64,
}

struct Pending {
    group_id: String,
    payees: Vec<Payee>,
    challenge_id: String,
    inner_challenge_id: String,
    user_id: String,
    media_type: String,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static CSRF: Mutex<String> = Mutex::new(String::new());

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PayoutResult {
    Paid,
    /// Roblox wants a two-step verification code. `mediaType` is "authenticator", "email", ...
    #[serde(rename_all = "camelCase")]
    NeedsCode { media_type: String },
}

/// POST with the cookie and CSRF token, refreshing the token once if Roblox hands out a new one.
async fn post(rb: &Roblox, url: &str, body: &Value, extra: &[(&str, String)]) -> Result<Response, String> {
    for _ in 0..2 {
        let token = CSRF.lock().unwrap().clone();
        let mut req: RequestBuilder = rb.cookie(rb.http().post(url).json(body))?.header("x-csrf-token", token.as_str());
        for (k, v) in extra {
            req = req.header(*k, v.as_str());
        }
        let res = req.send().await.map_err(|e| format!("Network error: {e}"))?;
        if res.status() == StatusCode::FORBIDDEN {
            if let Some(new) = res.headers().get("x-csrf-token").and_then(|v| v.to_str().ok()) {
                if new != token {
                    *CSRF.lock().unwrap() = new.to_string();
                    continue;
                }
            }
        }
        return Ok(res);
    }
    Err("Roblox kept rejecting the security token. Try again.".into())
}

/// Roblox's error message from a failed response.
async fn error_of(res: Response) -> String {
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let msg = body
        .pointer("/errors/0/message")
        .or_else(|| body.pointer("/errors/0/userFacingMessage"))
        .and_then(Value::as_str)
        .unwrap_or("");
    match (status, msg) {
        (StatusCode::UNAUTHORIZED, _) => "Your Roblox login has expired. Log in again in Settings.".into(),
        (_, "") => format!("Roblox refused the payout ({status})."),
        (_, m) => m.to_string(),
    }
}

fn payout_body(payees: &[Payee]) -> Value {
    json!({
        "PayoutType": "FixedAmount",
        "Recipients": payees.iter().map(|p| json!({ "recipientId": p.user_id, "recipientType": "User", "amount": p.amount })).collect::<Vec<_>>(),
    })
}

fn payout_url(group_id: &str) -> String {
    format!("https://groups.roblox.com/v1/groups/{group_id}/payouts")
}

/// The finished payout changed the group's funds; drop the cached numbers.
fn paid(rb: &Roblox, group_id: &str) -> PayoutResult {
    rb.net.invalidate(&format!("gfin:{group_id}:"));
    rb.net.invalidate(&format!("sales:https://economy.roblox.com/v2/groups/{group_id}/"));
    PayoutResult::Paid
}

#[tauri::command]
pub async fn group_payout(rb: State<'_, Roblox>, group_id: String, payees: Vec<Payee>) -> Result<PayoutResult, String> {
    let rb = rb.inner();
    let group_id = group_id.trim().to_string();
    if group_id.is_empty() || !group_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid group ID.".into());
    }
    if payees.is_empty() || payees.iter().any(|p| p.amount == 0) {
        return Err("Every recipient needs an amount above zero.".into());
    }
    *PENDING.lock().unwrap() = None;

    let res = post(rb, &payout_url(&group_id), &payout_body(&payees), &[]).await?;
    if res.status().is_success() {
        return Ok(paid(rb, &group_id));
    }

    let header = |name: &str| res.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let (Some(challenge_id), Some(kind), Some(metadata)) = (header("rblx-challenge-id"), header("rblx-challenge-type"), header("rblx-challenge-metadata")) else {
        return Err(error_of(res).await);
    };
    if kind != "twostepverification" {
        return Err(format!("Roblox asked for a '{kind}' check this app can't complete. Do this payout on the Roblox website."));
    }
    let meta: Value = base64_decode(&metadata).and_then(|b| serde_json::from_slice(&b).ok()).ok_or("Couldn't read Roblox's verification request.")?;
    let inner_challenge_id = meta.get("challengeId").and_then(Value::as_str).unwrap_or_default().to_string();
    let user_id = match meta.get("userId") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return Err("Couldn't read Roblox's verification request.".into()),
    };

    // Which 2SV method the account uses: prefer an authenticator app, then email.
    let config: Value = rb
        .net
        .send(rb.cookie(rb.http().get(format!("https://twostepverification.roblox.com/v1/users/{user_id}/configuration")))?, Auth::Cookie)
        .await
        .unwrap_or(Value::Null);
    let enabled: Vec<String> = config
        .get("methods")
        .and_then(Value::as_array)
        .map(|ms| {
            ms.iter()
                .filter(|m| m.get("enabled").and_then(Value::as_bool).unwrap_or(false))
                .filter_map(|m| m.get("mediaType").and_then(Value::as_str).map(str::to_lowercase))
                .collect()
        })
        .unwrap_or_default();
    let media_type = ["authenticator", "email"]
        .into_iter()
        .find(|m| enabled.iter().any(|e| e == m))
        .ok_or("Your account's two-step verification method isn't supported here (only authenticator app and email). Do this payout on the Roblox website.")?
        .to_string();

    *PENDING.lock().unwrap() = Some(Pending { group_id, payees, challenge_id, inner_challenge_id, user_id, media_type: media_type.clone() });
    Ok(PayoutResult::NeedsCode { media_type })
}

#[tauri::command]
pub async fn group_payout_verify(rb: State<'_, Roblox>, code: String) -> Result<PayoutResult, String> {
    let rb = rb.inner();
    let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    if code.len() != 6 {
        return Err("Enter the 6-digit code.".into());
    }
    let p = PENDING.lock().unwrap().take().ok_or("This payout expired. Start it again.")?;

    let verify = post(
        rb,
        &format!("https://twostepverification.roblox.com/v1/users/{}/challenges/{}/verify", p.user_id, p.media_type),
        &json!({ "challengeId": p.inner_challenge_id, "actionType": "Generic", "code": code }),
        &[],
    )
    .await?;
    if !verify.status().is_success() {
        let err = error_of(verify).await;
        // Let the user retry a mistyped code without restarting.
        *PENDING.lock().unwrap() = Some(p);
        return Err(if err.contains("refused") { "That code didn't work. Check it and try again.".into() } else { err });
    }
    let token: Value = verify.json().await.map_err(|e| format!("Unexpected response: {e}"))?;
    let verification_token = token.get("verificationToken").and_then(Value::as_str).ok_or("Roblox didn't confirm the code.")?;

    let meta = json!({ "verificationToken": verification_token, "rememberDevice": false, "challengeId": p.inner_challenge_id, "actionType": "Generic" });
    let cont = post(
        rb,
        "https://apis.roblox.com/challenge/v1/continue",
        &json!({ "challengeId": p.challenge_id, "challengeType": "twostepverification", "challengeMetadata": meta.to_string() }),
        &[],
    )
    .await?;
    if !cont.status().is_success() {
        return Err(error_of(cont).await);
    }

    let res = post(
        rb,
        &payout_url(&p.group_id),
        &payout_body(&p.payees),
        &[
            ("rblx-challenge-id", p.challenge_id.clone()),
            ("rblx-challenge-type", "twostepverification".into()),
            ("rblx-challenge-metadata", base64_encode(meta.to_string().as_bytes())),
        ],
    )
    .await?;
    if res.status().is_success() {
        Ok(paid(rb, &p.group_id))
    } else {
        Err(error_of(res).await)
    }
}

#[tauri::command]
pub fn cancel_payout() {
    *PENDING.lock().unwrap() = None;
}

// ---------- Recipients ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayeeInfo {
    id: u64,
    name: String,
    display_name: String,
    headshot_url: Option<String>,
    /// The user's role in the group, or None when they aren't a member.
    role_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsernameLookup {
    #[serde(default)]
    data: Vec<FoundUser>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FoundUser {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    display_name: String,
}

/// Look up users by username, with their headshot and role in the group.
#[tauri::command]
pub async fn find_payees(rb: State<'_, Roblox>, group_id: String, usernames: Vec<String>) -> Result<Vec<PayeeInfo>, String> {
    let rb = rb.inner();
    let names: Vec<String> = usernames.iter().map(|u| u.trim().trim_start_matches('@').to_string()).filter(|u| !u.is_empty()).collect();
    if names.is_empty() {
        return Ok(vec![]);
    }
    let req = rb.http().post("https://users.roblox.com/v1/usernames/users").json(&json!({ "usernames": names, "excludeBannedUsers": true }));
    let found: UsernameLookup = rb.net.send(req, Auth::None).await?;

    let ids = found.data.iter().map(|u| u.id.to_string()).collect::<Vec<_>>().join(",");
    let thumbs: Value = rb
        .net
        .send(
            rb.http()
                .get("https://thumbnails.roblox.com/v1/users/avatar-headshot")
                .query(&[("userIds", ids.as_str()), ("size", "150x150"), ("format", "Png"), ("isCircular", "false")]),
            Auth::None,
        )
        .await
        .unwrap_or(Value::Null);
    let headshot = |id: u64| {
        thumbs
            .get("data")
            .and_then(Value::as_array)
            .and_then(|a| a.iter().find(|t| t.get("targetId").and_then(Value::as_u64) == Some(id)))
            .and_then(|t| t.get("imageUrl").and_then(Value::as_str))
            .map(str::to_string)
    };

    let mut out = Vec::new();
    for u in found.data {
        let roles: Value = rb
            .net
            .send(rb.http().get(format!("https://groups.roblox.com/v1/users/{}/groups/roles", u.id)), Auth::None)
            .await
            .unwrap_or(Value::Null);
        let role_name = roles
            .get("data")
            .and_then(Value::as_array)
            .and_then(|a| a.iter().find(|m| m.pointer("/group/id").and_then(Value::as_u64).map(|id| id.to_string()) == Some(group_id.clone())))
            .and_then(|m| m.pointer("/role/name").and_then(Value::as_str))
            .map(str::to_string);
        out.push(PayeeInfo { headshot_url: headshot(u.id), id: u.id, name: u.name, display_name: u.display_name, role_name });
    }
    Ok(out)
}

// ---------- base64 (standard alphabet, padded) ----------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;
    for c in input.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        } as u32;
        buf = buf << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits & 0xff) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trip() {
        for s in ["", "a", "ab", "abc", "abcd", r#"{"challengeId":"x","actionType":"Generic"}"#] {
            assert_eq!(base64_decode(&base64_encode(s.as_bytes())).unwrap(), s.as_bytes());
        }
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
    }
}

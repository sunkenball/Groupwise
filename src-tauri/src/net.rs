//! Throttled, retrying, cached HTTP so the dashboard stays under Roblox's rate limits.
//!
//! - Every host gets a gate: a few requests in flight and a minimum gap between starts.
//!   A 429 pushes the whole host back, not just the one request.
//! - 429s and 5xx are retried with backoff (honouring Retry-After).
//! - Results are cached in memory and on disk with a per-call TTL. When Roblox refuses a
//!   refresh (rate limit / network), the last good value is served and marked stale.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{Mutex as AsyncMutex, Semaphore, SemaphorePermit};

pub const RATE_LIMITED: &str = "Roblox is rate limiting requests";
const MAX_RETRIES: u32 = 3;

/// Which credential a request used, so errors can say what to fix.
#[derive(Clone, Copy)]
pub enum Auth {
    ApiKey,
    Cookie,
    None,
}

struct Gate {
    slots: Semaphore,
    next: AsyncMutex<Instant>,
    spacing: Duration,
}

impl Gate {
    fn new(concurrency: usize, spacing_ms: u64) -> Self {
        Self { slots: Semaphore::new(concurrency), next: AsyncMutex::new(Instant::now()), spacing: Duration::from_millis(spacing_ms) }
    }

    async fn enter(&self) -> SemaphorePermit<'_> {
        let permit = self.slots.acquire().await.expect("gate closed");
        let wait = {
            let mut next = self.next.lock().await;
            let now = Instant::now();
            let start = (*next).max(now);
            *next = start + self.spacing;
            start - now
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        permit
    }

    async fn push_back(&self, by: Duration) {
        let mut next = self.next.lock().await;
        *next = (*next).max(Instant::now() + by);
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    /// Unix milliseconds when fetched.
    at: u64,
    value: Value,
}

/// A cached result plus when it was fetched. `stale` means a refresh failed and this is older data.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cached<T> {
    pub data: T,
    pub fetched_at: u64,
    pub stale: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub struct Net {
    pub http: Client,
    gates: HashMap<&'static str, Gate>,
    default_gate: Gate,
    entries: Mutex<HashMap<String, Entry>>,
    file: Mutex<Option<PathBuf>>,
    key_locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl Net {
    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent("Groupwise/0.2")
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");
        let gates = HashMap::from([
            ("apis.roblox.com", Gate::new(3, 120)),
            ("economy.roblox.com", Gate::new(2, 300)),
            ("groups.roblox.com", Gate::new(2, 200)),
            ("games.roblox.com", Gate::new(2, 200)),
            ("thumbnails.roblox.com", Gate::new(2, 150)),
            ("users.roblox.com", Gate::new(2, 200)),
        ]);
        Self {
            http,
            gates,
            default_gate: Gate::new(4, 50),
            entries: Mutex::new(HashMap::new()),
            file: Mutex::new(None),
            key_locks: Mutex::new(HashMap::new()),
        }
    }

    /// Load the on-disk cache (dropping anything older than a week) and persist to it from now on.
    pub fn use_cache_file(&self, path: PathBuf) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, Entry>>(&text) {
                let cutoff = now_ms().saturating_sub(7 * 24 * 3600 * 1000);
                let mut entries = self.entries.lock().unwrap();
                entries.extend(map.into_iter().filter(|(_, e)| e.at >= cutoff));
            }
        }
        *self.file.lock().unwrap() = Some(path);
    }

    fn persist(&self) {
        let Some(path) = self.file.lock().unwrap().clone() else { return };
        let json = serde_json::to_string(&*self.entries.lock().unwrap()).unwrap_or_default();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, json);
    }

    /// Drop every cached entry whose key starts with `prefix`.
    pub fn invalidate(&self, prefix: &str) {
        self.entries.lock().unwrap().retain(|k, _| !k.starts_with(prefix));
        self.persist();
    }

    pub fn clear_cache(&self) {
        self.entries.lock().unwrap().clear();
        self.persist();
    }

    fn gate(&self, host: &str) -> &Gate {
        self.gates.get(host).unwrap_or(&self.default_gate)
    }

    /// Send with throttling and retries, then decode JSON.
    pub async fn send<T: DeserializeOwned>(&self, req: RequestBuilder, auth: Auth) -> Result<T, String> {
        let res = self.execute(req, auth).await?;
        res.json().await.map_err(|e| format!("Unexpected response from Roblox: {e}"))
    }

    /// Send with throttling and retries; returns the successful response, or an error that says what to fix.
    pub async fn execute(&self, req: RequestBuilder, auth: Auth) -> Result<Response, String> {
        let req = req.build().map_err(|e| e.to_string())?;
        let gate = self.gate(req.url().host_str().unwrap_or(""));
        let mut attempt = 0;
        loop {
            let attempt_req = req.try_clone().ok_or("Request can't be retried")?;
            let res = {
                let _permit = gate.enter().await;
                self.http.execute(attempt_req).await
            };
            let res = match res {
                Ok(r) => r,
                Err(e) if attempt < MAX_RETRIES && (e.is_timeout() || e.is_connect()) => {
                    attempt += 1;
                    tokio::time::sleep(Duration::from_millis(500 * 2u64.pow(attempt))).await;
                    continue;
                }
                Err(e) => return Err(format!("Network error: {e}")),
            };
            let status = res.status();
            if status.is_success() {
                return Ok(res);
            }
            if (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()) && attempt < MAX_RETRIES {
                let wait = retry_after(&res)
                    .unwrap_or(Duration::from_millis(1000 * 2u64.pow(attempt)))
                    .min(Duration::from_secs(15));
                if status == StatusCode::TOO_MANY_REQUESTS {
                    gate.push_back(wait).await;
                } else {
                    tokio::time::sleep(wait).await;
                }
                attempt += 1;
                continue;
            }
            let body = res.text().await.unwrap_or_default();
            let detail: String = body.chars().take(500).collect();
            return Err(match (status, auth) {
                (StatusCode::UNAUTHORIZED, Auth::ApiKey) => {
                    "Open Cloud rejected the API key (401). Check that it is correct and not expired.".into()
                }
                (StatusCode::FORBIDDEN, Auth::ApiKey) => format!(
                    "API key not allowed (403). Give it the group:read scope and allow your IP (or 0.0.0.0/0). {detail}"
                ),
                (StatusCode::UNAUTHORIZED, Auth::Cookie) => {
                    "Roblox rejected the cookie (401). It is probably expired; log in again in Settings.".into()
                }
                (StatusCode::TOO_MANY_REQUESTS, _) => format!("{RATE_LIMITED}. Try again in a minute."),
                _ => format!("Roblox returned {status}: {detail}"),
            });
        }
    }

    /// Return the cached value for `key` if it is younger than `ttl` (unless `force`), otherwise fetch it.
    /// Concurrent calls for the same key share one fetch. A failed refresh falls back to stale data
    /// when the failure is a rate limit or network problem.
    pub async fn cached<T, F, Fut>(&self, key: &str, ttl: Duration, force: bool, fetch: F) -> Result<Cached<T>, String>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let called_at = now_ms();
        let lock = self.key_locks.lock().unwrap().entry(key.to_string()).or_default().clone();
        let _guard = lock.lock().await;

        let existing = self.entries.lock().unwrap().get(key).cloned();
        if let Some(e) = &existing {
            // Fresh enough, or another caller refreshed it while we waited on the lock.
            let fresh = now_ms().saturating_sub(e.at) < ttl.as_millis() as u64;
            if (!force && fresh) || e.at >= called_at {
                if let Ok(data) = serde_json::from_value(e.value.clone()) {
                    return Ok(Cached { data, fetched_at: e.at, stale: false });
                }
            }
        }

        match fetch().await {
            Ok(data) => {
                let at = now_ms();
                if let Ok(value) = serde_json::to_value(&data) {
                    self.entries.lock().unwrap().insert(key.to_string(), Entry { at, value });
                    self.persist();
                }
                Ok(Cached { data, fetched_at: at, stale: false })
            }
            Err(err) if err.starts_with(RATE_LIMITED) || err.starts_with("Network error") => {
                match existing.and_then(|e| serde_json::from_value(e.value).ok().map(|d| (d, e.at))) {
                    Some((data, at)) => Ok(Cached { data, fetched_at: at, stale: true }),
                    None => Err(err),
                }
            }
            Err(err) => Err(err),
        }
    }
}

fn retry_after(res: &Response) -> Option<Duration> {
    let secs: f64 = res.headers().get("retry-after")?.to_str().ok()?.trim().parse().ok()?;
    Some(Duration::from_millis((secs.max(0.5) * 1000.0) as u64))
}

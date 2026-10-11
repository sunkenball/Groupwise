//! Roblox HTTP calls. Group memberships come from the public groups API in one request
//! (Open Cloud is the fallback when an API key is saved). Robux balances, revenue and
//! sales come from the legacy economy APIs, which only accept the .ROBLOSECURITY cookie.
//! Everything goes through `Net`, which throttles, retries and caches.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use futures::{stream, StreamExt};
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};

use crate::net::{now_ms, Auth, Cached, Net};
use crate::secrets::{self, Secret};

const OPEN_CLOUD: &str = "https://apis.roblox.com/cloud/v2";

const MIN: u64 = 60;
const TTL_GROUPS: Duration = Duration::from_secs(30 * MIN);
const TTL_FINANCE: Duration = Duration::from_secs(3 * MIN);
const TTL_SALES: Duration = Duration::from_secs(10 * MIN);
const TTL_GAME_LIST: Duration = Duration::from_secs(60 * MIN);
const TTL_GAME_STATS: Duration = Duration::from_secs(2 * MIN);
const TTL_VOTES: Duration = Duration::from_secs(10 * MIN);
const TTL_ICONS: Duration = Duration::from_secs(24 * 60 * MIN);
const TTL_ME: Duration = Duration::from_secs(60 * MIN);
const TTL_RATES: Duration = Duration::from_secs(12 * 60 * MIN);

pub struct Roblox {
    pub net: Net,
}

impl Roblox {
    pub fn new() -> Self {
        Self { net: Net::new() }
    }

    pub(crate) fn http(&self) -> &Client {
        &self.net.http
    }

    fn api_key(&self, req: RequestBuilder) -> Result<RequestBuilder, String> {
        let key = secrets::read(Secret::ApiKey).ok_or("No Open Cloud API key saved. Add one in Settings.")?;
        Ok(req.header("x-api-key", key))
    }

    pub(crate) fn cookie(&self, req: RequestBuilder) -> Result<RequestBuilder, String> {
        let cookie = secrets::read(Secret::Cookie)
            .ok_or("Not logged in to Roblox. Log in from Settings to see Robux and revenue.")?;
        Ok(req.header("Cookie", format!(".ROBLOSECURITY={cookie}")))
    }

    /// The account the saved cookie belongs to.
    async fn me(&self, force: bool) -> Result<Cached<CookieUser>, String> {
        self.net
            .cached("me", TTL_ME, force, || async {
                let req = self.cookie(self.http().get("https://users.roblox.com/v1/users/authenticated"))?;
                self.net.send(req, Auth::Cookie).await
            })
            .await
    }
}

fn numeric_id(id: &str, what: &str) -> Result<String, String> {
    let id = id.trim();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Invalid {what} ID '{id}'."));
    }
    Ok(id.to_string())
}

// ---------- Groups ----------

#[derive(Deserialize)]
struct ThumbnailList {
    #[serde(default)]
    data: Vec<Thumbnail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Thumbnail {
    target_id: u64,
    image_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    id: String,
    name: String,
    member_count: u64,
    verified: bool,
    is_owner: bool,
    role_name: String,
    rank: u32,
    icon_url: Option<String>,
}

#[derive(Deserialize)]
struct RolesPage {
    #[serde(default)]
    data: Vec<RoleMembership>,
}

#[derive(Deserialize)]
struct RoleMembership {
    group: LegacyGroup,
    role: LegacyRole,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyGroup {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    member_count: u64,
    #[serde(default)]
    has_verified_badge: bool,
    owner: Option<LegacyOwner>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyOwner {
    user_id: Option<u64>,
}

#[derive(Deserialize)]
struct LegacyRole {
    #[serde(default)]
    name: String,
    #[serde(default)]
    rank: u32,
}

/// All of a user's groups in a single public request.
async fn groups_public(rb: &Roblox, user_id: &str) -> Result<Vec<GroupSummary>, String> {
    let req = rb.http().get(format!("https://groups.roblox.com/v1/users/{user_id}/groups/roles"));
    let page: RolesPage = rb.net.send(req, Auth::None).await?;
    Ok(page
        .data
        .into_iter()
        .map(|m| GroupSummary {
            is_owner: m.group.owner.and_then(|o| o.user_id).map(|id| id.to_string()).as_deref() == Some(user_id),
            id: m.group.id.to_string(),
            name: m.group.name,
            member_count: m.group.member_count,
            verified: m.group.has_verified_badge,
            role_name: m.role.name,
            rank: m.role.rank,
            icon_url: None,
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembershipPage {
    #[serde(default)]
    group_memberships: Vec<Membership>,
    #[serde(default)]
    next_page_token: String,
}

#[derive(Deserialize)]
struct Membership {
    path: String,
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudGroup {
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    member_count: u64,
    #[serde(default)]
    verified: bool,
    #[serde(default)]
    owner: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudRole {
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    rank: u32,
}

/// Path segment after `key/`, e.g. ("groups/7/roles/9", "roles") -> "9".
fn segment<'a>(path: &'a str, key: &str) -> Option<&'a str> {
    let mut parts = path.split('/');
    while let Some(p) = parts.next() {
        if p == key {
            return parts.next();
        }
    }
    None
}

/// Open Cloud fallback: one request per membership page plus two per group, so it is only used
/// when the public endpoint fails.
async fn groups_open_cloud(rb: &Roblox, user_id: &str) -> Result<Vec<GroupSummary>, String> {
    let mut memberships = Vec::new();
    let mut token = String::new();
    loop {
        let mut query = vec![("maxPageSize", "100".to_string()), ("filter", format!("user == 'users/{user_id}'"))];
        if !token.is_empty() {
            query.push(("pageToken", token.clone()));
        }
        let req = rb.api_key(rb.http().get(format!("{OPEN_CLOUD}/groups/-/memberships")).query(&query))?;
        let page: MembershipPage = rb.net.send(req, Auth::ApiKey).await?;
        memberships.extend(page.group_memberships);
        if page.next_page_token.is_empty() {
            break;
        }
        token = page.next_page_token;
    }

    let owner_ref = format!("users/{user_id}");
    stream::iter(memberships)
        .map(|m| {
            let owner_ref = owner_ref.clone();
            async move {
                let group_id = segment(&m.path, "groups").unwrap_or_default().to_string();
                let group_req = rb.api_key(rb.http().get(format!("{OPEN_CLOUD}/groups/{group_id}")))?;
                let role_req = rb.api_key(rb.http().get(format!("{OPEN_CLOUD}/{}", m.role)))?;
                let (group, role) = futures::join!(
                    rb.net.send::<CloudGroup>(group_req, Auth::ApiKey),
                    rb.net.send::<CloudRole>(role_req, Auth::ApiKey)
                );
                let group = group?;
                let role = role.unwrap_or(CloudRole { display_name: "Unknown".into(), rank: 0 });
                Ok::<_, String>(GroupSummary {
                    is_owner: group.owner.as_deref() == Some(owner_ref.as_str()),
                    name: group.display_name,
                    member_count: group.member_count,
                    verified: group.verified,
                    role_name: role.display_name,
                    rank: role.rank,
                    icon_url: None,
                    id: group_id,
                })
            }
        })
        .buffer_unordered(3)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect()
}

/// Thumbnail URLs for groups or games, 100 ids per request. Best effort.
async fn thumbnails(rb: &Roblox, kind: &str, ids: &[String]) -> HashMap<String, String> {
    let (url, param) = match kind {
        "groups" => ("https://thumbnails.roblox.com/v1/groups/icons", "groupIds"),
        _ => ("https://thumbnails.roblox.com/v1/games/icons", "universeIds"),
    };
    let mut out = HashMap::new();
    for chunk in ids.chunks(100) {
        let joined = chunk.join(",");
        let key = format!("icons:{kind}:{joined}");
        let fetched = rb
            .net
            .cached(&key, TTL_ICONS, false, || async {
                let req = rb.http().get(url).query(&[(param, joined.as_str()), ("size", "150x150"), ("format", "Png"), ("isCircular", "false")]);
                let list: ThumbnailList = rb.net.send(req, Auth::None).await?;
                Ok(list
                    .data
                    .into_iter()
                    .filter_map(|t| t.image_url.map(|u| (t.target_id.to_string(), u)))
                    .collect::<HashMap<_, _>>())
            })
            .await;
        if let Ok(c) = fetched {
            out.extend(c.data);
        }
    }
    out
}

#[tauri::command]
pub async fn list_groups(rb: State<'_, Roblox>, user_id: String, force: Option<bool>) -> Result<Cached<Vec<GroupSummary>>, String> {
    let user_id = numeric_id(&user_id, "user").map_err(|_| "Enter your numeric Roblox user ID in Settings.".to_string())?;
    let rb = rb.inner();
    rb.net
        .cached(&format!("groups:{user_id}"), TTL_GROUPS, force.unwrap_or(false), || async {
            let mut groups = match groups_public(rb, &user_id).await {
                Ok(g) => g,
                Err(e) if secrets::read(Secret::ApiKey).is_some() => groups_open_cloud(rb, &user_id).await.map_err(|e2| format!("{e} (Open Cloud fallback: {e2})"))?,
                Err(e) => return Err(e),
            };
            let ids: Vec<String> = groups.iter().map(|g| g.id.clone()).collect();
            let mut icons = thumbnails(rb, "groups", &ids).await;
            for g in &mut groups {
                g.icon_url = icons.remove(&g.id);
            }
            groups.sort_by(|a, b| b.rank.cmp(&a.rank).then(b.member_count.cmp(&a.member_count)));
            Ok(groups)
        })
        .await
}

// ---------- Games ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerRef {
    /// "group" or "user".
    kind: String,
    id: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    universe_id: u64,
    root_place_id: u64,
    name: String,
    owner_kind: String,
    owner_id: String,
    visits: u64,
    playing: u64,
    favorites: u64,
    updated: String,
    icon_url: Option<String>,
    /// Thumbs up / down; the like ratio is up / (up + down).
    #[serde(default)]
    up_votes: u64,
    #[serde(default)]
    down_votes: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameVotes {
    id: u64,
    #[serde(default)]
    up_votes: u64,
    #[serde(default)]
    down_votes: u64,
}

#[derive(Deserialize)]
struct VotesList {
    #[serde(default)]
    data: Vec<GameVotes>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GamesPage {
    #[serde(default)]
    data: Vec<ListedGame>,
    next_page_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListedGame {
    id: u64,
    #[serde(default)]
    name: String,
    root_place: Option<IdRef>,
    #[serde(default)]
    place_visits: u64,
    #[serde(default)]
    updated: String,
}

#[derive(Deserialize)]
struct IdRef {
    id: u64,
}

#[derive(Deserialize)]
struct StatsList {
    #[serde(default)]
    data: Vec<GameStat>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameStat {
    id: u64,
    #[serde(default)]
    playing: Option<u64>,
    #[serde(default)]
    visits: Option<u64>,
    #[serde(default)]
    favorited_count: Option<u64>,
    #[serde(default)]
    updated: Option<String>,
}

/// Public experiences owned by a group or user (no live stats).
async fn owner_games(rb: &Roblox, owner: &OwnerRef, force: bool) -> Result<Cached<Vec<Game>>, String> {
    let kind = match owner.kind.as_str() {
        "group" => "groups",
        "user" => "users",
        k => return Err(format!("Unknown owner kind '{k}'")),
    };
    let id = numeric_id(&owner.id, "owner")?;
    rb.net
        .cached(&format!("games:{kind}:{id}"), TTL_GAME_LIST, force, || async {
            let mut games = Vec::new();
            let mut cursor: Option<String> = None;
            for _ in 0..4 {
                let mut query = vec![("accessFilter", "2".to_string()), ("limit", "50".to_string()), ("sortOrder", "Desc".to_string())];
                if let Some(c) = &cursor {
                    query.push(("cursor", c.clone()));
                }
                let req = rb.http().get(format!("https://games.roblox.com/v2/{kind}/{id}/games")).query(&query);
                let page: GamesPage = rb.net.send(req, Auth::None).await?;
                games.extend(page.data.into_iter().map(|g| Game {
                    universe_id: g.id,
                    root_place_id: g.root_place.map(|r| r.id).unwrap_or(0),
                    name: g.name,
                    owner_kind: owner.kind.clone(),
                    owner_id: id.clone(),
                    visits: g.place_visits,
                    playing: 0,
                    favorites: 0,
                    updated: g.updated,
                    icon_url: None,
                    up_votes: 0,
                    down_votes: 0,
                }));
                match page.next_page_cursor {
                    Some(c) if !c.is_empty() => cursor = Some(c),
                    _ => break,
                }
            }
            Ok(games)
        })
        .await
}

#[tauri::command]
pub async fn list_games(rb: State<'_, Roblox>, owners: Vec<OwnerRef>, force: Option<bool>) -> Result<Cached<Vec<Game>>, String> {
    let rb = rb.inner();
    let force = force.unwrap_or(false);

    let results = stream::iter(owners)
        .map(|o| async move { owner_games(rb, &o, force).await })
        .buffer_unordered(3)
        .collect::<Vec<_>>()
        .await;

    let mut games = Vec::new();
    let mut fetched_at = now_ms();
    let mut stale = false;
    let mut first_err = None;
    for r in results {
        match r {
            Ok(c) => {
                fetched_at = fetched_at.min(c.fetched_at);
                stale |= c.stale;
                games.extend(c.data);
            }
            Err(e) => first_err = first_err.or(Some(e)),
        }
    }
    if games.is_empty() {
        if let Some(e) = first_err {
            return Err(e);
        }
    }

    // Live stats and icons, 50 universes per request.
    let mut ids: Vec<String> = games.iter().map(|g| g.universe_id.to_string()).collect();
    ids.sort();
    ids.dedup();
    let mut stats: HashMap<u64, GameStat> = HashMap::new();
    for chunk in ids.chunks(50) {
        let joined = chunk.join(",");
        let r = rb
            .net
            .cached(&format!("stats:{joined}"), TTL_GAME_STATS, force, || async {
                let req = rb.http().get("https://games.roblox.com/v1/games").query(&[("universeIds", joined.as_str())]);
                let list: StatsList = rb.net.send(req, Auth::None).await?;
                Ok(list.data)
            })
            .await;
        if let Ok(c) = r {
            fetched_at = fetched_at.min(c.fetched_at);
            stale |= c.stale;
            stats.extend(c.data.into_iter().map(|s| (s.id, s)));
        }
    }
    // Like ratio (best effort).
    let mut votes: HashMap<u64, GameVotes> = HashMap::new();
    for chunk in ids.chunks(50) {
        let joined = chunk.join(",");
        let r = rb
            .net
            .cached(&format!("votes:{joined}"), TTL_VOTES, force, || async {
                let req = rb.http().get("https://games.roblox.com/v1/games/votes").query(&[("universeIds", joined.as_str())]);
                let list: VotesList = rb.net.send(req, Auth::None).await?;
                Ok(list.data)
            })
            .await;
        if let Ok(c) = r {
            votes.extend(c.data.into_iter().map(|v| (v.id, v)));
        }
    }
    let icons = thumbnails(rb, "games", &ids).await;

    for g in &mut games {
        if let Some(s) = stats.get(&g.universe_id) {
            g.playing = s.playing.unwrap_or(0);
            g.visits = s.visits.unwrap_or(g.visits);
            g.favorites = s.favorited_count.unwrap_or(0);
            if let Some(u) = &s.updated {
                g.updated = u.clone();
            }
        }
        g.icon_url = icons.get(&g.universe_id.to_string()).cloned();
        if let Some(v) = votes.get(&g.universe_id) {
            g.up_votes = v.up_votes;
            g.down_votes = v.down_votes;
        }
    }
    games.sort_by(|a, b| b.playing.cmp(&a.playing).then(b.visits.cmp(&a.visits)));
    Ok(Cached { data: games, fetched_at, stale })
}

// ---------- Finance (cookie) ----------

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CookieUser {
    id: u64,
    name: String,
    display_name: String,
}

#[tauri::command]
pub async fn cookie_user(rb: State<'_, Roblox>) -> Result<CookieUser, String> {
    Ok(rb.me(true).await?.data)
}

/// Ask Roblox who a raw cookie value belongs to. Returns `Ok(None)` when the cookie
/// is present but not signed in (Roblox hands out a guest `.ROBLOSECURITY` before login).
async fn whoami(http: &Client, cookie_value: &str) -> Result<Option<CookieUser>, String> {
    let res = http
        .get("https://users.roblox.com/v1/users/authenticated")
        .header("Cookie", format!(".ROBLOSECURITY={cookie_value}"))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    match res.status() {
        StatusCode::OK => res.json().await.map(Some).map_err(|e| format!("Unexpected response: {e}")),
        StatusCode::UNAUTHORIZED => Ok(None),
        s => Err(format!("Roblox returned {s} while checking the login.")),
    }
}

const LOGIN_LABEL: &str = "roblox-login";

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LoginResult {
    /// Signed in; the cookie has been saved.
    Captured { user: CookieUser },
    /// The user closed the login window before signing in.
    Cancelled,
    /// Five minutes passed with no sign-in.
    TimedOut,
}

/// Open a Roblox login window and, once the user signs in, grab their
/// `.ROBLOSECURITY` cookie straight from that window and save it. The cookie
/// never leaves this process; the web UI only ever sees the resulting username.
#[tauri::command]
pub async fn login_with_roblox(app: AppHandle, rb: State<'_, Roblox>) -> Result<LoginResult, String> {
    let login_url = Url::parse("https://www.roblox.com/login").map_err(|e| e.to_string())?;
    let match_url = Url::parse("https://www.roblox.com").map_err(|e| e.to_string())?;

    if let Some(existing) = app.get_webview_window(LOGIN_LABEL) {
        let _ = existing.set_focus();
    } else {
        WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(login_url))
            .title("Log in to Roblox")
            .inner_size(480.0, 720.0)
            .focused(true)
            .build()
            .map_err(|e| format!("Couldn't open the login window: {e}"))?;
    }

    let http = rb.http().clone();
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        // The user closed the window — treat as cancelled.
        let Some(win) = app.get_webview_window(LOGIN_LABEL) else {
            return Ok(LoginResult::Cancelled);
        };

        let cookie = win
            .cookies_for_url(match_url.clone())
            .ok()
            .and_then(|cs| cs.into_iter().find(|c| c.name() == ".ROBLOSECURITY"))
            .map(|c| c.value().to_string())
            .filter(|v| !v.is_empty());

        if let Some(value) = cookie {
            if let Some(user) = whoami(&http, &value).await? {
                secrets::write(Secret::Cookie, &value)?;
                rb.net.clear_cache();
                let _ = win.destroy();
                return Ok(LoginResult::Captured { user });
            }
        }

        if Instant::now() >= deadline {
            let _ = win.destroy();
            return Ok(LoginResult::TimedOut);
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

#[derive(Deserialize)]
struct Currency {
    robux: i64,
}

/// Numeric fields of a revenue / transaction-totals response, keyed by Roblox's field name.
type Breakdown = BTreeMap<String, i64>;

fn numeric_fields(v: Value) -> Breakdown {
    match v {
        Value::Object(map) => map.into_iter().filter_map(|(k, v)| v.as_i64().map(|n| (k, n))).collect(),
        _ => Breakdown::new(),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finance {
    /// None when the cookie's account can't view this balance.
    balance: Option<i64>,
    breakdown: Option<Breakdown>,
    /// Why balance/breakdown are missing, if they are.
    note: Option<String>,
}

fn parse_timeframe(tf: &str) -> Result<&'static str, String> {
    match tf {
        "Day" => Ok("Day"),
        "Week" => Ok("Week"),
        "Month" => Ok("Month"),
        "Year" => Ok("Year"),
        _ => Err(format!("Unknown timeframe '{tf}'")),
    }
}

const NO_ACCESS: &str = "Your account doesn't have permission to view this group's funds.";

/// Treat 403 as "no permission" rather than a hard error.
fn soften<T>(r: Result<T, String>, note: &mut Option<String>) -> Result<Option<T>, String> {
    match r {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.contains("403") => {
            *note = Some(NO_ACCESS.into());
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn group_finance(rb: State<'_, Roblox>, group_id: String, timeframe: String, force: Option<bool>) -> Result<Cached<Finance>, String> {
    let tf = parse_timeframe(&timeframe)?.to_lowercase();
    let group_id = numeric_id(&group_id, "group")?;
    let rb = rb.inner();
    rb.net
        .cached(&format!("gfin:{group_id}:{tf}"), TTL_FINANCE, force.unwrap_or(false), || async {
            let base = format!("https://economy.roblox.com/v1/groups/{group_id}");
            let funds_req = rb.cookie(rb.http().get(format!("{base}/currency")))?;
            let rev_req = rb.cookie(rb.http().get(format!("{base}/revenue/summary/{tf}")))?;
            let (funds, rev) = futures::join!(
                rb.net.send::<Currency>(funds_req, Auth::Cookie),
                rb.net.send::<Value>(rev_req, Auth::Cookie)
            );
            let mut note = None;
            Ok(Finance {
                balance: soften(funds, &mut note)?.map(|c| c.robux),
                breakdown: soften(rev, &mut note)?.map(numeric_fields),
                note,
            })
        })
        .await
}

#[tauri::command]
pub async fn user_finance(rb: State<'_, Roblox>, timeframe: String, force: Option<bool>) -> Result<Cached<Finance>, String> {
    let tf = parse_timeframe(&timeframe)?;
    let rb = rb.inner();
    let force = force.unwrap_or(false);
    let me = rb.me(false).await?.data;
    rb.net
        .cached(&format!("ufin:{}:{tf}", me.id), TTL_FINANCE, force, || async {
            let funds_req = rb.cookie(rb.http().get(format!("https://economy.roblox.com/v1/users/{}/currency", me.id)))?;
            let totals_req = rb.cookie(
                rb.http()
                    .get(format!("https://economy.roblox.com/v2/users/{}/transaction-totals", me.id))
                    .query(&[("timeFrame", tf), ("transactionType", "summary")]),
            )?;
            let (funds, totals) = futures::join!(
                rb.net.send::<Currency>(funds_req, Auth::Cookie),
                rb.net.send::<Value>(totals_req, Auth::Cookie)
            );
            Ok(Finance { balance: Some(funds?.robux), breakdown: Some(numeric_fields(totals?)), note: None })
        })
        .await
}

// ---------- Sales per game (cookie) ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TxPage {
    #[serde(default)]
    data: Vec<Tx>,
    next_page_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tx {
    #[serde(default)]
    created: String,
    #[serde(default)]
    is_pending: bool,
    details: Option<TxDetails>,
    currency: Option<TxCurrency>,
}

#[derive(Deserialize)]
struct TxDetails {
    #[serde(default)]
    name: String,
    #[serde(rename = "type", default)]
    kind: String,
    place: Option<TxPlace>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TxPlace {
    place_id: Option<u64>,
    universe_id: Option<u64>,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct TxCurrency {
    #[serde(default)]
    amount: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaleProduct {
    name: String,
    kind: String,
    robux: i64,
    sales: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaleGame {
    /// None for sales not tied to an experience (clothing, UGC, ...).
    universe_id: Option<u64>,
    place_id: Option<u64>,
    name: String,
    robux: i64,
    pending: i64,
    sales: u32,
    products: Vec<SaleProduct>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sales {
    games: Vec<SaleGame>,
    total: i64,
    count: u32,
    /// True when the page limit was hit before reaching the start of the timeframe.
    truncated: bool,
    /// Oldest sale included (ISO timestamp).
    oldest: Option<String>,
    note: Option<String>,
}

/// Unix seconds -> "YYYY-MM-DDTHH:MM:SS" (UTC), comparable with Roblox's ISO timestamps.
fn iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[tauri::command]
pub async fn game_sales(rb: State<'_, Roblox>, owner_kind: String, owner_id: String, timeframe: String, force: Option<bool>) -> Result<Cached<Sales>, String> {
    let tf = parse_timeframe(&timeframe)?;
    let rb = rb.inner();
    let force = force.unwrap_or(false);
    let base = match owner_kind.as_str() {
        "group" => format!("https://economy.roblox.com/v2/groups/{}/transactions", numeric_id(&owner_id, "group")?),
        "user" => format!("https://economy.roblox.com/v2/users/{}/transactions", rb.me(false).await?.data.id),
        k => return Err(format!("Unknown owner kind '{k}'")),
    };
    let (days, max_pages) = match tf {
        "Day" => (1, 5),
        "Week" => (7, 10),
        "Month" => (30, 20),
        _ => (365, 40),
    };
    let since = iso_utc((now_ms() / 1000).saturating_sub(days * 86_400));

    rb.net
        .cached(&format!("sales:{base}:{tf}"), TTL_SALES, force, || async {
            let mut by_game: BTreeMap<String, SaleGame> = BTreeMap::new();
            let mut products: HashMap<(String, String, String), SaleProduct> = HashMap::new();
            let (mut total, mut count, mut truncated) = (0i64, 0u32, false);
            let mut oldest = None;
            let mut cursor: Option<String> = None;

            'pages: for page_no in 0..max_pages {
                let mut query = vec![("limit", "100".to_string()), ("transactionType", "Sale".to_string())];
                if let Some(c) = &cursor {
                    query.push(("cursor", c.clone()));
                }
                let req = rb.cookie(rb.http().get(&base).query(&query))?;
                let page: TxPage = match rb.net.send(req, Auth::Cookie).await {
                    Ok(p) => p,
                    Err(e) if e.contains("403") => {
                        return Ok(Sales { games: vec![], total: 0, count: 0, truncated: false, oldest: None, note: Some("Your account can't view this group's sales.".into()) });
                    }
                    Err(e) => return Err(e),
                };
                for tx in page.data {
                    if tx.created.as_str() < since.as_str() {
                        break 'pages;
                    }
                    let amount = tx.currency.map(|c| c.amount).unwrap_or(0);
                    let details = tx.details.unwrap_or(TxDetails { name: String::new(), kind: String::new(), place: None });
                    let place = details.place;
                    let game_key = place.as_ref().and_then(|p| p.universe_id.or(p.place_id)).map(|id| id.to_string()).unwrap_or_default();
                    let game = by_game.entry(game_key.clone()).or_insert_with(|| SaleGame {
                        universe_id: place.as_ref().and_then(|p| p.universe_id),
                        place_id: place.as_ref().and_then(|p| p.place_id),
                        name: place.as_ref().map(|p| p.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Not tied to an experience".into()),
                        robux: 0,
                        pending: 0,
                        sales: 0,
                        products: vec![],
                    });
                    game.robux += amount;
                    game.sales += 1;
                    if tx.is_pending {
                        game.pending += amount;
                    }
                    let product = products
                        .entry((game_key, details.kind.clone(), details.name.clone()))
                        .or_insert_with(|| SaleProduct { name: details.name, kind: details.kind, robux: 0, sales: 0 });
                    product.robux += amount;
                    product.sales += 1;
                    total += amount;
                    count += 1;
                    oldest = Some(tx.created);
                }
                match page.next_page_cursor {
                    Some(c) if !c.is_empty() => cursor = Some(c),
                    _ => break,
                }
                if page_no + 1 == max_pages {
                    truncated = true;
                }
            }

            for ((game_key, _, _), p) in products {
                if let Some(g) = by_game.get_mut(&game_key) {
                    g.products.push(p);
                }
            }
            let mut games: Vec<SaleGame> = by_game.into_values().collect();
            for g in &mut games {
                g.products.sort_by(|a, b| b.robux.cmp(&a.robux));
            }
            games.sort_by(|a, b| b.robux.cmp(&a.robux));
            Ok(Sales { games, total, count, truncated, oldest, note: None })
        })
        .await
}

// ---------- Exchange rates ----------

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rates {
    #[serde(alias = "time_last_update_utc")]
    updated: String,
    rates: BTreeMap<String, f64>,
}

/// USD-based fiat rates from open.er-api.com (free, no key, updated daily).
#[tauri::command]
pub async fn exchange_rates(rb: State<'_, Roblox>, force: Option<bool>) -> Result<Cached<Rates>, String> {
    let rb = rb.inner();
    rb.net
        .cached("fx", TTL_RATES, force.unwrap_or(false), || async {
            rb.net.send(rb.http().get("https://open.er-api.com/v6/latest/USD"), Auth::None).await
        })
        .await
}

#[tauri::command]
pub fn clear_cache(rb: State<'_, Roblox>) {
    rb.net.clear_cache();
}

// ---------- Profile ----------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    id: u64,
    name: String,
    display_name: String,
    headshot_url: Option<String>,
    /// True when this is the account the saved login belongs to.
    logged_in: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicUser {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    display_name: String,
}

/// The logged-in account (or the user ID from Settings) with its avatar headshot.
#[tauri::command]
pub async fn profile(rb: State<'_, Roblox>, user_id: String, force: Option<bool>) -> Result<Cached<Profile>, String> {
    let rb = rb.inner();
    let force = force.unwrap_or(false);
    let logged_in = secrets::read(Secret::Cookie).is_some();
    let key = if logged_in { "profile:me".to_string() } else { format!("profile:{}", numeric_id(&user_id, "user")?) };
    rb.net
        .cached(&key, TTL_ME, force, || async {
            let (id, name, display_name, logged_in) = match rb.me(force).await {
                Ok(me) if logged_in => (me.data.id, me.data.name, me.data.display_name, true),
                _ => {
                    let id = numeric_id(&user_id, "user")?;
                    let u: PublicUser = rb.net.send(rb.http().get(format!("https://users.roblox.com/v1/users/{id}")), Auth::None).await?;
                    (u.id, u.name, u.display_name, false)
                }
            };
            let req = rb.http().get("https://thumbnails.roblox.com/v1/users/avatar-headshot").query(&[
                ("userIds", id.to_string().as_str()),
                ("size", "150x150"),
                ("format", "Png"),
                ("isCircular", "false"),
            ]);
            let headshot_url = rb.net.send::<ThumbnailList>(req, Auth::None).await.ok().and_then(|l| l.data.into_iter().next()).and_then(|t| t.image_url);
            Ok(Profile { id, name, display_name, headshot_url, logged_in })
        })
        .await
}

// ---------- Experience analytics (Open Cloud Analytics Query API) ----------

const ANALYTICS: &str = "https://apis.roblox.com/analytics-query-api";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsBreakdown {
    dimension: String,
    value: String,
    #[serde(default)]
    display_value: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsPoint {
    time: String,
    #[serde(default)]
    value: Option<f64>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSeries {
    #[serde(default)]
    breakdowns: Vec<AnalyticsBreakdown>,
    #[serde(default)]
    data_points: Vec<AnalyticsPoint>,
}

#[derive(Deserialize)]
struct AnalyticsResult {
    #[serde(default)]
    values: Vec<AnalyticsSeries>,
}

#[derive(Deserialize)]
struct OperationError {
    #[serde(default)]
    code: Value,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct Operation {
    #[serde(default)]
    path: String,
    #[serde(default)]
    done: bool,
    response: Option<AnalyticsResult>,
    error: Option<OperationError>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsQuery {
    metric: String,
    granularity: String,
    start_time: String,
    end_time: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    breakdown: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    filter: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
}

fn analytics_error(e: String) -> String {
    if e.contains("(401)") || e.contains("(403)") {
        return "The API key can't read this experience's analytics. In Creator Hub → Credentials, edit the key: add the 'universe-analytics' API system with the universe.analytics:read operation, and add this experience to it.".into();
    }
    // "Roblox returned 400 Bad Request: {"done":true,"error":{"code":2001,"message":"..."}}" -> just the message.
    let message = e
        .find('{')
        .and_then(|i| serde_json::from_str::<Value>(&e[i..]).ok())
        .and_then(|v| v.pointer("/error/message").or_else(|| v.get("message")).and_then(Value::as_str).map(str::to_string));
    match message {
        Some(m) if m.contains("unexpected error") => "Roblox couldn't compute this metric with this breakdown. Try a different breakdown.".into(),
        Some(m) => m,
        None => e,
    }
}

/// Run one metrics query, polling the long-running operation until it finishes.
#[tauri::command]
pub async fn analytics_query(rb: State<'_, Roblox>, universe_id: String, query: AnalyticsQuery, force: Option<bool>) -> Result<Cached<Vec<AnalyticsSeries>>, String> {
    let rb = rb.inner();
    let universe_id = numeric_id(&universe_id, "universe")?;
    let fine = matches!(query.granularity.as_str(), "OneMinute" | "HalfHour" | "OneHour");
    let ttl = Duration::from_secs(if fine { 5 * MIN } else { 60 * MIN });
    let key = format!("an:{universe_id}:{}", serde_json::to_string(&query).unwrap_or_default());

    rb.net
        .cached(&key, ttl, force.unwrap_or(false), || async {
            let req = rb.api_key(rb.http().post(format!("{ANALYTICS}/v1/universes/{universe_id}/metrics")).json(&query))?;
            let mut op: Operation = rb.net.send(req, Auth::ApiKey).await.map_err(analytics_error)?;
            let mut wait = 800u64;
            let deadline = Instant::now() + Duration::from_secs(60);
            while !op.done {
                if Instant::now() >= deadline {
                    return Err("Roblox is still computing this metric. Try again in a moment.".into());
                }
                tokio::time::sleep(Duration::from_millis(wait)).await;
                wait = (wait * 3 / 2).min(4000);
                let req = rb.api_key(rb.http().get(format!("{ANALYTICS}/{}", op.path.trim_start_matches('/'))))?;
                op = rb.net.send(req, Auth::ApiKey).await.map_err(analytics_error)?;
            }
            if let Some(err) = op.error {
                return Err(format!("Analytics error {}: {}", err.code, err.message));
            }
            Ok(op.response.map(|r| r.values).unwrap_or_default())
        })
        .await
}

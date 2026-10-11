import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Gamepad2, LayoutDashboard, LineChart, LogIn, RefreshCw, Search, Settings as SettingsIcon, UserRound, Users, Wallet } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Button } from "@/components/arc/button/button";
import { ContextMenuProvider, useContextMenu } from "@/components/ContextMenu";
import { QuickSwitcher, type ViewEntry } from "@/components/QuickSwitcher";
import { Titlebar } from "@/components/Titlebar";
import { Freshness, Thumb } from "@/components/ui";
import type { Game, GroupSummary, OwnerRef, Timeframe } from "@/lib/api";
import { DataProvider, useData } from "@/lib/data";
import { compact } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { NavContext, useNav, type Nav, type View } from "@/lib/nav";
import { usePrefs, type ItemId } from "@/lib/prefs";
import { useSettings } from "@/lib/settings";
import { copy, useToast } from "@/lib/toast";
import { RefreshProvider } from "@/lib/useLoad";
import { useReorder } from "@/lib/useReorder";
import { Overview } from "@/views/Overview";
import { Funds } from "@/views/Funds";
import { Analytics, focusAnalytics } from "@/views/Analytics";
import { Groups } from "@/views/Groups";
import { SettingsView } from "@/views/Settings";
import { Detail } from "@/views/Detail";
import { Payout } from "@/views/Payout";
import "./App.css";
import "./shell.css";

export const TIMEFRAMES = [
  { value: "Day", label: "Day" },
  { value: "Week", label: "Week" },
  { value: "Month", label: "Month" },
  { value: "Year", label: "Year" },
];

const NAV: { view: View; label: string; icon: typeof Wallet }[] = [
  { view: "overview", label: "Overview", icon: LayoutDashboard },
  { view: "funds", label: "Funds", icon: Wallet },
  { view: "analytics", label: "Analytics", icon: LineChart },
  { view: "groups", label: "Groups", icon: Users },
  { view: "settings", label: "Settings", icon: SettingsIcon },
];

/** Views whose numbers follow the Day/Week/Month/Year timeframe (Analytics has its own range). */
const USES_TIMEFRAME: View[] = ["overview", "funds"];

export default function App() {
  const [refresh, setRefresh] = useState(0);
  return (
    <RefreshProvider value={refresh}>
      <DataProvider>
        <ContextMenuProvider>
          <Shell onRefresh={() => setRefresh(r => r + 1)} />
        </ContextMenuProvider>
      </DataProvider>
    </RefreshProvider>
  );
}

function Shell({ onRefresh }: { onRefresh: () => void }) {
  const [view, setView] = useState<View>("overview");
  const [openItem, setOpenItem] = useState<ItemId | null>(null);
  const [payoutGroup, setPayoutGroup] = useState<string | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const [settings, updateSettings] = useSettings();
  const data = useData();
  const ready = !!settings.userId;
  const busy = data.groups.loading || data.funds.loading || data.me.loading || data.games.loading;
  const current = NAV.find(n => n.view === view)!;

  const nav: Nav = useMemo(
    () => ({
      view,
      go: setView,
      open: setOpenItem,
      analytics: (owner: OwnerRef | null, universeId: number | null = null) => {
        focusAnalytics(owner, universeId);
        setOpenItem(null);
        setView("analytics");
      },
      payout: (groupId: string) => {
        setOpenItem(null);
        setPayoutGroup(groupId);
      },
      switcher: () => setSwitcher(true),
    }),
    [view],
  );

  // Ctrl+K quick switcher, Ctrl+R refresh (instead of reloading the page), Ctrl+1..5 pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setSwitcher(s => !s);
      } else if (k === "r") {
        e.preventDefault();
        if (ready) onRefresh();
      } else if (/^[1-5]$/.test(k)) {
        e.preventDefault();
        setView(NAV[Number(k) - 1].view);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRefresh, ready]);

  const views: ViewEntry[] = useMemo(() => NAV.map(n => ({ view: n.view, label: n.label, icon: <n.icon size={15} /> })), []);

  return (
    <NavContext.Provider value={nav}>
      <div className="app-root">
        <Titlebar
          center={
            <span className="titlebar-page" data-tauri-drag-region>
              <current.icon size={13} /> {current.label}
            </span>
          }
          right={
            <>
              <button type="button" className="titlebar-search" onClick={() => setSwitcher(true)} title="Quick switcher (Ctrl+K)">
                <Search size={12} />
                <span>Search</span>
                <kbd>Ctrl K</kbd>
              </button>
              {ready && (
                <button type="button" className="titlebar-btn" onClick={onRefresh} disabled={busy} title="Fetch fresh data from Roblox (Ctrl+R)" aria-label="Refresh">
                  <RefreshCw size={14} className={busy ? "spin" : ""} />
                </button>
              )}
            </>
          }
        />
        <div className="shell">
          <Sidebar />
          <main className="main">
            <div className="main-inner">
              <header className="topbar">
                <h1>{current.label}</h1>
                {ready && USES_TIMEFRAME.includes(view) && (
                  <div className="topbar-actions">
                    <Freshness load={data.groups} />
                    <SegmentedControl label="Timeframe" options={TIMEFRAMES} value={settings.timeframe} onValueChange={v => updateSettings({ timeframe: v as Timeframe })} />
                  </div>
                )}
              </header>
              {!ready && view !== "settings" ? (
                <SetupPrompt onOpen={() => setView("settings")} />
              ) : view === "overview" ? (
                <Overview />
              ) : view === "funds" ? (
                <Funds />
              ) : view === "analytics" ? (
                <Analytics />
              ) : view === "groups" ? (
                <Groups />
              ) : (
                <SettingsView />
              )}
            </div>
          </main>
        </div>
      </div>
      <Detail item={openItem} onClose={() => setOpenItem(null)} />
      <Payout groupId={payoutGroup} onClose={() => setPayoutGroup(null)} />
      <QuickSwitcher open={switcher} onClose={() => setSwitcher(false)} views={views} />
      <Toast />
    </NavContext.Provider>
  );
}

function Toast() {
  const [t] = useToast();
  return (
    <div className="toast-region" aria-live="polite">
      {t.text && (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      )}
    </div>
  );
}

function ProfileCard() {
  const { profile, hasCookie } = useData();
  const { go } = useNav();
  const menu = useContextMenu();
  const p = profile.data;
  return (
    <button
      type="button"
      className="profile"
      onClick={() => go("settings")}
      title="Account settings"
      onContextMenu={e =>
        menu(e, [
          { label: "Account settings", icon: <SettingsIcon size={15} />, onSelect: () => go("settings") },
          { label: hasCookie ? "Log in again" : "Log in with Roblox", icon: <LogIn size={15} />, onSelect: () => go("settings") },
          ...(p
            ? [
                "separator" as const,
                { label: "Open my profile", icon: <ExternalLink size={15} />, onSelect: () => openUrl(`https://www.roblox.com/users/${p.id}/profile`) },
                { label: "Copy user ID", icon: <Copy size={15} />, hint: String(p.id), onSelect: () => copy(String(p.id), "user ID") },
              ]
            : []),
        ])
      }
    >
      <span className="profile-avatar">
        {p?.headshotUrl ? <img src={p.headshotUrl} alt="" /> : <UserRound size={20} />}
        <span className={`profile-status ${hasCookie ? "is-on" : ""}`} title={hasCookie ? "Logged in" : "Not logged in"} />
      </span>
      <span className="profile-text">
        <strong className="truncate">{p ? p.displayName || p.name : profile.loading ? "Loading…" : "Not connected"}</strong>
        <span className="muted small truncate">{p ? `@${p.name}` : "Log in from Settings"}</span>
      </span>
    </button>
  );
}

function Sidebar() {
  const { prefs, setPins } = usePrefs();
  const { groupById, gameById, groups, funds, hasCookie } = useData();
  const menus = useMenus();
  const menu = useContextMenu();
  const nav = useNav();

  type Entry = { name: string; icon: string | null; meta: string; group: GroupSummary | null; game: Game | null };
  const entries = new Map<ItemId, Entry>();
  for (const id of prefs.pins) {
    const [kind, key] = id.split(":");
    if (kind === "group") {
      const g = groupById.get(key);
      const bal = funds.data?.[key]?.finance?.balance;
      if (g) entries.set(id, { name: g.name, icon: g.iconUrl, meta: bal != null ? `R$ ${compact(bal)}` : g.roleName, group: g, game: null });
    } else {
      const game = gameById.get(Number(key));
      if (game) entries.set(id, { name: game.name, icon: game.iconUrl, meta: `${compact(game.playing)} playing`, group: null, game });
    }
  }
  const shown = prefs.pins.filter(id => entries.has(id));
  // Reorder only the pins that are showing, keeping any not-yet-loaded ones at the end.
  const { order, bind } = useReorder(shown, next => setPins([...next, ...prefs.pins.filter(id => !entries.has(id))]));

  return (
    <nav className="sidebar" aria-label="Main">
      <ProfileCard />
      <ul className="nav">
        {NAV.map((n, i) => (
          <li key={n.view}>
            <button type="button" className={`nav-item ${nav.view === n.view ? "is-active" : ""}`} aria-current={nav.view === n.view ? "page" : undefined} onClick={() => nav.go(n.view)} title={`${n.label} (Ctrl+${i + 1})`}>
              <n.icon size={16} />
              <span>{n.label}</span>
              {n.view === "groups" && groups.data && <span className="nav-count">{groups.data.length}</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="nav-section">
        <span className="nav-label">Pinned</span>
        {order.length ? (
          <ul className="nav pin-list">
            {order.map(id => {
              const p = entries.get(id)!;
              return (
                <li key={id} {...bind(id)}>
                  <button
                    type="button"
                    className="nav-item nav-pin"
                    onClick={() => nav.open(id)}
                    title={`${p.name} · drag to reorder`}
                    onContextMenu={e => menu(e, p.group ? menus.group(p.group) : menus.game(p.game!))}
                  >
                    <Thumb src={p.icon} name={p.name} size={24} />
                    <span className="nav-pin-text">
                      <span className="truncate">{p.name}</span>
                      <span className="muted small truncate">{p.meta}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small nav-hint">Right-click any group or game and choose Pin. Pinned items show here and on the overview.</p>
        )}
      </div>

      <div className="sidebar-foot">
        <span className={`dot ${hasCookie ? "dot-on" : ""}`} />
        <span className="muted small">{hasCookie ? "Revenue on" : "Revenue off · log in to enable"}</span>
      </div>
    </nav>
  );
}

function SetupPrompt({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="panel hero">
      <span className="brand-mark big"><Gamepad2 size={26} /></span>
      <h2>Connect your Roblox account</h2>
      <p className="muted">Log in with Roblox (or enter your user ID) to see your groups, games and funds.</p>
      <Button onClick={onOpen}>Open Settings</Button>
    </section>
  );
}

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowDownRight, ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, Hash, KeyRound, LineChart, Maximize2, Pin, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Table2, Trash2, X } from "lucide-react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Button } from "@/components/arc/button/button";
import { useContextMenu } from "@/components/ContextMenu";
import { Sparkline, TimeChart } from "@/components/TimeChart";
import { Alert, Empty, Freshness, PinButton, Rating, Skeleton, Thumb } from "@/components/ui";
import { DIMENSION_LABELS, METRIC, METRICS, RANGES, fetchMetric, formatValue, percentScale, summarise, type MetricDef, type Range } from "@/lib/analytics";
import { api, type Game, type GroupSummary, type OwnerRef } from "@/lib/api";
import { useData } from "@/lib/data";
import { compact } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useNav } from "@/lib/nav";
import { gameItem, groupItem, usePrefs } from "@/lib/prefs";
import { useSettings } from "@/lib/settings";
import { createStore } from "@/lib/store";
import { useCached } from "@/lib/useLoad";
import { useReorder } from "@/lib/useReorder";
import "./Analytics.css";

type ChartKind = "stat" | "line" | "bar";
type Size = "s" | "m" | "l";

interface Widget {
  id: string;
  metric: string;
  chart: ChartKind;
  breakdown: string | null;
  size: Size;
}

const w = (metric: string, chart: ChartKind, size: Size, breakdown: string | null = null): Widget => ({
  id: `${metric}-${Math.random().toString(36).slice(2, 9)}`,
  metric,
  chart,
  size,
  breakdown,
});

const DEFAULT_WIDGETS: Widget[] = [
  w("DailyActiveUsers", "stat", "s"),
  w("AveragePlayTimeMinutesPerDAU", "stat", "s"),
  w("ForwardD1Retention", "stat", "s"),
  w("DailyRevenue", "stat", "s"),
  w("DailyActiveUsers", "line", "l"),
  w("ForwardD1Retention", "line", "m"),
  w("ForwardD7Retention", "line", "m"),
  w("DailyRevenue", "line", "m", "RevenueSource"),
  w("AverageSessionLengthMinutes", "line", "m"),
  w("PeakConcurrentPlayers", "line", "m"),
  w("ClientCrashRate15m", "line", "m", "Platform"),
];

const useAnalyticsPrefs = createStore<{ owner: OwnerRef | null; universeId: number | null; range: Range; widgets: Widget[] }>("groupwise.analytics", {
  owner: null,
  universeId: null,
  range: "28d",
  widgets: DEFAULT_WIDGETS,
});

/** Select a group (and optionally one of its games) in Analytics, e.g. from a right-click menu. */
export const focusAnalytics = (owner: OwnerRef | null, universeId: number | null = null) => useAnalyticsPrefs.set({ owner, universeId });

const sameOwner = (a: OwnerRef | null, b: OwnerRef | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;

/** Games of one owner: from the shared list when the owner is tracked, otherwise loaded on demand. */
function useOwnerGames(owner: OwnerRef | null, enabled = true): { data: Game[] | null; loading: boolean; error: string | null } {
  const { owners, games, hidden } = useData();
  const tracked = owners.some(o => sameOwner(o, owner));
  const own = useCached(force => api.listGames([owner!], force), [owner], !!owner && !tracked && enabled);
  const visible = (list: Game[] | null) => list?.filter(g => !hidden(gameItem(g.universeId))) ?? null;
  if (!owner) return { data: null, loading: false, error: null };
  if (tracked) return { data: visible(games.data?.filter(g => g.ownerKind === owner.kind && g.ownerId === owner.id) ?? null), loading: games.loading, error: games.error };
  return { data: visible(own.data), loading: own.loading, error: own.error };
}

export function Analytics() {
  const [p, update] = useAnalyticsPrefs();
  const { status, ownerName, gameById } = useData();
  const { go } = useNav();
  const hasKey = !!status.data?.hasApiKey;

  const ownerGames = useOwnerGames(p.owner);
  const game = p.universeId != null ? (ownerGames.data?.find(g => g.universeId === p.universeId) ?? gameById.get(p.universeId) ?? null) : null;
  const select = (owner: OwnerRef | null, universeId: number | null = null) => update({ owner, universeId });

  if (!hasKey) {
    return (
      <section className="panel">
        <Empty icon={<KeyRound size={18} />} title="Add an Open Cloud API key for analytics" action={<Button onClick={() => go("settings")}>Open Settings</Button>}>
          Game analytics come from Roblox's Open Cloud Analytics API. Create a key in Creator Hub → Credentials, add the <b>universe-analytics</b> API system with <b>universe.analytics:read</b>, and add the experiences you want to see.
        </Empty>
      </section>
    );
  }

  return (
    <div className="an-layout">
      <Explorer selected={p} onSelect={select} />
      <div className="stack an-main">
        <div className="toolbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            <button type="button" className={!p.owner && !game ? "is-current" : ""} onClick={() => select(null)}>
              All
            </button>
            {p.owner && (
              <>
                <ChevronRight size={14} />
                <button type="button" className={!game ? "is-current" : ""} onClick={() => select(p.owner)}>
                  {ownerName(p.owner)}
                </button>
              </>
            )}
            {game && (
              <>
                <ChevronRight size={14} />
                <span className="is-current truncate">{game.name}</span>
              </>
            )}
          </nav>
          <SegmentedControl label="Range" options={RANGES.map(r => ({ value: r.value, label: r.label }))} value={p.range} onValueChange={v => update({ range: v as Range })} />
        </div>

        {game ? (
          <GameDashboard key={game.universeId} game={game} />
        ) : p.owner ? (
          <OwnerGames owner={p.owner} games={ownerGames} range={p.range} onOpen={g => select(p.owner, g.universeId)} />
        ) : (
          <Home range={p.range} onSelect={select} />
        )}
      </div>
    </div>
  );
}

/** Left column: pinned items, then every group with its games underneath. */
function Explorer({ selected, onSelect }: { selected: { owner: OwnerRef | null; universeId: number | null }; onSelect: (o: OwnerRef | null, u?: number | null) => void }) {
  const [settings] = useSettings();
  const { groups, gameById, groupById, profile, hidden } = useData();
  const { prefs, isPinned, setPins } = usePrefs();
  const [query, setQuery] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const { games } = useData();
  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  // Pinned, in your pin order; drag to reorder (pins that haven't loaded keep their place at the end).
  const pinned = prefs.pins.filter(id => (id.startsWith("game:") ? gameById.has(Number(id.slice(5))) : groupById.has(id.slice(6))));
  const { order, bind } = useReorder(pinned, next => setPins([...next, ...prefs.pins.filter(id => !pinned.includes(id))]));

  const visibleGroups = (groups.data ?? []).filter(g => !hidden(groupItem(g.id)) && !isPinned(groupItem(g.id)));
  const gameCount = (id: string) => (games.data ?? []).filter(x => x.ownerKind === "group" && x.ownerId === id).length;
  const owned = visibleGroups.filter(g => g.isOwner && (!games.data || gameCount(g.id) > 0));
  const ownedEmpty = visibleGroups.filter(g => g.isOwner && games.data && gameCount(g.id) === 0);
  const others = visibleGroups.filter(g => !g.isOwner);

  const row = (g: GroupSummary) => (
    <OwnerRow key={g.id} owner={{ kind: "group", id: g.id }} group={g} name={g.name} icon={g.iconUrl} selected={selected} onSelect={onSelect} query={q} pinned={isPinned(groupItem(g.id))} />
  );
  const fold = (label: string, open: boolean, toggle: () => void, items: GroupSummary[]) =>
    items.length > 0 && (
      <div className="ex-section">
        <button type="button" className="nav-label ex-toggle" onClick={toggle} aria-expanded={open || !!q}>
          <ChevronRight size={12} className={open || q ? "rot" : ""} /> {label} ({items.length})
        </button>
        {(open || q) && items.filter(g => match(g.name)).map(row)}
      </div>
    );

  return (
    <aside className="explorer panel">
      <label className="search">
        <Search size={15} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search groups and games" />
      </label>

      {order.length > 0 && (
        <div className="ex-section">
          <span className="nav-label">Pinned</span>
          {order.map(id => {
            const game = id.startsWith("game:") ? gameById.get(Number(id.slice(5))) : null;
            const group = id.startsWith("group:") ? groupById.get(id.slice(6)) : null;
            if (game ? !match(game.name) : !group || !match(group.name)) return null;
            return (
              <div key={id} className="ex-drag" {...bind(id)}>
                {game ? (
                  <GameRow game={game} selected={selected.universeId === game.universeId} onClick={() => onSelect({ kind: game.ownerKind, id: game.ownerId }, game.universeId)} />
                ) : (
                  row(group!)
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="ex-section">
        <span className="nav-label">Your groups</span>
        {settings.userId && match("Personal") && (
          <OwnerRow owner={{ kind: "user", id: settings.userId }} name="Personal" icon={profile.data?.headshotUrl ?? null} selected={selected} onSelect={onSelect} query={q} round />
        )}
        {owned.filter(g => match(g.name)).map(row)}
        {!owned.length && !ownedEmpty.length && !groups.loading && <p className="muted small ex-hint">You don't own any groups.</p>}
      </div>

      {fold("Owned, no games", showEmpty, () => setShowEmpty(s => !s), ownedEmpty)}
      {fold("Other groups", showOthers, () => setShowOthers(s => !s), others)}
    </aside>
  );
}

function OwnerRow({ owner, group, name, icon, selected, onSelect, query, pinned, round }: {
  owner: OwnerRef;
  group?: GroupSummary;
  name: string;
  icon: string | null;
  selected: { owner: OwnerRef | null; universeId: number | null };
  onSelect: (o: OwnerRef | null, u?: number | null) => void;
  query: string;
  pinned?: boolean;
  round?: boolean;
}) {
  const menu = useContextMenu();
  const menus = useMenus();
  const isSelected = sameOwner(selected.owner, owner);
  const [open, setOpen] = useState(isSelected);
  const games = useOwnerGames(owner, open);
  const shown = (games.data ?? []).filter(g => !query || g.name.toLowerCase().includes(query) || name.toLowerCase().includes(query));

  return (
    <div className="ex-owner">
      <div className={`ex-row ${isSelected && selected.universeId == null ? "is-active" : ""}`} onContextMenu={e => group && menu(e, menus.group(group))}>
        <button type="button" className="ex-caret" aria-label={open ? `Collapse ${name}` : `Expand ${name}`} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <ChevronRight size={13} className={open ? "rot" : ""} />
        </button>
        <button type="button" className="ex-main" onClick={() => { onSelect(owner); setOpen(true); }} title={name}>
          <span className={round ? "round-thumb" : undefined}><Thumb src={icon} name={name} size={22} /></span>
          <span className="truncate">{name}</span>
          {pinned && <Pin size={11} className="ex-pin" />}
          {games.data && games.data.length > 0 && <span className="nav-count">{games.data.length}</span>}
        </button>
      </div>
      {open && (
        <div className="ex-children">
          {games.loading && !games.data ? (
            <span className="muted small ex-hint">Loading…</span>
          ) : shown.length ? (
            shown.map(g => <GameRow key={g.universeId} game={g} selected={selected.universeId === g.universeId} onClick={() => onSelect(owner, g.universeId)} />)
          ) : (
            <span className="muted small ex-hint">{games.error ?? "No public games"}</span>
          )}
        </div>
      )}
    </div>
  );
}

function GameRow({ game, selected, onClick }: { game: Game; selected: boolean; onClick: () => void }) {
  const menu = useContextMenu();
  const menus = useMenus();
  return (
    <button type="button" className={`ex-row ex-game ${selected ? "is-active" : ""}`} onClick={onClick} title={game.name} onContextMenu={e => menu(e, menus.game(game))}>
      <Thumb src={game.iconUrl} name={game.name} size={20} />
      <span className="truncate">{game.name}</span>
      {game.playing > 0 && <span className="nav-count live" title={`${game.playing} playing now`}>{compact(game.playing)}</span>}
    </button>
  );
}

/** Nothing selected: pinned games, then your groups. */
function Home({ range, onSelect }: { range: Range; onSelect: (o: OwnerRef | null, u?: number | null) => void }) {
  const { prefs } = usePrefs();
  const { gameById, groups, owners, ownerName, games } = useData();
  const pinnedGames = prefs.pins.filter(id => id.startsWith("game:")).map(id => gameById.get(Number(id.slice(5)))).filter((g): g is Game => !!g);
  const groupOwners = owners.filter(o => o.kind === "group" || (games.data ?? []).some(g => g.ownerKind === "user"));

  return (
    <>
      <section>
        <div className="section-head"><h3>Pinned games</h3></div>
        {pinnedGames.length ? (
          <div className="card-grid">
            {pinnedGames.map(g => <GameCard key={g.universeId} game={g} range={range} onOpen={() => onSelect({ kind: g.ownerKind, id: g.ownerId }, g.universeId)} />)}
          </div>
        ) : (
          <p className="muted small">Pin games with the pin button to keep them here.</p>
        )}
      </section>
      <section>
        <div className="section-head"><h3>Your groups</h3></div>
        <div className="card-grid">
          {groupOwners.map(o => {
            const g = o.kind === "group" ? groups.data?.find(x => x.id === o.id) : null;
            const count = (games.data ?? []).filter(x => x.ownerKind === o.kind && x.ownerId === o.id).length;
            const playing = (games.data ?? []).filter(x => x.ownerKind === o.kind && x.ownerId === o.id).reduce((s, x) => s + x.playing, 0);
            return (
              <button type="button" key={`${o.kind}:${o.id}`} className="tile owner-tile" onClick={() => onSelect(o)}>
                <div className="tile-head">
                  <Thumb src={g?.iconUrl} name={ownerName(o)} size={36} />
                  <div className="tile-title">
                    <strong className="truncate">{ownerName(o)}</strong>
                    <span className="muted small">{count} {count === 1 ? "game" : "games"} · {compact(playing)} playing</span>
                  </div>
                  <ChevronRight size={16} className="muted" />
                </div>
              </button>
            );
          })}
        </div>
        <p className="muted small">Groups you own or pin are listed here. Every other group is in the list on the left.</p>
      </section>
    </>
  );
}

function OwnerGames({ owner, games, range, onOpen }: { owner: OwnerRef; games: { data: Game[] | null; loading: boolean; error: string | null }; range: Range; onOpen: (g: Game) => void }) {
  const { ownerName } = useData();
  const { isPinned } = usePrefs();
  if (games.error) return <Alert>{games.error}</Alert>;
  if (!games.data) return <Skeleton rows={3} />;
  if (!games.data.length) {
    return (
      <section className="panel">
        <Empty icon={<LineChart size={18} />} title={`${ownerName(owner)} has no public games`} />
      </section>
    );
  }
  const sorted = [...games.data].sort((a, b) => Number(isPinned(gameItem(b.universeId))) - Number(isPinned(gameItem(a.universeId))) || b.playing - a.playing || b.visits - a.visits);
  return (
    <div className="card-grid">
      {sorted.map(g => <GameCard key={g.universeId} game={g} range={range} onOpen={() => onOpen(g)} />)}
    </div>
  );
}

/** Game card with a daily-active-users trend, so you can compare a group's games at a glance. */
function GameCard({ game, range, onOpen }: { game: Game; range: Range; onOpen: () => void }) {
  const menu = useContextMenu();
  const menus = useMenus();
  const def = METRIC.get("DailyActiveUsers")!;
  const load = useCached(force => fetchMetric(game.universeId, def, range, null, force), [game.universeId, range, "card"]);
  const line = load.data?.lines[0];
  const current = line ? summarise(line.points.map(p => p.v), def.agg) : null;
  const previous = load.data?.previous ? summarise(load.data.previous, def.agg) : null;
  const delta = current != null && previous ? (current - previous) / previous : null;

  return (
    <article className="tile game-tile" onClick={onOpen} onContextMenu={e => menu(e, menus.game(game))}>
      <div className="tile-head">
        <Thumb src={game.iconUrl} name={game.name} size={40} />
        <div className="tile-title">
          <strong className="truncate">{game.name}</strong>
          <span className="muted small">{compact(game.playing)} playing · {compact(game.visits)} visits<Rating game={game} prefix=" · " /></span>
        </div>
        <PinButton id={gameItem(game.universeId)} label={game.name} />
      </div>
      <div className="game-tile-stat">
        <div>
          <span className="muted small">Avg daily users</span>
          <div className="widget-figure">
            <strong>{load.error ? "—" : formatValue(current, "count")}</strong>
            {delta != null && (
              <span className={`delta ${delta > 0 ? "is-good" : delta < 0 ? "is-bad" : ""}`}>
                {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {Math.abs(delta * 100).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {line && <Sparkline values={line.points.map(p => p.v)} height={34} />}
      </div>
      {load.error && <span className="muted small">{isUnavailable(load.error) ? "No analytics for this game" : "Analytics unavailable"}</span>}
    </article>
  );
}

function GameDashboard({ game }: { game: Game }) {
  const [p, update] = useAnalyticsPrefs();
  const { ownerName } = useData();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const setWidgets = (fn: (ws: Widget[]) => Widget[]) => update(s => ({ widgets: fn(s.widgets) }));
  const patch = (id: string, change: Partial<Widget>) => setWidgets(ws => ws.map(x => (x.id === id ? { ...x, ...change } : x)));
  const move = (id: string, by: number) =>
    setWidgets(ws => {
      const i = ws.findIndex(x => x.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= ws.length) return ws;
      const next = [...ws];
      next.splice(j, 0, ...next.splice(i, 1));
      return next;
    });

  return (
    <>
      <div className="game-head">
        <Thumb src={game.iconUrl} name={game.name} size={48} />
        <div className="detail-title">
          <h2 className="truncate">{game.name}</h2>
          <span className="muted small">
            {ownerName({ kind: game.ownerKind, id: game.ownerId })} · {compact(game.playing)} playing now · {compact(game.visits)} visits<Rating game={game} prefix=" · " />
          </span>
        </div>
        <span className="grow" />
        <PinButton id={gameItem(game.universeId)} label={game.name} />
        <Button size="sm" variant="ghost" onClick={() => openUrl(`https://create.roblox.com/dashboard/creations/experiences/${game.universeId}/analytics`)}>
          Creator Hub <ArrowUpRight size={14} />
        </Button>
        <Button size="sm" variant={editing ? "primary" : "secondary"} onClick={() => setEditing(e => !e)}>
          <SlidersHorizontal size={14} /> {editing ? "Done" : "Customise"}
        </Button>
      </div>

      {editing && (
        <div className="edit-bar">
          <span className="muted small">Change a widget's chart, breakdown and size, reorder it with the arrows, or remove it. The layout applies to every game.</span>
          <span className="grow" />
          <Button size="sm" variant="ghost" onClick={() => update({ widgets: DEFAULT_WIDGETS })}>
            <RotateCcw size={14} /> Reset layout
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add widget
          </Button>
        </div>
      )}

      <div className="widget-grid">
        {p.widgets.map((wd, i) => {
          const def = METRIC.get(wd.metric);
          if (!def) return null;
          return (
            <WidgetCard
              key={wd.id}
              widget={wd}
              def={def}
              universeId={game.universeId}
              range={p.range}
              editing={editing}
              first={i === 0}
              last={i === p.widgets.length - 1}
              onPatch={c => patch(wd.id, c)}
              onMove={by => move(wd.id, by)}
              onRemove={() => setWidgets(ws => ws.filter(x => x.id !== wd.id))}
            />
          );
        })}
        {editing && (
          <button type="button" className="widget widget-add size-s" onClick={() => setAdding(true)}>
            <Plus size={18} /> Add widget
          </button>
        )}
      </div>

      <p className="muted small">
        From Roblox's Open Cloud Analytics API (beta). Daily metrics stop at the last full UTC day; performance metrics are kept for 28 days and only exist for experiences with enough players. Unit-less values are shown as Roblox reports them.
      </p>

      <AddWidget open={adding} onClose={() => setAdding(false)} onAdd={def => setWidgets(ws => [...ws, w(def.id, "line", "m")])} />
    </>
  );
}

/** Roblox's answer when a metric isn't computed for an experience (common for performance metrics on small games). */
const isUnavailable = (e: string) => /not available/i.test(e);

function WidgetCard({ widget, def, universeId, range, editing, first, last, onPatch, onMove, onRemove }: {
  widget: Widget;
  def: MetricDef;
  universeId: number;
  range: Range;
  editing: boolean;
  first: boolean;
  last: boolean;
  onPatch: (c: Partial<Widget>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [table, setTable] = useState(false);
  const menu = useContextMenu();
  const breakdown = widget.chart === "stat" ? null : widget.breakdown;
  const load = useCached(force => fetchMetric(universeId, def, range, breakdown, force), [universeId, def.id, range, breakdown]);
  const r = load.data;

  const scale = def.unit === "percent" && r ? percentScale(r.lines) : 1;
  const total = r && !breakdown ? r.lines[0] : null;
  const current = total ? summarise(total.points.map(p => p.v), def.agg) : null;
  const previous = r?.previous ? summarise(r.previous, def.agg) : null;
  const delta = current != null && previous != null && previous !== 0 ? (current - previous) / Math.abs(previous) : null;
  const good = delta == null ? null : delta === 0 ? null : (delta > 0) === def.upIsGood;
  const aggLabel = def.agg === "sum" ? "total" : def.agg === "max" ? "peak" : "average";

  const body = !r ? (
    load.error ? (
      isUnavailable(load.error) ? (
        <p className="muted small">Roblox doesn't report this metric for this experience yet. Performance metrics usually need more players.</p>
      ) : (
        <p className="widget-error">{load.error}</p>
      )
    ) : (
      <div className="widget-loading" />
    )
  ) : !r.lines.some(l => l.points.some(p => p.v != null)) ? (
    <p className="muted small">No data for this period.</p>
  ) : table ? (
    <DataTable lines={r.lines} fmt={v => formatValue(v, def.unit, scale)} />
  ) : widget.chart === "stat" ? (
    <Sparkline values={total?.points.map(p => p.v) ?? []} height={36} />
  ) : (
    <TimeChart lines={r.lines} unit={def.unit} scale={scale} kind={widget.chart === "bar" ? "bar" : "line"} granularity={r.window.granularity} height={widget.size === "l" ? 220 : 170} />
  );

  return (
    <article
      className={`widget size-${widget.size} ${widget.chart === "stat" ? "is-stat" : ""}`}
      onContextMenu={e =>
        menu(e, [
          ...(["stat", "line", "bar"] as ChartKind[])
            .filter(k => k !== widget.chart)
            .map(k => ({
              label: k === "stat" ? "Show as number" : k === "line" ? "Show as line chart" : "Show as columns",
              icon: k === "stat" ? <Hash size={15} /> : k === "line" ? <LineChart size={15} /> : <BarChart3 size={15} />,
              onSelect: () => onPatch({ chart: k, size: k === "stat" ? "s" : widget.size === "s" ? "m" : widget.size }),
            })),
          ...(widget.chart !== "stat" ? [{ label: table ? "Show chart" : "Show table", icon: <Table2 size={15} />, onSelect: () => setTable(t => !t) }] : []),
          "separator",
          ...(["s", "m", "l"] as Size[])
            .filter(z => z !== widget.size && !(widget.chart !== "stat" && z === "s"))
            .map(z => ({ label: z === "s" ? "Small" : z === "m" ? "Medium" : "Wide", icon: <Maximize2 size={15} />, onSelect: () => onPatch({ size: z }) })),
          { label: "Move earlier", icon: <ChevronLeft size={15} />, disabled: first, onSelect: () => onMove(-1) },
          { label: "Move later", icon: <ChevronRight size={15} />, disabled: last, onSelect: () => onMove(1) },
          "separator",
          { label: "Refresh", icon: <RefreshCw size={15} />, onSelect: load.reload },
          { label: "Remove widget", icon: <Trash2 size={15} />, danger: true, onSelect: onRemove },
        ])
      }
    >
      <header className="widget-head">
        <div className="widget-title">
          <span className="widget-label">{def.label}</span>
          <span className="muted small">
            {breakdown ? `by ${DIMENSION_LABELS[breakdown] ?? breakdown}` : `${aggLabel} · ${def.category}`}
            {r?.window.note ? ` · ${r.window.note}` : ""}
          </span>
        </div>
        {!editing && widget.chart !== "stat" && r && (
          <button type="button" className="icon-btn" title={table ? "Show chart" : "Show table"} aria-label={table ? "Show chart" : "Show table"} onClick={() => setTable(t => !t)}>
            {table ? <LineChart size={14} /> : <Table2 size={14} />}
          </button>
        )}
      </header>

      {!breakdown && (
        <div className="widget-figure">
          <strong>{r ? formatValue(current, def.unit, scale) : load.error ? "—" : "…"}</strong>
          {delta != null && (
            <span className={`delta ${good === true ? "is-good" : good === false ? "is-bad" : ""}`} title="Compared with the previous period">
              {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {Math.abs(delta * 100).toFixed(1)}%
            </span>
          )}
        </div>
      )}

      <div className="widget-body">{body}</div>

      <footer className="widget-foot">
        <Freshness load={load} />
      </footer>

      {editing && (
        <div className="widget-edit">
          <select value={widget.chart} onChange={e => onPatch({ chart: e.target.value as ChartKind, size: e.target.value === "stat" ? "s" : widget.size === "s" ? "m" : widget.size })} aria-label="Chart type">
            <option value="stat">Number</option>
            <option value="line">Line</option>
            <option value="bar">Columns</option>
          </select>
          {widget.chart !== "stat" && def.breakdowns.length > 0 && (
            <select value={widget.breakdown ?? ""} onChange={e => onPatch({ breakdown: e.target.value || null })} aria-label="Break down by">
              <option value="">No breakdown</option>
              {def.breakdowns.map(d => (
                <option key={d} value={d}>By {DIMENSION_LABELS[d] ?? d}</option>
              ))}
            </select>
          )}
          <select value={widget.size} onChange={e => onPatch({ size: e.target.value as Size })} aria-label="Size">
            <option value="s">Small</option>
            <option value="m">Medium</option>
            <option value="l">Wide</option>
          </select>
          <span className="grow" />
          <button type="button" className="icon-btn" aria-label="Move earlier" disabled={first} onClick={() => onMove(-1)}><ChevronLeft size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Move later" disabled={last} onClick={() => onMove(1)}><ChevronRight size={14} /></button>
          <button type="button" className="icon-btn danger" aria-label="Remove widget" onClick={onRemove}><Trash2 size={14} /></button>
        </div>
      )}
    </article>
  );
}

function DataTable({ lines, fmt }: { lines: { key: string; label: string; points: { t: number; v: number | null }[] }[]; fmt: (v: number | null) => string }) {
  const times = [...new Set(lines.flatMap(l => l.points.map(p => p.t)))].sort((a, b) => b - a);
  const maps = lines.map(l => new Map(l.points.map(p => [p.t, p.v])));
  return (
    <div className="widget-table">
      <table className="raw-table">
        <thead>
          <tr>
            <th>Time</th>
            {lines.map(l => <th key={l.key} className="num">{l.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {times.map(t => (
            <tr key={t}>
              <th scope="row">{new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</th>
              {maps.map((m, i) => <td key={i}>{fmt(m.get(t) ?? null)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddWidget({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (d: MetricDef) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const match = METRICS.filter(d => !q.trim() || `${d.label} ${d.category} ${d.id}`.toLowerCase().includes(q.trim().toLowerCase()));
    return [...new Set(match.map(d => d.category))].map(c => ({ c, items: match.filter(d => d.category === c) }));
  }, [q]);
  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="modal" aria-describedby={undefined}>
          <div className="panel-head">
            <Dialog.Title asChild><h3>Add a widget</h3></Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          <label className="search">
            <Search size={15} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search metrics" aria-label="Search metrics" />
          </label>
          <div className="metric-list">
            {groups.map(g => (
              <section key={g.c}>
                <span className="nav-label">{g.c}</span>
                {g.items.map(d => (
                  <button type="button" key={d.id} className="metric-option" onClick={() => { onAdd(d); onClose(); }}>
                    <span>{d.label}</span>
                    <span className="muted small">{d.maxDays < 365 ? `${d.maxDays} days of history` : d.breakdowns.length ? `${d.breakdowns.length} breakdowns` : ""}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

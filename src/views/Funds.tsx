import { useMemo, useState } from "react";
import { Crown, Gamepad2, Users } from "lucide-react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { useContextMenu } from "@/components/ContextMenu";
import { Alert, Empty, Freshness, HideButton, PinButton, Rating, Share, Skeleton, Thumb } from "@/components/ui";
import { gameRows, groupEarned, groupPending, itemOfGameRow, useData, useSales, type GameRow } from "@/lib/data";
import { compact, earned, pending, robux } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useNav } from "@/lib/nav";
import { gameItem, groupItem, usePrefs } from "@/lib/prefs";
import { useSettings } from "@/lib/settings";
import { createStore } from "@/lib/store";

const useFundsPrefs = createStore("groupwise.funds", { mode: "groups", split: true });

const MODES = [
  { value: "groups", label: "By group" },
  { value: "games", label: "By game" },
];

export function Funds() {
  const [p, update] = useFundsPrefs();
  const { hasCookie } = useData();

  if (!hasCookie) {
    return (
      <section className="panel">
        <Empty icon={<Users size={18} />} title="Log in to see funds">
          Roblox only shows group funds and sales to a logged-in account. Log in with Roblox in Settings.
        </Empty>
      </section>
    );
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <SegmentedControl label="Arrange funds" options={MODES} value={p.mode} onValueChange={v => update({ mode: v })} />
        {p.mode === "games" && (
          <label className="check">
            <input type="checkbox" checked={p.split} onChange={e => update({ split: e.target.checked })} /> Split by owner
          </label>
        )}
      </div>
      {p.mode === "groups" ? <ByGroup /> : <ByGame split={p.split} />}
    </div>
  );
}

function ByGroup() {
  const [settings] = useSettings();
  const { funds, me, tracked, cash } = useData();
  const { isPinned } = usePrefs();
  const { open, go } = useNav();
  const menu = useContextMenu();
  const menus = useMenus();
  const [sort, setSort] = useState<"funds" | "earned" | "name">("funds");
  const period = settings.timeframe.toLowerCase();

  const rows = useMemo(() => {
    const list = tracked.map(g => ({ g, f: funds.data?.[g.id] }));
    const val = (r: (typeof list)[number]) => (sort === "funds" ? (r.f?.finance?.balance ?? -1) : groupEarned(r.f));
    return list.sort((a, b) => {
      const pin = Number(isPinned(groupItem(b.g.id))) - Number(isPinned(groupItem(a.g.id)));
      if (pin) return pin;
      return sort === "name" ? a.g.name.localeCompare(b.g.name) : val(b) - val(a);
    });
  }, [tracked, funds.data, sort, isPinned]);

  const totalFunds = rows.reduce((s, r) => s + (r.f?.finance?.balance ?? 0), 0) + (me.data?.balance ?? 0);
  const totalEarned = rows.reduce((s, r) => s + groupEarned(r.f), 0) + earned(me.data?.breakdown ?? null);
  const totalPending = rows.reduce((s, r) => s + groupPending(r.f), 0) + (pending(me.data?.breakdown ?? null) ?? 0);

  return (
    <>
      <div className="totals">
        <Total label="Total Robux" value={robux(totalFunds)} sub={cash(totalFunds)} />
        <Total label={`Earned this ${period}`} value={robux(totalEarned)} sub={cash(totalEarned)} />
        <Total label="Pending" value={robux(totalPending)} sub="Not yet spendable" />
      </div>

      {funds.error && <Alert>{funds.error}</Alert>}

      <section className="panel flush">
        <div className="panel-head padded">
          <h3>Funds by group</h3>
          <div className="head-tools">
            <Freshness load={funds} />
            <select className="select-sm" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort by">
              <option value="funds">Sort: funds</option>
              <option value="earned">Sort: earned</option>
              <option value="name">Sort: name</option>
            </select>
          </div>
        </div>
        <div className="table">
          <div className="tr th">
            <span />
            <span>Owner</span>
            <span className="num">Funds</span>
            <span className="num">Earned</span>
            <span className="num hide-sm">Pending</span>
            <span className="hide-sm share-col">Share</span>
            <span />
          </div>

          <div className="tr">
            <span />
            <span className="cell-main">
              <Thumb src={null} name="You" size={32} />
              <span className="row-main">
                <span>Personal account</span>
                <span className="muted small">Your own Robux</span>
              </span>
            </span>
            <span className="num strong">{me.data?.balance != null ? robux(me.data.balance) : "…"}</span>
            <span className="num pos">{robux(earned(me.data?.breakdown ?? null))}</span>
            <span className="num hide-sm">{robux(pending(me.data?.breakdown ?? null) ?? 0)}</span>
            <span className="hide-sm share-col"><Share value={me.data?.balance ?? 0} total={totalFunds} /></span>
            <span />
          </div>

          {!funds.data && funds.loading && <Skeleton rows={Math.min(tracked.length, 4) || 2} />}
          {rows.map(({ g, f }) => {
            const id = groupItem(g.id);
            const bal = f?.finance?.balance;
            const note = f?.finance?.note ?? f?.error;
            return (
              <div key={g.id} className="tr tr-click" onClick={() => open(id)} onContextMenu={e => menu(e, menus.group(g))}>
                <PinButton id={id} label={g.name} />
                <span className="cell-main">
                  <Thumb src={g.iconUrl} name={g.name} size={32} />
                  <span className="row-main">
                    <span className="truncate">{g.name}</span>
                    <span className="muted small">{g.isOwner && <Crown size={11} />} {g.roleName}</span>
                  </span>
                </span>
                {note ? (
                  <span className="muted small span-4">{note}</span>
                ) : (
                  <>
                    <span className="num strong">{bal != null ? robux(bal) : "…"}</span>
                    <span className="num pos">{f ? robux(groupEarned(f)) : "…"}</span>
                    <span className="num hide-sm">{f ? robux(groupPending(f)) : "…"}</span>
                    <span className="hide-sm share-col"><Share value={bal ?? 0} total={totalFunds} /></span>
                  </>
                )}
                <HideButton id={id} label={g.name} />
              </div>
            );
          })}
        </div>
        <p className="muted small padded foot">
          Showing groups you own or have pinned. To track another group's funds, pin it on the{" "}
          <button type="button" className="link" onClick={() => go("groups")}>Groups</button> page.
        </p>
      </section>
    </>
  );
}

function ByGame({ split }: { split: boolean }) {
  const [settings] = useSettings();
  const { owners, games, ownerName, cash, hidden } = useData();
  const { isPinned } = usePrefs();
  const sales = useSales(owners);
  const period = settings.timeframe.toLowerCase();

  const rows = useMemo(() => {
    const all = gameRows(games.data ?? [], sales.data).filter(r => !(r.universeId != null && hidden(gameItem(r.universeId))));
    return all.sort((a, b) => {
      const pin = Number(r(b)) - Number(r(a));
      return pin || b.robux - a.robux || (b.game?.playing ?? 0) - (a.game?.playing ?? 0);
    });
    function r(x: GameRow) {
      const item = itemOfGameRow(x);
      return item ? isPinned(item) : false;
    }
  }, [games.data, sales.data, hidden, isPinned]);

  const total = rows.reduce((s, r) => s + r.robux, 0);
  const salesCount = rows.reduce((s, r) => s + r.sales, 0);
  const truncated = sales.data?.some(s => s.sales?.truncated);
  const notes = sales.data?.filter(s => s.sales?.note || s.error) ?? [];

  const sections = split
    ? owners
        .map(o => ({ title: ownerName(o), rows: rows.filter(r => r.owner.kind === o.kind && r.owner.id === o.id) }))
        .filter(s => s.rows.length)
    : [{ title: "All games", rows }];

  return (
    <>
      <div className="totals">
        <Total label={`Sales this ${period}`} value={robux(total)} sub={cash(total)} />
        <Total label="Transactions" value={compact(salesCount)} sub="Passes, products & items" />
        <Total label="Playing now" value={compact(rows.reduce((s, r) => s + (r.game?.playing ?? 0), 0))} sub={`${rows.filter(r => r.game).length} games`} />
      </div>

      {sales.error && <Alert>{sales.error}</Alert>}
      {games.error && <Alert>{games.error}</Alert>}
      {truncated && (
        <p className="muted small">Some owners have more sales than one scan reads, so older sales in this {period} aren't counted. Pick a shorter timeframe for exact numbers.</p>
      )}

      {!rows.length && (games.loading || sales.loading) ? (
        <section className="panel"><Skeleton rows={4} /></section>
      ) : !rows.length ? (
        <section className="panel">
          <Empty icon={<Gamepad2 size={18} />} title="No games found">No public games or sales for you or your tracked groups.</Empty>
        </section>
      ) : (
        sections.map(s => {
          const sub = s.rows.reduce((a, r) => a + r.robux, 0);
          return (
            <section key={s.title} className="panel flush">
              <div className="panel-head padded">
                <h3>{s.title}</h3>
                <div className="head-tools">
                  <span className="muted small">{robux(sub)} this {period}</span>
                  <Freshness load={sales.fetchedAt ? sales : games} />
                </div>
              </div>
              <div className="table games">
                <div className="tr th">
                  <span />
                  <span>Game</span>
                  <span className="num">Revenue</span>
                  <span className="num hide-sm">Sales</span>
                  <span className="num">Playing</span>
                  <span className="num hide-sm">Likes</span>
                  <span className="num hide-sm">Visits</span>
                  <span className="hide-sm share-col">Share</span>
                  <span />
                </div>
                {s.rows.map(r => (
                  <GameRowView key={r.key} r={r} total={total} split={split} ownerName={ownerName(r.owner)} loadingSales={sales.loading && !sales.data} />
                ))}
              </div>
            </section>
          );
        })
      )}

      {notes.length > 0 && (
        <p className="muted small">
          {notes.map(n => `${ownerName(n.owner)}: ${n.sales?.note ?? n.error}`).join(" · ")}
        </p>
      )}
      <p className="muted small">
        Revenue per game adds up your sales (game passes, developer products, items) for each experience. Premium payouts and ads aren't split per game by Roblox, so they only show in group totals.
      </p>
    </>
  );
}

function GameRowView({ r, total, split, ownerName, loadingSales }: { r: GameRow; total: number; split: boolean; ownerName: string; loadingSales: boolean }) {
  const { open } = useNav();
  const menu = useContextMenu();
  const menus = useMenus();
  const item = itemOfGameRow(r);
  return (
    <div className={`tr ${item ? "tr-click" : ""}`} onClick={() => item && open(item)} onContextMenu={e => r.game && menu(e, menus.game(r.game))}>
      {item ? <PinButton id={item} label={r.name} /> : <span />}
      <span className="cell-main">
        <Thumb src={r.game?.iconUrl} name={r.name} size={32} />
        <span className="row-main">
          <span className="truncate">{r.name}</span>
          <span className="muted small truncate">
            {split ? (r.products[0] ? `Top: ${r.products[0].name}` : "No sales") : ownerName}
          </span>
        </span>
      </span>
      <span className="num strong">{loadingSales ? "…" : robux(r.robux)}</span>
      <span className="num hide-sm">{compact(r.sales)}</span>
      <span className="num">{r.game ? compact(r.game.playing) : "—"}</span>
      <span className="num hide-sm">{r.game ? <Rating game={r.game} showEmpty /> : "—"}</span>
      <span className="num hide-sm">{r.game ? compact(r.game.visits) : "—"}</span>
      <span className="hide-sm share-col"><Share value={r.robux} total={total} /></span>
      {item ? <HideButton id={item} label={r.name} /> : <span />}
    </div>
  );
}

function Total({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="total">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      <span className="muted small">{sub}</span>
    </div>
  );
}

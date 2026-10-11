import { useMemo } from "react";
import { Gamepad2, Pin } from "lucide-react";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import { useContextMenu } from "@/components/ContextMenu";
import { Alert, Empty, Freshness, PinButton, Rating, Thumb } from "@/components/ui";
import type { Game } from "@/lib/api";
import { gameRows, groupEarned, groupPending, useData, useSales } from "@/lib/data";
import { compact, earned, earningsBySource, pending, robux } from "@/lib/format";
import { useMenus } from "@/lib/menus";
import { useNav } from "@/lib/nav";
import { gameItem, usePrefs } from "@/lib/prefs";
import { useReorder } from "@/lib/useReorder";
import { useSettings } from "@/lib/settings";

export function Overview() {
  const [settings] = useSettings();
  const { me, funds, tracked, groups, games, hasCookie, cash } = useData();
  const period = settings.timeframe.toLowerCase();

  const myEarnings = me.data?.breakdown ? earningsBySource(me.data.breakdown) : [];
  const myEarned = earned(me.data?.breakdown ?? null);
  const fundRows = Object.values(funds.data ?? {});
  const groupFunds = fundRows.reduce((s, f) => s + (f.finance?.balance ?? 0), 0);
  const groupMade = fundRows.reduce((s, f) => s + groupEarned(f), 0);
  const groupWaiting = fundRows.reduce((s, f) => s + groupPending(f), 0);
  const topGames = (games.data ?? []).slice(0, 5);

  return (
    <div className="stack">
      {groups.error && <Alert>{groups.error}</Alert>}
      {me.error && <Alert>{me.error}</Alert>}

      <div className="metric-grid">
        {hasCookie ? (
          <>
            <MetricCard label="Your Robux" value={me.data?.balance ?? 0} context={cash(me.data?.balance ?? 0)} />
            <MetricCard label={`You earned this ${period}`} value={myEarned} context={`${cash(myEarned)} · ${robux(pending(me.data?.breakdown ?? null) ?? 0)} pending`} />
            <MetricCard label={tracked.length ? `Group funds · ${tracked.length} groups` : "Group funds"} value={groupFunds} context={tracked.length ? cash(groupFunds) : "You don't own or track any groups"} />
            <MetricCard label={`Groups earned this ${period}`} value={groupMade} context={`${cash(groupMade)} · ${robux(groupWaiting)} pending`} />
          </>
        ) : (
          <div className="metric-locked">
            <strong>Revenue is off</strong>
            <span className="muted">Roblox only shows Robux and revenue to a logged-in account. Log in with Roblox in Settings to turn it on.</span>
          </div>
        )}
      </div>

      <Pinned />

      <div className="split">
        {hasCookie && (
          <section className="panel">
            <div className="panel-head">
              <h3>Your earnings by source</h3>
              <Freshness load={me} />
            </div>
            {myEarnings.length ? (
              <BarChart data={myEarnings} label="Your earnings by source" period={`This ${period}`} valueLabel="Earned" categoryLabel="Source" showAverage={false} formatValue={robux} />
            ) : (
              <p className="muted">{me.loading ? "Loading earnings…" : `No personal earnings this ${period}.`}</p>
            )}
          </section>
        )}
        <section className="panel">
          <div className="panel-head">
            <h3>Live now</h3>
            <Freshness load={games} />
          </div>
          {topGames.length ? (
            <ul className="rows">
              {topGames.map(g => (
                <GameLine key={g.universeId} game={g} />
              ))}
            </ul>
          ) : (
            <p className="muted">{games.loading ? "Loading games…" : "No public games found for you or your tracked groups."}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function GameLine({ game }: { game: Game }) {
  const { open } = useNav();
  const menu = useContextMenu();
  const menus = useMenus();
  const id = gameItem(game.universeId);
  return (
    <li className="row row-click" onClick={() => open(id)} onContextMenu={e => menu(e, menus.game(game))}>
      <Thumb src={game.iconUrl} name={game.name} size={32} />
      <span className="row-main">
        <span className="truncate">{game.name}</span>
        <span className="muted small">{compact(game.visits)} visits<Rating game={game} prefix=" · " /></span>
      </span>
      <span className="row-value">{compact(game.playing)} playing</span>
      <PinButton id={id} label={game.name} />
    </li>
  );
}

function Pinned() {
  const [settings] = useSettings();
  const { prefs, setPins } = usePrefs();
  const { open } = useNav();
  const menu = useContextMenu();
  const menus = useMenus();
  const { groupById, gameById, funds, owners, games, cash } = useData();
  const period = settings.timeframe.toLowerCase();

  // Only scan sales for the owners of pinned games.
  const pinnedGames = prefs.pins.filter(p => p.startsWith("game:")).map(p => gameById.get(Number(p.slice(5)))).filter(g => !!g);
  const saleOwners = useMemo(
    () => owners.filter(o => pinnedGames.some(g => g.ownerKind === o.kind && g.ownerId === o.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [owners, pinnedGames.map(g => g.universeId).join(",")],
  );
  const sales = useSales(saleOwners, saleOwners.length > 0);
  const revenue = useMemo(() => new Map(gameRows([], sales.data).map(r => [r.key, r])), [sales.data]);

  // Drag tiles to reorder. Pins that haven't loaded yet keep their place at the end.
  const ready = prefs.pins.filter(id => (id.startsWith("group:") ? groupById.has(id.slice(6)) : gameById.has(Number(id.slice(5)))));
  const waiting = prefs.pins.filter(id => !ready.includes(id));
  const { order, bind } = useReorder(ready, next => setPins([...next, ...waiting]));

  if (!prefs.pins.length) {
    return (
      <section className="panel">
        <Empty icon={<Pin size={18} />} title="Nothing pinned yet">
          Right-click any group or game and choose Pin, or use its pin button. Pinned items show up here with their funds and revenue.
        </Empty>
      </section>
    );
  }

  return (
    <section className="pinned">
      <div className="section-head">
        <h3>Pinned</h3>
        <span className="muted small">Drag to reorder · right-click for more</span>
        <span className="grow" />
        <Freshness load={funds} />
      </div>
      <div className="card-grid">
        {order.map(id => {
          const [kind, key] = id.split(":");
          if (kind === "group") {
            const g = groupById.get(key)!;
            const f = funds.data?.[key];
            const bal = f?.finance?.balance;
            return (
              <article key={id} className="tile" onClick={() => open(id)} onContextMenu={e => menu(e, menus.group(g))} {...bind(id)}>
                <div className="tile-head">
                  <Thumb src={g.iconUrl} name={g.name} size={36} />
                  <div className="tile-title">
                    <strong className="truncate">{g.name}</strong>
                    <span className="muted small">Group · {g.roleName}</span>
                  </div>
                  <span data-no-drag><PinButton id={id} label={g.name} /></span>
                </div>
                {f?.finance?.note || f?.error ? (
                  <p className="muted small">{f.finance?.note ?? f.error}</p>
                ) : (
                  <>
                    <div className="tile-value">{bal != null ? robux(bal) : funds.loading ? "…" : "—"}</div>
                    <div className="tile-meta">
                      <span>{bal != null ? cash(bal) : ""}</span>
                      <span className="pos">+{robux(groupEarned(f))} this {period}</span>
                    </div>
                  </>
                )}
              </article>
            );
          }
          const g = gameById.get(Number(key))!;
          const r = revenue.get(key);
          return (
            <article key={id} className="tile" onClick={() => open(id)} onContextMenu={e => menu(e, menus.game(g))} {...bind(id)}>
              <div className="tile-head">
                <Thumb src={g.iconUrl} name={g.name} size={36} />
                <div className="tile-title">
                  <strong className="truncate">{g.name}</strong>
                  <span className="muted small">
                    <Gamepad2 size={11} /> {compact(g.playing)} playing · {compact(g.visits)} visits<Rating game={g} prefix=" · " />
                  </span>
                </div>
                <span data-no-drag><PinButton id={id} label={g.name} /></span>
              </div>
              <div className="tile-value">{r ? robux(r.robux) : sales.loading ? "…" : robux(0)}</div>
              <div className="tile-meta">
                <span>{r ? `${compact(r.sales)} sales this ${period}` : `Sales this ${period}`}</span>
                <span>{r ? cash(r.robux) : ""}</span>
              </div>
            </article>
          );
        })}
        {games.loading && waiting.some(id => id.startsWith("game:")) && <article className="tile tile-loading" />}
      </div>
    </section>
  );
}

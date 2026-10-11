import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, BadgeCheck, Crown, HandCoins } from "lucide-react";
import { DonutChart } from "@/components/arc/donut-chart/donut-chart";
import { Button } from "@/components/arc/button/button";
import { Alert, Drawer, Freshness, HideButton, PinButton, Skeleton, Thumb, likeRatio } from "@/components/ui";
import { api, type OwnerRef } from "@/lib/api";
import { gameRows, useData, useSales } from "@/lib/data";
import { compact, count, earned, earningsBySource, humanize, pending, robux } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { gameItem, type ItemId } from "@/lib/prefs";
import { useSettings } from "@/lib/settings";
import { useCached } from "@/lib/useLoad";

export function Detail({ item, onClose }: { item: ItemId | null; onClose: () => void }) {
  const [kind, key] = item ? item.split(":") : [null, null];
  const { groupById, gameById } = useData();
  const title = kind === "group" ? (groupById.get(key!)?.name ?? "Group") : (gameById.get(Number(key))?.name ?? "Game");
  return (
    <Drawer open={!!item} onClose={onClose} title={title}>
      {kind === "group" && key && <GroupDetail key={key} id={key} />}
      {kind === "game" && key && <GameDetail key={key} universeId={Number(key)} />}
    </Drawer>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

function GroupDetail({ id }: { id: string }) {
  const [settings] = useSettings();
  const { groupById, funds, games, cash, hasCookie, hidden } = useData();
  const { open, payout } = useNav();
  const group = groupById.get(id);
  const period = settings.timeframe.toLowerCase();

  // Tracked groups already have their finance loaded; others load on demand (cached by the Rust side).
  const tracked = funds.data?.[id];
  const own = useCached(force => api.groupFinance(id, settings.timeframe, force), [id, settings.timeframe], hasCookie && !tracked);
  const finance = tracked?.finance ?? own.data;
  const financeLoad = tracked ? funds : own;
  const error = tracked?.error ?? own.error;

  const owner = useMemo<OwnerRef[]>(() => [{ kind: "group", id }], [id]);
  const canSee = hasCookie && finance && !finance.note;
  const sales = useSales(owner, !!canSee);
  const rows = gameRows((games.data ?? []).filter(g => g.ownerKind === "group" && g.ownerId === id), sales.data)
    .filter(r => r.universeId == null || !hidden(gameItem(r.universeId)))
    .sort((a, b) => b.robux - a.robux);

  if (!group) return <p className="muted">This group isn't in your list.</p>;
  const breakdown = finance?.breakdown ?? null;
  const sources = breakdown ? earningsBySource(breakdown) : [];
  const made = earned(breakdown);

  return (
    <div className="detail">
      <div className="detail-head">
        <Thumb src={group.iconUrl} name={group.name} size={56} />
        <div className="detail-title">
          <h2>
            {group.name} {group.verified && <BadgeCheck size={16} className="verified" aria-label="Verified" />}
          </h2>
          <span className="muted small">
            {group.isOwner && <Crown size={12} />} {group.roleName} · rank {group.rank} · {count(group.memberCount)} members
          </span>
        </div>
      </div>
      <div className="detail-actions">
        <PinButton id={`group:${id}`} label={group.name} />
        <HideButton id={`group:${id}`} label={group.name} />
        {canSee && (
          <Button size="sm" variant="secondary" onClick={() => payout(id)}>
            <HandCoins size={14} /> Pay out
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => openUrl(`https://www.roblox.com/communities/${id}`)}>
          Open on Roblox <ArrowUpRight size={14} />
        </Button>
        <span className="grow" />
        <Freshness load={financeLoad} />
      </div>

      {!hasCookie ? (
        <p className="muted">Log in with Roblox in Settings to see this group's funds and revenue.</p>
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !finance ? (
        <Skeleton rows={3} />
      ) : finance.note ? (
        <p className="muted">{finance.note}</p>
      ) : (
        <>
          <div className="stats">
            <Stat label="Group funds" value={robux(finance.balance ?? 0)} sub={cash(finance.balance ?? 0)} />
            <Stat label={`Earned this ${period}`} value={robux(made)} sub={cash(made)} />
            <Stat label="Pending" value={robux(pending(breakdown) ?? 0)} sub="Not yet spendable" />
          </div>
          {sources.length > 0 && (
            <section className="detail-section">
              <DonutChart data={sources} label="Revenue by source" formatValue={robux} totalLabel="Earned" size={180} />
            </section>
          )}
        </>
      )}

      <section className="detail-section">
        <div className="panel-head">
          <h3>Games</h3>
          {canSee && <Freshness load={sales} />}
        </div>
        {rows.length ? (
          <ul className="rows">
            {rows.map(r => {
              const item = r.universeId != null ? gameItem(r.universeId) : null;
              return (
                <li key={r.key} className={`row ${item ? "row-click" : ""}`} onClick={() => item && open(item)}>
                  <Thumb src={r.game?.iconUrl} name={r.name} size={32} />
                  <span className="row-main">
                    <span className="truncate">{r.name}</span>
                    <span className="muted small">
                      {r.game ? `${compact(r.game.playing)} playing · ${compact(r.game.visits)} visits` : `${compact(r.sales)} sales`}
                    </span>
                  </span>
                  {canSee && <span className="row-value">{robux(r.robux)}</span>}
                  {item && <PinButton id={item} label={r.name} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">{games.loading || sales.loading ? "Loading…" : "No public games in this group."}</p>
        )}
      </section>

      {breakdown && (
        <details className="detail-section raw">
          <summary>Every field Roblox returned</summary>
          <table className="raw-table">
            <tbody>
              {Object.entries(breakdown).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{humanize(k)}</th>
                  <td>{robux(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function GameDetail({ universeId }: { universeId: number }) {
  const [settings] = useSettings();
  const { gameById, ownerName, cash, hasCookie, games } = useData();
  const game = gameById.get(universeId);
  const period = settings.timeframe.toLowerCase();
  const owner = useMemo<OwnerRef[]>(() => (game ? [{ kind: game.ownerKind, id: game.ownerId }] : []), [game]);
  const sales = useSales(owner, !!game);
  const row = gameRows([], sales.data).find(r => r.universeId === universeId);
  const ownerSales = sales.data?.[0]?.sales;

  if (!game) return games.loading ? <Skeleton rows={4} /> : <p className="muted">This game isn't in your list anymore.</p>;

  return (
    <div className="detail">
      <div className="detail-head">
        <Thumb src={game.iconUrl} name={game.name} size={56} />
        <div className="detail-title">
          <h2>{game.name}</h2>
          <span className="muted small">
            {ownerName({ kind: game.ownerKind, id: game.ownerId })} · updated {new Date(game.updated).toLocaleDateString()}
          </span>
        </div>
      </div>
      <div className="detail-actions">
        <PinButton id={gameItem(universeId)} label={game.name} />
        <HideButton id={gameItem(universeId)} label={game.name} />
        <Button size="sm" variant="ghost" onClick={() => openUrl(`https://www.roblox.com/games/${game.rootPlaceId}`)}>
          Open on Roblox <ArrowUpRight size={14} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => openUrl(`https://create.roblox.com/dashboard/creations/experiences/${universeId}/overview`)}>
          Creator Hub <ArrowUpRight size={14} />
        </Button>
      </div>

      <div className="stats">
        <Stat label="Playing now" value={compact(game.playing)} />
        <Stat label="Visits" value={compact(game.visits)} />
        <Stat label="Favorites" value={compact(game.favorites)} />
        <Stat label="Like ratio" value={likeRatio(game) != null ? `${Math.round(likeRatio(game)! * 100)}%` : "—"} sub={`${compact(game.upVotes)} likes · ${compact(game.downVotes)} dislikes`} />
      </div>

      <section className="detail-section">
        <div className="panel-head">
          <h3>Sales this {period}</h3>
          {hasCookie && <Freshness load={sales} />}
        </div>
        {!hasCookie ? (
          <p className="muted small">Log in with Roblox in Settings to see sales.</p>
        ) : sales.error ? (
          <Alert>{sales.error}</Alert>
        ) : !sales.data ? (
          <Skeleton rows={3} />
        ) : ownerSales?.note ? (
          <p className="muted small">{ownerSales.note}</p>
        ) : (
          <>
            <div className="stats">
              <Stat label="Revenue" value={robux(row?.robux ?? 0)} sub={cash(row?.robux ?? 0)} />
              <Stat label="Sales" value={compact(row?.sales ?? 0)} sub={row?.pending ? `${robux(row.pending)} pending` : undefined} />
            </div>
            {row?.products.length ? (
              <table className="raw-table products">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Sales</th>
                    <th className="num">Robux</th>
                  </tr>
                </thead>
                <tbody>
                  {row.products.map(p => (
                    <tr key={`${p.kind}:${p.name}`}>
                      <th scope="row">
                        {p.name || "Unnamed"} <span className="muted small">{humanize(p.kind)}</span>
                      </th>
                      <td>{compact(p.sales)}</td>
                      <td>{robux(p.robux)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">No sales this {period}.</p>
            )}
            {ownerSales?.truncated && <p className="muted small">Only the most recent sales were scanned; older ones in this {period} aren't counted.</p>}
          </>
        )}
      </section>
    </div>
  );
}

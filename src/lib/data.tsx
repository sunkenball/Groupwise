import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api, type Finance, type Game, type GroupSummary, type OwnerRef, type Profile, type Rates, type Sales, type SecretsStatus } from "./api";
import { earned, money, pending } from "./format";
import { gameItem, groupItem, usePrefs, type ItemId } from "./prefs";
import { useSettings } from "./settings";
import { combine, mapLimit, useCached, type Load } from "./useLoad";

export interface GroupFunds {
  group: GroupSummary;
  finance: Finance | null;
  error: string | null;
}

export interface Data {
  status: Load<SecretsStatus>;
  hasCookie: boolean;
  /** The logged-in account, or the user ID from Settings. */
  profile: Load<Profile>;
  /** Your groups after the rank filter (hidden ones included; check `isHidden`). */
  groups: Load<GroupSummary[]>;
  groupById: Map<string, GroupSummary>;
  /** How many groups the rank filter left out. */
  ignoredCount: number;
  /** Groups whose funds are loaded: owned or pinned, not hidden. */
  tracked: GroupSummary[];
  funds: Load<Record<string, GroupFunds>>;
  me: Load<Finance>;
  /** Your games, without hidden ones. */
  games: Load<Game[]>;
  gameById: Map<number, Game>;
  rates: Load<Rates>;
  /** Owners whose experiences and sales are shown: you, then tracked groups. */
  owners: OwnerRef[];
  ownerName: (o: { kind: string; id: string }) => string;
  /** Convert Robux to "$12.34 · €11.20" at the DevEx rate. */
  cash: (robux: number) => string;
  hidden: (id: ItemId) => boolean;
}

const DataContext = createContext<Data | null>(null);

export function useData() {
  const d = useContext(DataContext);
  if (!d) throw new Error("useData outside DataProvider");
  return d;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [settings] = useSettings();
  const { prefs, isHidden, isPinned } = usePrefs();
  const tf = settings.timeframe;

  const status = useCached(async () => ({ data: await api.secretsStatus(), fetchedAt: Date.now(), stale: false }), []);
  const hasCookie = !!status.data?.hasCookie;

  const profile = useCached(force => api.profile(settings.userId, force), [settings.userId, hasCookie], !!settings.userId || hasCookie);
  const allGroups = useCached(force => api.listGroups(settings.userId, force), [settings.userId], !!settings.userId);
  const groupsData = useMemo(
    () => allGroups.data?.filter(g => g.rank > settings.ignoreRankAtOrBelow || isPinned(groupItem(g.id))) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allGroups.data, settings.ignoreRankAtOrBelow, prefs.pins],
  );
  const groups: Load<GroupSummary[]> = { ...allGroups, data: groupsData };
  const groupById = useMemo(() => new Map((groupsData ?? []).map(g => [g.id, g])), [groupsData]);

  const tracked = useMemo(
    () => (groupsData ?? []).filter(g => (g.isOwner || isPinned(groupItem(g.id))) && !isHidden(groupItem(g.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupsData, prefs.pins, prefs.hidden],
  );
  const trackedKey = tracked.map(g => g.id).join(",");

  const funds = useCached(
    async force => {
      const results = await mapLimit(tracked, 2, g =>
        api.groupFinance(g.id, tf, force).then(
          r => ({ r, f: { group: g, finance: r.data, error: null } as GroupFunds }),
          e => ({ r: null, f: { group: g, finance: null, error: String(e) } as GroupFunds }),
        ),
      );
      return {
        data: Object.fromEntries(results.map(x => [x.f.group.id, x.f])),
        ...combine(results.flatMap(x => (x.r ? [x.r] : []))),
      };
    },
    [trackedKey, tf],
    hasCookie && tracked.length > 0,
  );

  const me = useCached(force => api.userFinance(tf, force), [tf], hasCookie);

  const owners = useMemo<OwnerRef[]>(
    () => [...(settings.userId ? [{ kind: "user" as const, id: settings.userId }] : []), ...tracked.map(g => ({ kind: "group" as const, id: g.id }))],
    [settings.userId, tracked],
  );
  const allGames = useCached(force => api.listGames(owners, force), [owners], owners.length > 0);
  // Hidden games are left out of every list; gameById keeps them so pins, details and Settings can still name them.
  const visibleGames = useMemo(
    () => allGames.data?.filter(g => !isHidden(gameItem(g.universeId))) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allGames.data, prefs.hidden],
  );
  const games: Load<Game[]> = { ...allGames, data: visibleGames };
  const gameById = useMemo(() => new Map((allGames.data ?? []).map(g => [g.universeId, g])), [allGames.data]);

  const rates = useCached(force => api.exchangeRates(force), []);
  const fx = rates.data?.rates[settings.currency];

  const value: Data = {
    status,
    hasCookie,
    profile,
    groups,
    groupById,
    ignoredCount: (allGroups.data?.length ?? 0) - (groupsData?.length ?? 0),
    tracked,
    funds,
    me,
    games,
    gameById,
    rates,
    owners,
    ownerName: o => (o.kind === "user" ? "Personal" : (groupById.get(o.id)?.name ?? `Group ${o.id}`)),
    cash: r => {
      const usd = r * settings.devexRate;
      return `${money(usd, "USD")}${fx && settings.currency !== "USD" ? ` · ${money(usd * fx, settings.currency)}` : ""}`;
    },
    hidden: isHidden,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** Per-owner sales scans for the current timeframe. Each owner is cached for 10 minutes by the Rust side. */
export function useSales(owners: OwnerRef[], enabled = true) {
  const [settings] = useSettings();
  const { hasCookie } = useData();
  return useCached(
    async force => {
      const results = await mapLimit(owners, 1, o =>
        api.gameSales(o, settings.timeframe, force).then(
          r => ({ owner: o, r, error: null as string | null }),
          e => ({ owner: o, r: null, error: String(e) }),
        ),
      );
      const ok = results.flatMap(x => (x.r ? [x.r] : []));
      if (!ok.length && results.length && results[0].error) throw results[0].error;
      return {
        data: results.map(x => ({ owner: x.owner, sales: x.r?.data ?? null, error: x.error })),
        ...combine(ok),
      };
    },
    [owners, settings.timeframe],
    enabled && hasCookie && owners.length > 0,
  );
}

export type OwnerSales = { owner: OwnerRef; sales: Sales | null; error: string | null };

/** One row per experience (plus one per owner for sales outside experiences), merged with live stats. */
export interface GameRow {
  key: string;
  universeId: number | null;
  name: string;
  owner: OwnerRef;
  game: Game | null;
  robux: number;
  pending: number;
  sales: number;
  products: Sales["games"][number]["products"];
}

export function gameRows(games: Game[], sales: OwnerSales[] | null): GameRow[] {
  const rows = new Map<string, GameRow>();
  for (const g of games) {
    rows.set(String(g.universeId), {
      key: String(g.universeId),
      universeId: g.universeId,
      name: g.name,
      owner: { kind: g.ownerKind, id: g.ownerId },
      game: g,
      robux: 0,
      pending: 0,
      sales: 0,
      products: [],
    });
  }
  for (const s of sales ?? []) {
    for (const sg of s.sales?.games ?? []) {
      const key = sg.universeId != null ? String(sg.universeId) : `other:${s.owner.kind}:${s.owner.id}`;
      const row = rows.get(key) ?? {
        key,
        universeId: sg.universeId,
        name: sg.universeId != null ? sg.name : "Other sales (not in an experience)",
        owner: s.owner,
        game: null,
        robux: 0,
        pending: 0,
        sales: 0,
        products: [],
      };
      row.robux += sg.robux;
      row.pending += sg.pending;
      row.sales += sg.sales;
      row.products = [...row.products, ...sg.products].sort((a, b) => b.robux - a.robux);
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

export const itemOfGameRow = (r: GameRow): ItemId | null => (r.universeId != null ? gameItem(r.universeId) : null);

export const groupEarned = (f: GroupFunds | undefined) => earned(f?.finance?.breakdown ?? null);
export const groupPending = (f: GroupFunds | undefined) => pending(f?.finance?.breakdown ?? null) ?? 0;

import { invoke } from "@tauri-apps/api/core";

export type SecretName = "apiKey" | "cookie";
export type Timeframe = "Day" | "Week" | "Month" | "Year";
export type OwnerKind = "group" | "user";

export interface SecretsStatus {
  hasApiKey: boolean;
  hasCookie: boolean;
}

/** Every Roblox call is cached by the Rust side. `stale` means Roblox refused a refresh and this is older data. */
export interface Cached<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

export interface GroupSummary {
  id: string;
  name: string;
  memberCount: number;
  verified: boolean;
  isOwner: boolean;
  roleName: string;
  rank: number;
  iconUrl: string | null;
}

export interface Game {
  universeId: number;
  rootPlaceId: number;
  name: string;
  ownerKind: OwnerKind;
  ownerId: string;
  visits: number;
  playing: number;
  favorites: number;
  updated: string;
  iconUrl: string | null;
  /** Thumbs up / down. */
  upVotes: number;
  downVotes: number;
}

export interface CookieUser {
  id: number;
  name: string;
  displayName: string;
}

export interface Finance {
  balance: number | null;
  /** Raw numeric fields from Roblox, keyed by field name. */
  breakdown: Record<string, number> | null;
  note: string | null;
}

export interface SaleProduct {
  name: string;
  kind: string;
  robux: number;
  sales: number;
}

export interface SaleGame {
  /** null for sales not tied to an experience (clothing, UGC, ...). */
  universeId: number | null;
  placeId: number | null;
  name: string;
  robux: number;
  pending: number;
  sales: number;
  products: SaleProduct[];
}

export interface Sales {
  games: SaleGame[];
  total: number;
  count: number;
  /** The scan stopped at its page limit before reaching the start of the timeframe. */
  truncated: boolean;
  oldest: string | null;
  note: string | null;
}

export interface Rates {
  updated: string;
  /** Units of each currency per 1 USD. */
  rates: Record<string, number>;
}

export interface OwnerRef {
  kind: OwnerKind;
  id: string;
}

export interface Profile {
  id: number;
  name: string;
  displayName: string;
  headshotUrl: string | null;
  loggedIn: boolean;
}

export type Granularity = "OneMinute" | "HalfHour" | "OneHour" | "OneDay" | "OneWeek" | "OneMonth" | "None";

export interface AnalyticsQuery {
  metric: string;
  granularity: Granularity;
  /** RFC 3339, inclusive. */
  startTime: string;
  /** RFC 3339, exclusive. */
  endTime: string;
  breakdown?: string[];
  filter?: { dimension: string; values: string[]; operation: "In" | "NotIn" }[];
  limit?: number;
}

export interface AnalyticsSeries {
  breakdowns: { dimension: string; value: string; displayValue?: string | null }[];
  dataPoints: { time: string; value: number | null; status?: string | null }[];
}

export interface PayeeInfo {
  id: number;
  name: string;
  displayName: string;
  headshotUrl: string | null;
  /** Role in the group, or null when not a member. */
  roleName: string | null;
}

export type PayoutResult = { status: "paid" } | { status: "needsCode"; mediaType: string };

export type LoginResult =
  | { status: "captured"; user: CookieUser }
  | { status: "cancelled" }
  | { status: "timedOut" };

export const api = {
  secretsStatus: () => invoke<SecretsStatus>("secrets_status"),
  saveSecret: (name: SecretName, value: string) => invoke<void>("save_secret", { name, value }),
  clearSecret: (name: SecretName) => invoke<void>("clear_secret", { name }),
  clearCache: () => invoke<void>("clear_cache"),
  cookieUser: () => invoke<CookieUser>("cookie_user"),
  loginWithRoblox: () => invoke<LoginResult>("login_with_roblox"),
  listGroups: (userId: string, force = false) => invoke<Cached<GroupSummary[]>>("list_groups", { userId, force }),
  listGames: (owners: OwnerRef[], force = false) => invoke<Cached<Game[]>>("list_games", { owners, force }),
  groupFinance: (groupId: string, timeframe: Timeframe, force = false) => invoke<Cached<Finance>>("group_finance", { groupId, timeframe, force }),
  userFinance: (timeframe: Timeframe, force = false) => invoke<Cached<Finance>>("user_finance", { timeframe, force }),
  gameSales: (owner: OwnerRef, timeframe: Timeframe, force = false) =>
    invoke<Cached<Sales>>("game_sales", { ownerKind: owner.kind, ownerId: owner.id, timeframe, force }),
  profile: (userId: string, force = false) => invoke<Cached<Profile>>("profile", { userId, force }),
  analytics: (universeId: number, query: AnalyticsQuery, force = false) =>
    invoke<Cached<AnalyticsSeries[]>>("analytics_query", { universeId: String(universeId), query, force }),
  findPayees: (groupId: string, usernames: string[]) => invoke<PayeeInfo[]>("find_payees", { groupId, usernames }),
  groupPayout: (groupId: string, payees: { userId: number; amount: number }[]) => invoke<PayoutResult>("group_payout", { groupId, payees }),
  groupPayoutVerify: (code: string) => invoke<PayoutResult>("group_payout_verify", { code }),
  cancelPayout: () => invoke<void>("cancel_payout"),
  exchangeRates: (force = false) => invoke<Cached<Rates>>("exchange_rates", { force }),
};

/** Tauri rejects with the Rust error string; normalise anything else. */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

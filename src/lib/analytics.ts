import { api, type AnalyticsSeries, type Granularity } from "./api";
import { combine } from "./useLoad";

export type Unit = "count" | "percent" | "minutes" | "hours" | "seconds" | "robux" | "fps" | "raw";
/** How a metric's points summarise over a period: total, mean, or peak. */
export type Agg = "sum" | "avg" | "max";

export interface MetricDef {
  id: string;
  label: string;
  category: string;
  unit: Unit;
  agg: Agg;
  /** Whether a rise is good (colours the delta). */
  upIsGood: boolean;
  granularities: Granularity[];
  /** How far back Roblox keeps this metric. */
  maxDays: number;
  breakdowns: string[];
}

const USER = ["Platform", "OperatingSystem", "Country", "AgeGroupV2", "Gender", "Locale"];
const PERF = ["Platform", "OperatingSystem", "Place", "PlaceVersion", "MemoryGroup"];
const DAILY: Granularity[] = ["OneDay", "OneWeek", "OneMonth", "None"];
const FINE: Granularity[] = ["OneMinute", "HalfHour", "OneHour", "OneDay"];
const LONG = 1468;

const m = (id: string, label: string, category: string, unit: Unit, agg: Agg, granularities: Granularity[], breakdowns: string[], extra: Partial<MetricDef> = {}): MetricDef => ({
  id, label, category, unit, agg, granularities, breakdowns, upIsGood: true, maxDays: LONG, ...extra,
});

/** The metrics the dashboard offers, from Roblox's "Supported metrics and dimensions" docs. */
export const METRICS: MetricDef[] = [
  m("DailyActiveUsers", "Daily active users", "Engagement", "count", "avg", DAILY, [...USER, "IsNewUser", "AcquisitionSource"]),
  m("MonthlyActiveUsers", "Monthly active users", "Engagement", "count", "avg", ["OneDay"], [...USER, "IsNewUser"]),
  m("AveragePlayTimeMinutesPerDAU", "Average playtime per user", "Engagement", "minutes", "avg", DAILY, [...USER, "IsNewUser"]),
  m("AverageSessionLengthMinutes", "Average session length", "Engagement", "minutes", "avg", DAILY, [...USER, "IsNewUser"]),
  m("TotalPlayTimeHours", "Total playtime", "Engagement", "hours", "sum", DAILY, [...USER, "IsNewUser"]),
  m("Visits", "Sessions", "Engagement", "count", "sum", DAILY, [...USER, "IsNewUser"]),
  m("DauMauStickiness", "Stickiness (DAU/MAU)", "Engagement", "percent", "avg", ["OneDay"], USER),

  m("ForwardD1Retention", "Day 1 retention", "Retention", "percent", "avg", ["OneDay", "None"], [...USER, "AcquisitionSource"]),
  m("ForwardD7Retention", "Day 7 retention", "Retention", "percent", "avg", ["OneDay", "None"], [...USER, "AcquisitionSource"]),
  m("ForwardD30Retention", "Day 30 retention", "Retention", "percent", "avg", ["OneDay", "None"], [...USER, "AcquisitionSource"]),

  m("DailyRevenue", "Revenue", "Monetization", "robux", "sum", DAILY, ["RevenueSource", ...USER]),
  m("AverageRevenuePerUser", "Revenue per DAU (ARPDAU)", "Monetization", "robux", "avg", DAILY, USER),
  m("AverageRevenuePerPayingUser", "Revenue per payer (ARPPU)", "Monetization", "robux", "avg", DAILY, USER),
  m("PayingUsers", "Paying users", "Monetization", "count", "avg", DAILY, USER),
  m("PayingUsersCVR", "Payer conversion", "Monetization", "percent", "avg", DAILY, USER),

  m("UniqueUsersWithImpressions", "Users who saw the game", "Acquisition", "count", "sum", ["OneDay", "None"], ["AcquisitionSource", "Platform", "AgeGroupV2", "IsNewUser"]),
  m("ImpressionCVR", "Impression → play rate", "Acquisition", "percent", "avg", ["OneDay", "None"], ["AcquisitionSource", "Platform", "AgeGroupV2", "IsNewUser"]),
  m("QualifiedUniqueUsersWithPlaySessions", "Users with qualified plays", "Acquisition", "count", "sum", ["OneDay", "OneWeek", "None"], ["AcquisitionSource", "Platform", "AgeGroupV2", "IsNewUser"]),

  m("PeakConcurrentPlayers", "Peak concurrent players", "Performance", "count", "max", FINE, PERF, { maxDays: 28 }),
  m("ClientCrashRate15m", "Client crash rate", "Performance", "raw", "avg", FINE, PERF, { maxDays: 28, upIsGood: false }),
  m("ClientFpsAvg", "Client frame rate", "Performance", "fps", "avg", FINE, PERF, { maxDays: 28 }),
  m("ClientMemoryUsageAvg", "Client memory", "Performance", "raw", "avg", FINE, PERF, { maxDays: 28, upIsGood: false }),
  m("SessionDurationSecondsAvg", "Session time", "Performance", "seconds", "avg", FINE, PERF, { maxDays: 28 }),
  m("ServerFrameRateAvg", "Server frame rate", "Performance", "fps", "avg", FINE, ["Place"], { maxDays: 28 }),
  m("MemoryUsageAvg", "Server memory", "Performance", "raw", "avg", [...FINE, "None"], ["MemoryUsageCategory", "Place", "ServerAgeBucket"], { maxDays: 28, upIsGood: false }),
  m("CpuTimeAvg", "Server CPU time", "Performance", "raw", "avg", FINE, ["CpuTimeCategory", "Place"], { maxDays: 28, upIsGood: false }),
  m("ServerCrashCount", "Server crashes", "Performance", "count", "sum", FINE, ["CrashType", "Place"], { maxDays: 28, upIsGood: false }),

  m("TotalAbuseReports", "Abuse reports", "Safety", "count", "sum", ["OneDay"], [], { upIsGood: false }),
  m("AdsPublisherReportingTotalRevenueRobux", "Ad revenue", "Advertising", "robux", "sum", ["OneHour", "OneDay", "None"], []),
];

export const METRIC = new Map(METRICS.map(d => [d.id, d]));

export const DIMENSION_LABELS: Record<string, string> = {
  Platform: "Platform",
  OperatingSystem: "Operating system",
  Country: "Country",
  AgeGroupV2: "Age group",
  Gender: "Gender",
  Locale: "Language",
  IsNewUser: "New vs returning",
  AcquisitionSource: "Acquisition source",
  RevenueSource: "Revenue source",
  Place: "Place",
  PlaceVersion: "Place version",
  MemoryGroup: "Device memory",
  MemoryUsageCategory: "Memory category",
  ServerAgeBucket: "Server age",
  CpuTimeCategory: "CPU category",
  CrashType: "Crash type",
};

export type Range = "1d" | "7d" | "28d" | "90d" | "1y";
export const RANGES: { value: Range; label: string; days: number }[] = [
  { value: "1d", label: "24h", days: 1 },
  { value: "7d", label: "7D", days: 7 },
  { value: "28d", label: "28D", days: 28 },
  { value: "90d", label: "90D", days: 90 },
  { value: "1y", label: "1Y", days: 365 },
];

export interface TimeWindow {
  granularity: Granularity;
  /** Start of the shown period (ms). */
  start: number;
  end: number;
  /** Start of the previous period used for the delta, or null when Roblox doesn't keep that much history. */
  prevStart: number | null;
  days: number;
  /** Why the shown window differs from the chosen range, if it does. */
  note: string | null;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Pick a granularity and time window this metric supports for the chosen range. */
export function windowFor(def: MetricDef, range: Range, now = Date.now()): TimeWindow {
  let days = RANGES.find(r => r.value === range)!.days;
  let note: string | null = null;
  const has = (g: Granularity) => def.granularities.includes(g);

  if (days > def.maxDays) {
    days = def.maxDays;
    note = `Roblox keeps ${def.maxDays} days of this metric`;
  }
  let granularity: Granularity;
  if (days <= 7 && has("OneHour")) granularity = "OneHour";
  else if (has("OneDay")) granularity = days > 180 && has("OneWeek") ? "OneWeek" : "OneDay";
  else granularity = def.granularities[0];

  if (days < 2 && granularity === "OneDay") {
    days = 7;
    note = "Daily data only · showing 7 days";
  }

  // Hourly windows end at the current hour; daily ones at today's UTC midnight so a partial day isn't shown.
  const end = granularity === "OneHour" ? Math.floor(now / HOUR) * HOUR : Math.floor(now / DAY) * DAY;
  const start = end - days * DAY;
  const prevStart = 2 * days <= def.maxDays ? end - 2 * days * DAY : null;
  return { granularity, start, end, prevStart, days, note };
}

export interface Line {
  key: string;
  label: string;
  points: { t: number; v: number | null }[];
}

export interface MetricResult {
  lines: Line[];
  /** The total's values over the previous period, for the delta (none with a breakdown). */
  previous: (number | null)[] | null;
  window: TimeWindow;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Friendly names for Roblox's raw dimension values. */
const VALUE_LABELS: Record<string, string> = {
  RAQI_RESERVED_DIMENSION_VALUES_UNKNOWN: "Unknown",
  RAQI_RESERVED_DIMENSION_VALUES_OTHER: "Other",
  GamePass: "Game passes",
  DevProduct: "Developer products",
  DeveloperProduct: "Developer products",
  PrivateServer: "Private servers",
  PaidAccess: "Paid access",
  AvatarItem: "Avatar items",
  CommerceProduct: "Commerce products",
  EngagementPayout: "Engagement payouts",
  ImmersiveAds: "Immersive ads",
  RewardedVideoAds: "Rewarded ads",
  Subscription: "Subscriptions",
  true: "New users",
  false: "Returning users",
};

export function valueLabel(value: string, display?: string | null) {
  if (VALUE_LABELS[value]) return VALUE_LABELS[value];
  if (display && !display.startsWith("RAQI_")) return display;
  if (value.startsWith("RAQI_")) return "Unknown";
  // "MobileDevice" / "mobile_device" -> "Mobile device"
  const words = value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function toLines(series: AnalyticsSeries[]): Line[] {
  return series.map(s => ({
    key: s.breakdowns.map(b => `${b.dimension}=${b.value}`).join("&") || "total",
    label: s.breakdowns.map(b => valueLabel(b.value, b.displayValue)).join(" · ") || "Total",
    points: s.dataPoints.map(p => ({ t: Date.parse(p.time), v: p.value })).sort((a, b) => a.t - b.t),
  }));
}

const STEP: Partial<Record<Granularity, number>> = { OneHour: HOUR, OneDay: DAY };

/**
 * Roblox leaves out buckets with nothing in them (a day with no game-pass sales). For totals and peaks
 * that means zero, so fill those buckets in; for averages and rates a missing bucket is unknown, so leave it.
 * Only fills between the first and last bucket Roblox returned, so not-yet-computed recent days don't read as zero.
 */
function fillGaps(lines: Line[], def: MetricDef, granularity: Granularity): Line[] {
  const step = STEP[granularity];
  if (!step || def.agg === "avg") return lines;
  const times = lines.flatMap(l => l.points.map(p => p.t));
  if (!times.length) return lines;
  const first = Math.min(...times);
  const last = Math.max(...times);
  return lines.map(l => {
    const have = new Map(l.points.map(p => [p.t, p.v]));
    const points = [];
    for (let t = first; t <= last; t += step) points.push({ t, v: have.get(t) ?? 0 });
    return { ...l, points };
  });
}

/** At most this many breakdown values are charted (the categorical palette has four slots). */
export const MAX_LINES = 4;

/**
 * Fetch a metric for a universe. Fetches the previous period too (when Roblox keeps it) so a delta
 * can be shown. With a breakdown, first finds the top values over the window, then charts those.
 */
export async function fetchMetric(universeId: number, def: MetricDef, range: Range, breakdown: string | null, force: boolean) {
  const w = windowFor(def, range);
  const base = { metric: def.id, granularity: w.granularity, startTime: iso(w.prevStart ?? w.start), endTime: iso(w.end) };

  if (!breakdown) {
    const r = await api.analytics(universeId, base, force);
    const all = fillGaps(toLines(r.data), def, w.granularity)[0]?.points ?? [];
    const result: MetricResult = {
      lines: [{ key: "total", label: def.label, points: all.filter(p => p.t >= w.start) }],
      previous: w.prevStart != null ? all.filter(p => p.t < w.start).map(p => p.v) : null,
      window: w,
    };
    return { data: result, ...combine([r]) };
  }

  // Top values: ranked by Roblox over the whole window where "None" is supported, otherwise ranked locally.
  // Roblox rejects some ranked or filtered breakdowns (e.g. revenue by source), so each step falls back to a plain breakdown.
  const parts = [];
  let top: string[] = [];
  if (def.granularities.includes("None")) {
    try {
      const r = await api.analytics(universeId, { metric: def.id, granularity: "None", startTime: iso(w.start), endTime: iso(w.end), breakdown: [breakdown], limit: MAX_LINES }, force);
      parts.push(r);
      top = r.data.flatMap(s => s.breakdowns.filter(b => b.dimension === breakdown).map(b => b.value)).slice(0, MAX_LINES);
    } catch {
      top = [];
    }
  }
  const plain = { ...base, startTime: iso(w.start), breakdown: [breakdown] };
  let r;
  try {
    r = await api.analytics(universeId, top.length ? { ...plain, filter: [{ dimension: breakdown, values: top, operation: "In" as const }] } : plain, force);
  } catch (e) {
    if (!top.length) throw e;
    r = await api.analytics(universeId, plain, force);
  }
  parts.push(r);
  const lines = fillGaps(toLines(r.data), def, w.granularity)
    .map(l => ({ l, total: l.points.reduce((s, p) => s + (p.v ?? 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_LINES)
    .map(x => x.l);
  const result: MetricResult = { lines, previous: null, window: w };
  return { data: result, ...combine(parts) };
}

/** Summarise points over a period the way the metric aggregates. */
export function summarise(values: (number | null)[], agg: Agg): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (!v.length) return null;
  if (agg === "sum") return v.reduce((a, b) => a + b, 0);
  if (agg === "max") return Math.max(...v);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Roblox may report rates as 0–1 fractions; show them as percents either way. */
export function percentScale(lines: Line[]) {
  const max = Math.max(0, ...lines.flatMap(l => l.points.map(p => Math.abs(p.v ?? 0))));
  return max <= 1.0001 ? 100 : 1;
}

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const fixed1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** `digits` overrides the usual one decimal (axis ticks pass enough to tell neighbouring ticks apart). */
export function formatValue(v: number | null | undefined, unit: Unit, scale = 1, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = (x: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(x);
  switch (unit) {
    case "percent":
      return `${n(v * scale)}%`;
    case "minutes":
      return v >= 60 ? `${fixed1.format(v / 60)}h` : `${n(v)}m`;
    case "seconds":
      return v >= 60 ? `${fixed1.format(v / 60)}m` : `${n(v)}s`;
    case "hours":
      return `${compactFmt.format(v)}h`;
    case "robux":
      return `R$ ${Math.abs(v) >= 1000 ? compactFmt.format(v) : n(v)}`;
    case "fps":
      return `${n(v)} fps`;
    default:
      return Math.abs(v) >= 1000 ? compactFmt.format(v) : n(v);
  }
}

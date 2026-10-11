const grouped = new Intl.NumberFormat("en-US");

export const robux = (n: number) => `R$ ${grouped.format(n)}`;
export const count = (n: number) => grouped.format(n);

export function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount >= 1000 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Friendly names for Roblox's economy field names. Unknown fields fall back to `humanize`. */
const LABELS: Record<string, string> = {
  // Group revenue summary
  recurringRobuxStipend: "Premium stipend",
  itemSaleRobux: "Item sales",
  purchasedRobux: "Purchased Robux",
  tradeSystemRobux: "Trades",
  pendingRobux: "Pending",
  groupPayoutRobux: "Payouts to members",
  individualToGroupRobux: "Contributions to group",
  premiumPayouts: "Premium payouts",
  groupPremiumPayouts: "Group Premium payouts",
  adjustmentRobux: "Adjustments",
  immersiveAdPayouts: "Immersive ads",
  subscriptionPayouts: "Subscriptions",
  subscriptionClawbackPayouts: "Subscription clawbacks",
  affiliatePayoutRobux: "Affiliate payouts",
  // User transaction totals
  salesTotal: "Sales",
  purchasesTotal: "Purchases",
  affiliateSalesTotal: "Affiliate sales",
  groupPayoutsTotal: "Group payouts",
  currencyPurchasesTotal: "Robux bought",
  premiumStipendsTotal: "Premium stipend",
  tradeSystemEarningsTotal: "Trade earnings",
  tradeSystemCostsTotal: "Trade costs",
  premiumPayoutsTotal: "Premium payouts",
  groupPremiumPayoutsTotal: "Group Premium payouts",
  adSpendTotal: "Ad spend",
  developerExchangeTotal: "DevEx cash-outs",
  pendingRobuxTotal: "Pending",
  incomingRobuxTotal: "Total incoming",
  outgoingRobuxTotal: "Total outgoing",
  individualToGroupTotal: "Sent to groups",
  csAdjustmentTotal: "Support adjustments",
  adsRevsharePayoutsTotal: "Ad revenue share",
  groupAdsRevsharePayoutsTotal: "Group ad revenue share",
  subscriptionsRevshareTotal: "Subscriptions",
  groupSubscriptionsRevshareTotal: "Group subscriptions",
};

export function humanize(key: string) {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/(Robux|Total)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Fields that are spending, totals, or not-yet-earned — kept out of "earnings by source" charts. */
const NOT_EARNINGS = new Set([
  "pendingRobux", "groupPayoutRobux", "purchasedRobux",
  "pendingRobuxTotal", "incomingRobuxTotal", "outgoingRobuxTotal", "purchasesTotal", "tradeSystemCostsTotal",
  "adSpendTotal", "developerExchangeTotal", "individualToGroupTotal", "currencyPurchasesTotal",
]);

export function earningsBySource(breakdown: Record<string, number>) {
  return Object.entries(breakdown)
    .filter(([key, value]) => value > 0 && !NOT_EARNINGS.has(key) && !/clawback|outgoing|cost|spend/i.test(key))
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: humanize(key), value }));
}

export function pending(breakdown: Record<string, number> | null) {
  return breakdown?.pendingRobux ?? breakdown?.pendingRobuxTotal ?? null;
}

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const compact = (n: number) => compactFmt.format(n);

/** "just now", "4m ago", "2h ago", "3d ago". */
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Sum of earnings by source. */
export const earned = (breakdown: Record<string, number> | null) => (breakdown ? earningsBySource(breakdown).reduce((s, e) => s + e.value, 0) : 0);

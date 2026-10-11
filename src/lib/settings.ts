import type { Timeframe } from "./api";
import { createStore } from "./store";

/** Non-secret preferences. Secrets (API key, cookie) are kept by the Rust side in Windows Credential Manager. */
export interface Settings {
  userId: string;
  /** USD paid per Robux through Developer Exchange. */
  devexRate: number;
  currency: string;
  /** Groups where your rank is at or below this are ignored everywhere (rank 1 = plain member). */
  ignoreRankAtOrBelow: number;
  timeframe: Timeframe;
  /** Bumped when a default changes and saved settings need upgrading. */
  version: number;
}

// DevEx rate as of late 2025. Editable in Settings in case Roblox changes it.
export const DEFAULT_DEVEX_RATE = 0.0038;

export const useSettings = createStore<Settings>(
  "groupwise.settings",
  { userId: "", devexRate: DEFAULT_DEVEX_RATE, currency: "GBP", ignoreRankAtOrBelow: 1, timeframe: "Month", version: 2 },
  // v2: the secondary currency default moved from EUR to GBP.
  (s, raw) => ((raw.version ?? 1) < 2 ? { ...s, currency: "GBP", version: 2 } : s),
);

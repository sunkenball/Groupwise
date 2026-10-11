import { createContext, useContext } from "react";
import type { OwnerRef } from "./api";
import type { ItemId } from "./prefs";

export type View = "overview" | "funds" | "analytics" | "groups" | "settings";

export interface Nav {
  view: View;
  go: (view: View) => void;
  /** Open the detail drawer for a group or game. */
  open: (item: ItemId) => void;
  /** Go to Analytics with a group (and optionally one of its games) selected. */
  analytics: (owner: OwnerRef | null, universeId?: number | null) => void;
  /** Start a payout from a group's funds. */
  payout: (groupId: string) => void;
  /** Open the Ctrl+K quick switcher. */
  switcher: () => void;
}

export const NavContext = createContext<Nav>({ view: "overview", go: () => {}, open: () => {}, analytics: () => {}, payout: () => {}, switcher: () => {} });
export const useNav = () => useContext(NavContext);

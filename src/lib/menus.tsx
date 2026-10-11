import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink, Eye, EyeOff, HandCoins, LineChart, PanelRight, Pin, PinOff } from "lucide-react";
import type { MenuItem } from "@/components/ContextMenu";
import type { Game, GroupSummary } from "./api";
import { useData } from "./data";
import { useNav } from "./nav";
import { gameItem, groupItem, usePrefs } from "./prefs";
import { copy } from "./toast";

const I = 15;

/** Right-click menus for groups and games, shared by every list so they always offer the same actions. */
export function useMenus() {
  const nav = useNav();
  const { isPinned, isHidden, togglePin, toggleHidden } = usePrefs();
  const { hasCookie } = useData();

  const group = (g: GroupSummary): MenuItem[] => {
    const id = groupItem(g.id);
    const pinned = isPinned(id);
    const hidden = isHidden(id);
    return [
      { label: "Open details", icon: <PanelRight size={I} />, onSelect: () => nav.open(id) },
      { label: "View analytics", icon: <LineChart size={I} />, onSelect: () => nav.analytics({ kind: "group", id: g.id }) },
      ...(hasCookie ? [{ label: "Pay out Robux…", icon: <HandCoins size={I} />, onSelect: () => nav.payout(g.id) }] : []),
      "separator",
      { label: pinned ? "Unpin" : "Pin", icon: pinned ? <PinOff size={I} /> : <Pin size={I} />, onSelect: () => togglePin(id) },
      { label: hidden ? "Show again" : "Hide", icon: hidden ? <Eye size={I} /> : <EyeOff size={I} />, onSelect: () => toggleHidden(id) },
      "separator",
      { label: "Open on Roblox", icon: <ExternalLink size={I} />, onSelect: () => openUrl(`https://www.roblox.com/communities/${g.id}`) },
      { label: "Copy group ID", icon: <Copy size={I} />, hint: g.id, onSelect: () => copy(g.id, "group ID") },
    ];
  };

  const game = (g: Game): MenuItem[] => {
    const id = gameItem(g.universeId);
    const pinned = isPinned(id);
    const hidden = isHidden(id);
    return [
      { label: "Open details", icon: <PanelRight size={I} />, onSelect: () => nav.open(id) },
      { label: "View analytics", icon: <LineChart size={I} />, onSelect: () => nav.analytics({ kind: g.ownerKind, id: g.ownerId }, g.universeId) },
      "separator",
      { label: pinned ? "Unpin" : "Pin", icon: pinned ? <PinOff size={I} /> : <Pin size={I} />, onSelect: () => togglePin(id) },
      { label: hidden ? "Show again" : "Hide", icon: hidden ? <Eye size={I} /> : <EyeOff size={I} />, onSelect: () => toggleHidden(id) },
      "separator",
      { label: "Open game page", icon: <ExternalLink size={I} />, onSelect: () => openUrl(`https://www.roblox.com/games/${g.rootPlaceId}`) },
      { label: "Open in Creator Hub", icon: <ExternalLink size={I} />, onSelect: () => openUrl(`https://create.roblox.com/dashboard/creations/experiences/${g.universeId}/overview`) },
      { label: "Copy universe ID", icon: <Copy size={I} />, hint: String(g.universeId), onSelect: () => copy(String(g.universeId), "universe ID") },
      { label: "Copy place ID", icon: <Copy size={I} />, hint: String(g.rootPlaceId), onSelect: () => copy(String(g.rootPlaceId), "place ID") },
    ];
  };

  return { group, game };
}

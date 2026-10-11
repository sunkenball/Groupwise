import { createStore } from "./store";

/** "group:123" or "game:456" (universe ID). */
export type ItemId = `group:${string}` | `game:${string}`;

export interface Prefs {
  /** Pinned items in the order they were pinned. Pinned groups also get their funds and games tracked. */
  pins: ItemId[];
  /** Items hidden from lists and totals. */
  hidden: ItemId[];
}

const usePrefsStore = createStore<Prefs>("groupwise.prefs", { pins: [], hidden: [] });

export const groupItem = (id: string): ItemId => `group:${id}`;
export const gameItem = (universeId: number | string): ItemId => `game:${universeId}`;

export function usePrefs() {
  const [prefs, update] = usePrefsStore();
  const toggle = (list: "pins" | "hidden", id: ItemId) =>
    update(p => ({ [list]: p[list].includes(id) ? p[list].filter(x => x !== id) : [...p[list], id] }));
  const move = (id: ItemId, by: number) =>
    update(p => {
      const pins = [...p.pins];
      const from = pins.indexOf(id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= pins.length) return {};
      pins.splice(to, 0, ...pins.splice(from, 1));
      return { pins };
    });
  return {
    prefs,
    isPinned: (id: ItemId) => prefs.pins.includes(id),
    isHidden: (id: ItemId) => prefs.hidden.includes(id),
    togglePin: (id: ItemId) => toggle("pins", id),
    toggleHidden: (id: ItemId) => toggle("hidden", id),
    movePin: move,
    update,
    /** Replace the pin order (drag to reorder). */
    setPins: (pins: ItemId[]) => update({ pins }),
  };
}

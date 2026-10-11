import { useCallback, useSyncExternalStore } from "react";

/** A tiny localStorage-backed store shared by every component that reads it. */
/** `migrate` upgrades a stored value from an older shape: it gets the stored object merged over the defaults, plus the raw stored object. */
export function createStore<T extends object>(storageKey: string, defaults: T, migrate?: (merged: T, raw: Partial<T>) => T, persist = true) {
  let value: T = (() => {
    if (!persist) return defaults;
    try {
      // Fall back to the key used before the rename to Groupwise.
      const raw = localStorage.getItem(storageKey) ?? localStorage.getItem(storageKey.replace(/^groupwise\./, "dev-dashboard."));
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      const stored = { ...defaults, ...parsed };
      return migrate ? migrate(stored, parsed) : stored;
    } catch {
      return defaults;
    }
  })();
  const listeners = new Set<() => void>();

  const set = (patch: Partial<T> | ((prev: T) => Partial<T>)) => {
    value = { ...value, ...(typeof patch === "function" ? patch(value) : patch) };
    try {
      if (persist) localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage unavailable; the change still applies for this session.
    }
    listeners.forEach(l => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  function useStore() {
    const current = useSyncExternalStore(subscribe, () => value);
    const update = useCallback(set, []);
    return [current, update] as const;
  }
  // Also usable outside components (e.g. a context-menu action that opens Analytics on a game).
  return Object.assign(useStore, { set, get: () => value });
}

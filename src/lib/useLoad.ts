import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { errorText, type Cached } from "./api";

export interface Load<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** When the shown data was fetched from Roblox (ms). */
  fetchedAt: number | null;
  /** Roblox refused the latest refresh; `data` is older. */
  stale: boolean;
  /** Bypass the cache and fetch from Roblox again. */
  reload: () => void;
}

/** Bumped by the header's Refresh button; every mounted load force-refreshes when it changes. */
const RefreshContext = createContext(0);
export const RefreshProvider = RefreshContext.Provider;

interface State<T> {
  key: string;
  data: T | null;
  fetchedAt: number | null;
  stale: boolean;
  error: string | null;
  loading: boolean;
}

/**
 * Runs `fn` whenever `deps` change (skipped while `enabled` is false). The Rust side caches, so a plain
 * run is cheap; `reload()` and the global refresh pass `force` to go to Roblox. Data from a previous
 * refresh stays visible while reloading and when a refresh fails.
 */
export function useCached<T>(fn: (force: boolean) => Promise<Cached<T>>, deps: unknown[], enabled = true): Load<T> {
  const key = JSON.stringify(deps);
  const refresh = useContext(RefreshContext);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ key, data: null, fetchedAt: null, stale: false, error: null, loading: enabled });
  const run = useRef(0);
  const last = useRef({ key, tick, refresh });

  useEffect(() => {
    const prev = last.current;
    const force = prev.key === key && (prev.tick !== tick || prev.refresh !== refresh);
    last.current = { key, tick, refresh };
    if (!enabled) {
      setState({ key, data: null, fetchedAt: null, stale: false, error: null, loading: false });
      return;
    }
    const id = ++run.current;
    setState(s => (s.key === key ? { ...s, loading: true, error: null } : { key, data: null, fetchedAt: null, stale: false, error: null, loading: true }));
    fn(force).then(
      r => id === run.current && setState({ key, data: r.data, fetchedAt: r.fetchedAt, stale: r.stale, error: null, loading: false }),
      e => id === run.current && setState(s => ({ ...s, key, error: errorText(e), loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, tick, refresh]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    fetchedAt: current ? state.fetchedAt : null,
    stale: current && state.stale,
    error: current ? state.error : null,
    loading: !current ? enabled : state.loading,
    reload,
  };
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Combine several cached results: oldest fetch time, stale if any part is. */
export function combine<T>(parts: Cached<T>[]): { fetchedAt: number; stale: boolean } {
  return {
    fetchedAt: parts.length ? Math.min(...parts.map(p => p.fetchedAt)) : Date.now(),
    stale: parts.some(p => p.stale),
  };
}

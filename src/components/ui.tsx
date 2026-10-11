import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Clock, Eye, EyeOff, Pin, ThumbsUp, TriangleAlert, X } from "lucide-react";
import type { Game } from "@/lib/api";
import { count } from "@/lib/format";
import { ago } from "@/lib/format";
import { usePrefs, type ItemId } from "@/lib/prefs";
import type { Load } from "@/lib/useLoad";

/** Square icon with a letter fallback when Roblox has no thumbnail. */
export function Thumb({ src, name, size = 36 }: { src: string | null | undefined; name: string; size?: number }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  return src ? (
    <img className="thumb" src={src} alt="" style={style} loading="lazy" />
  ) : (
    <span className="thumb thumb-fallback" style={{ ...style, fontSize: size * 0.42 }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function PinButton({ id, label }: { id: ItemId; label: string }) {
  const { isPinned, togglePin } = usePrefs();
  const pinned = isPinned(id);
  return (
    <button
      type="button"
      className={`icon-btn ${pinned ? "is-on" : ""}`}
      aria-pressed={pinned}
      title={pinned ? `Unpin ${label}` : `Pin ${label}`}
      aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
      onClick={e => {
        e.stopPropagation();
        togglePin(id);
      }}
    >
      {pinned ? <Pin size={15} fill="currentColor" /> : <Pin size={15} />}
    </button>
  );
}

export function HideButton({ id, label }: { id: ItemId; label: string }) {
  const { isHidden, toggleHidden } = usePrefs();
  const hidden = isHidden(id);
  return (
    <button
      type="button"
      className="icon-btn"
      title={hidden ? `Show ${label}` : `Hide ${label} from lists and totals`}
      aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
      onClick={e => {
        e.stopPropagation();
        toggleHidden(id);
      }}
    >
      {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
    </button>
  );
}

/** "Updated 3m ago", or a warning when Roblox refused the refresh and older data is shown. */
export function Freshness({ load }: { load: Pick<Load<unknown>, "fetchedAt" | "stale" | "loading"> }) {
  if (load.loading && !load.fetchedAt) return <span className="fresh">Loading…</span>;
  if (!load.fetchedAt) return null;
  if (load.stale)
    return (
      <span className="fresh fresh-stale" title="Roblox is rate limiting. Showing the last data that loaded.">
        <TriangleAlert size={12} /> Saved {ago(load.fetchedAt)}
      </span>
    );
  return (
    <span className="fresh">
      <Clock size={12} /> {load.loading ? "Refreshing…" : `Updated ${ago(load.fetchedAt)}`}
    </span>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Close className="icon-btn drawer-close" aria-label="Close">
            <X size={16} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <TriangleAlert size={15} />
      <span>{children}</span>
    </div>
  );
}

/** Horizontal share bar, e.g. this group's part of total funds. */
export function Share({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <span className="share" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

/** Share of thumbs-up votes, or null when nobody has voted. */
export function likeRatio(g: Pick<Game, "upVotes" | "downVotes">) {
  const total = (g.upVotes ?? 0) + (g.downVotes ?? 0);
  return total > 0 ? g.upVotes / total : null;
}

/**
 * "👍 87%" with the vote counts on hover. With no votes it renders nothing, or "—" in tables (`showEmpty`).
 * `prefix` (e.g. " · ") is only shown alongside a rating, so inline lists don't end in a stray separator.
 */
export function Rating({ game, prefix = "", showEmpty = false }: { game: Pick<Game, "upVotes" | "downVotes">; prefix?: string; showEmpty?: boolean }) {
  const r = likeRatio(game);
  if (r == null) return showEmpty ? <span className="rating muted" title="No votes yet">—</span> : null;
  const tone = r >= 0.8 ? "good" : r >= 0.6 ? "ok" : "bad";
  return (
    <>
      {prefix}
      <span className={`rating rating-${tone}`} title={`${count(game.upVotes)} likes · ${count(game.downVotes)} dislikes`}>
        <ThumbsUp size={12} />
        {Math.round(r * 100)}%
      </span>
    </>
  );
}

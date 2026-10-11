import { useMemo, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { Thumb } from "@/components/ui";
import { useData } from "@/lib/data";
import { compact } from "@/lib/format";
import { useNav, type View } from "@/lib/nav";
import { gameItem, groupItem, usePrefs } from "@/lib/prefs";

export interface ViewEntry {
  view: View;
  label: string;
  icon: ReactNode;
}

type Result = { key: string; label: string; meta: string; icon: ReactNode; open: () => void; analytics?: () => void; score: number };

/** Ctrl+K: jump to any page, group or game by typing part of its name. */
export function QuickSwitcher({ open, onClose, views }: { open: boolean; onClose: () => void; views: ViewEntry[] }) {
  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="modal switcher" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Quick switcher</Dialog.Title>
          {open && <Switcher onClose={onClose} views={views} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function score(name: string, q: string) {
  const n = name.toLowerCase();
  if (!q) return 1;
  if (n.startsWith(q)) return 3;
  if (n.split(/[\s\-_]+/).some(w => w.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

function Switcher({ onClose, views }: { onClose: () => void; views: ViewEntry[] }) {
  const nav = useNav();
  const { groups, games, ownerName } = useData();
  const { isPinned, isHidden } = usePrefs();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    const out: Result[] = [];
    for (const v of views) {
      const s = score(v.label, q);
      if (s) out.push({ key: `view:${v.view}`, label: v.label, meta: "Page", icon: <span className="sw-icon">{v.icon}</span>, open: () => nav.go(v.view), score: s + (q ? 0.5 : 2) });
    }
    for (const g of games.data ?? []) {
      const s = score(g.name, q);
      if (!s) continue;
      const id = gameItem(g.universeId);
      out.push({
        key: id,
        label: g.name,
        meta: `Game · ${ownerName({ kind: g.ownerKind, id: g.ownerId })} · ${compact(g.playing)} playing`,
        icon: <Thumb src={g.iconUrl} name={g.name} size={26} />,
        open: () => nav.open(id),
        analytics: () => nav.analytics({ kind: g.ownerKind, id: g.ownerId }, g.universeId),
        score: s + (isPinned(id) ? 0.3 : 0) - (isHidden(id) ? 0.5 : 0),
      });
    }
    for (const g of groups.data ?? []) {
      const s = score(g.name, q);
      if (!s) continue;
      const id = groupItem(g.id);
      out.push({
        key: id,
        label: g.name,
        meta: `Group · ${g.roleName}`,
        icon: <Thumb src={g.iconUrl} name={g.name} size={26} />,
        open: () => nav.open(id),
        analytics: () => nav.analytics({ kind: "group", id: g.id }),
        score: s + (isPinned(id) ? 0.3 : 0) + (g.isOwner ? 0.1 : 0) - (isHidden(id) ? 0.5 : 0),
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, games.data, groups.data, views]);

  const run = (r: Result | undefined, analytics: boolean) => {
    if (!r) return;
    onClose();
    (analytics && r.analytics ? r.analytics : r.open)();
  };

  return (
    <div
      className="sw"
      onKeyDown={e => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length);
          setActive(next);
          document.getElementById(`sw-${next}`)?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
          e.preventDefault();
          run(results[active], e.ctrlKey || e.metaKey);
        }
      }}
    >
      <label className="sw-search">
        <Search size={16} />
        <input
          autoFocus
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Jump to a page, group or game"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="sw-list"
          aria-activedescendant={results[active] ? `sw-${active}` : undefined}
        />
      </label>
      <ul className="sw-list" id="sw-list" role="listbox">
        {results.map((r, i) => (
          <li key={r.key} id={`sw-${i}`} role="option" aria-selected={i === active} className={`sw-item ${i === active ? "is-active" : ""}`} onPointerMove={() => setActive(i)} onClick={() => run(r, false)}>
            {r.icon}
            <span className="row-main">
              <span className="truncate">{r.label}</span>
              <span className="muted small truncate">{r.meta}</span>
            </span>
          </li>
        ))}
        {!results.length && <li className="sw-empty muted small">Nothing matches “{query}”.</li>}
      </ul>
      <div className="sw-foot muted">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> analytics</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { BadgeCheck, Crown, Search, Users } from "lucide-react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Alert, Empty, Freshness, HideButton, PinButton, Skeleton, Thumb } from "@/components/ui";
import { useContextMenu } from "@/components/ContextMenu";
import { useData } from "@/lib/data";
import { useMenus } from "@/lib/menus";
import { compact } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { groupItem, usePrefs } from "@/lib/prefs";
import { useSettings } from "@/lib/settings";

type Filter = "all" | "tracked" | "hidden";

export function Groups() {
  const [settings] = useSettings();
  const { groups, ignoredCount } = useData();
  const { isPinned, isHidden, prefs } = usePrefs();
  const { open, go } = useNav();
  const menu = useContextMenu();
  const menus = useMenus();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (groups.data ?? [])
      .filter(g => {
        const id = groupItem(g.id);
        if (filter === "hidden") return isHidden(id);
        if (isHidden(id)) return false;
        if (filter === "tracked") return g.isOwner || isPinned(id);
        return true;
      })
      .filter(g => !q || g.name.toLowerCase().includes(q) || g.id.includes(q) || g.roleName.toLowerCase().includes(q))
      .sort((a, b) => Number(isPinned(groupItem(b.id))) - Number(isPinned(groupItem(a.id))) || b.rank - a.rank || b.memberCount - a.memberCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.data, query, filter, prefs]);

  const hiddenCount = (groups.data ?? []).filter(g => isHidden(groupItem(g.id))).length;

  return (
    <div className="stack">
      {groups.error && <Alert>{groups.error}</Alert>}

      <div className="toolbar">
        <label className="search">
          <Search size={15} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search groups, roles or IDs" aria-label="Search groups" />
        </label>
        <SegmentedControl
          label="Filter groups"
          options={[
            { value: "all", label: "All" },
            { value: "tracked", label: "Owned & pinned" },
            { value: "hidden", label: `Hidden${hiddenCount ? ` (${hiddenCount})` : ""}` },
          ]}
          value={filter}
          onValueChange={v => setFilter(v as Filter)}
        />
      </div>

      <section className="panel flush">
        <div className="panel-head padded">
          <h3>{list.length} {list.length === 1 ? "group" : "groups"}</h3>
          <Freshness load={groups} />
        </div>
        {!groups.data && groups.loading ? (
          <Skeleton rows={5} />
        ) : !list.length ? (
          <Empty icon={<Users size={18} />} title={filter === "hidden" ? "No hidden groups" : "No groups match"} />
        ) : (
          <div className="table groups">
            <div className="tr th">
              <span />
              <span>Group</span>
              <span>Your role</span>
              <span className="num hide-sm">Rank</span>
              <span className="num">Members</span>
              <span />
            </div>
            {list.map(g => {
              const id = groupItem(g.id);
              return (
                <div key={g.id} className={`tr tr-click ${isHidden(id) ? "is-dim" : ""}`} onClick={() => open(id)} onContextMenu={e => menu(e, menus.group(g))}>
                  <PinButton id={id} label={g.name} />
                  <span className="cell-main">
                    <Thumb src={g.iconUrl} name={g.name} size={32} />
                    <span className="row-main">
                      <span className="truncate">
                        {g.name} {g.verified && <BadgeCheck size={13} className="verified" aria-label="Verified" />}
                      </span>
                      <span className="muted small">ID {g.id}</span>
                    </span>
                  </span>
                  <span className="role">
                    {g.isOwner && <Crown size={13} aria-label="Owner" />}
                    <span className="truncate">{g.roleName}</span>
                  </span>
                  <span className="num hide-sm">{g.rank}</span>
                  <span className="num">{compact(g.memberCount)}</span>
                  <HideButton id={id} label={g.name} />
                </div>
              );
            })}
          </div>
        )}
        {ignoredCount > 0 && (
          <p className="muted small padded foot">
            {ignoredCount} {ignoredCount === 1 ? "group where" : "groups where"} your rank is {settings.ignoreRankAtOrBelow} or lower {ignoredCount === 1 ? "is" : "are"} ignored.{" "}
            <button type="button" className="link" onClick={() => go("settings")}>Change in Settings</button>
          </p>
        )}
      </section>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { Granularity } from "@/lib/api";
import { formatValue, type Line, type Unit } from "@/lib/analytics";

/** Time-series chart: lines (any number of series, up to the 4-slot palette) or columns (one series). */
export function TimeChart({ lines, unit, scale = 1, kind = "line", granularity, height = 180 }: {
  lines: Line[];
  unit: Unit;
  /** Multiplier applied when formatting (e.g. 100 for fractions shown as percents). */
  scale?: number;
  kind?: "line" | "bar";
  granularity: Granularity;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const times = useMemo(() => [...new Set(lines.flatMap(l => l.points.map(p => p.t)))].sort((a, b) => a - b), [lines]);
  const byTime = useMemo(() => lines.map(l => new Map(l.points.map(p => [p.t, p.v]))), [lines]);
  const bars = kind === "bar" && lines.length === 1;

  const values = lines.flatMap(l => l.points.map(p => p.v).filter((v): v is number => v != null));
  const { ticks, step } = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  // Enough decimals that neighbouring ticks never read the same (0.05 steps -> 2 decimals).
  const digits = Math.max(0, Math.ceil(-Math.log10(step * scale) - 1e-9));
  const tickText = (v: number) => formatValue(v, unit, scale, digits);
  const longest = Math.max(...ticks.map(t => tickText(t).length));

  const pad = { top: 10, right: 12, bottom: 24, left: Math.ceil(longest * 6.2) + 14 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const y = (v: number) => pad.top + h - ((v - min) / (max - min || 1)) * h;
  const slot = times.length ? w / times.length : w;
  const x = (i: number) => pad.left + (bars ? slot * (i + 0.5) : times.length > 1 ? (w * i) / (times.length - 1) : w / 2);

  const fmt = (v: number | null | undefined) => formatValue(v, unit, scale);
  const labelEvery = Math.max(1, Math.ceil(times.length / Math.max(2, Math.floor(w / 80))));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!times.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = bars ? Math.floor(px / slot) : Math.round((px / (rect.width || 1)) * (times.length - 1));
    setHover(Math.max(0, Math.min(times.length - 1, i)));
  };

  const tipLeft = hover != null ? x(hover) : 0;

  return (
    <div className="tchart" ref={box}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={lines.map(l => l.label).join(", ")}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} className="tchart-grid" />
              <text x={pad.left - 8} y={y(t)} className="tchart-tick" textAnchor="end" dominantBaseline="middle">
                {tickText(t)}
              </text>
            </g>
          ))}
          {times.map((t, i) =>
            i % labelEvery === 0 ? (
              <text key={t} x={x(i)} y={height - 6} className="tchart-tick" textAnchor="middle">
                {timeLabel(t, granularity)}
              </text>
            ) : null,
          )}

          {bars
            ? times.map((t, i) => {
                const v = byTime[0].get(t);
                if (v == null) return null;
                const bw = Math.max(2, Math.min(24, slot - 2));
                return <path key={t} d={column(x(i) - bw / 2, y(Math.max(0, v)), bw, Math.abs(y(v) - y(0)))} fill="var(--series-1)" opacity={hover == null || hover === i ? 1 : 0.55} />;
              })
            : lines.map((l, si) => {
                const d = linePath(times, byTime[si], x, y);
                return (
                  <g key={l.key}>
                    {lines.length === 1 && <path d={areaPath(times, byTime[si], x, y, y(Math.max(0, min)))} fill={`var(--series-${si + 1})`} opacity={0.1} />}
                    <path d={d} fill="none" stroke={`var(--series-${si + 1})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}

          {hover != null && !bars && (
            <>
              <line x1={tipLeft} x2={tipLeft} y1={pad.top} y2={pad.top + h} className="tchart-cross" />
              {lines.map((l, si) => {
                const v = byTime[si].get(times[hover]);
                return v == null ? null : <circle key={l.key} cx={tipLeft} cy={y(v)} r={4} fill={`var(--series-${si + 1})`} stroke="var(--surface)" strokeWidth={2} />;
              })}
            </>
          )}

          <rect x={pad.left} y={pad.top} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}

      {hover != null && times[hover] != null && (
        <div className="tchart-tip" style={{ left: Math.min(Math.max(tipLeft, 70), width - 70), top: 0 }}>
          <span className="muted small">{fullTimeLabel(times[hover], granularity)}</span>
          {lines.map((l, si) => (
            <span key={l.key} className="tchart-tip-row">
              <span className="key" style={{ background: `var(--series-${si + 1})` }} />
              <strong>{fmt(byTime[si].get(times[hover]))}</strong>
              {lines.length > 1 && <span className="muted small truncate">{l.label}</span>}
            </span>
          ))}
        </div>
      )}

      {lines.length > 1 && (
        <ul className="tchart-legend">
          {lines.map((l, si) => (
            <li key={l.key}>
              <span className="key" style={{ background: `var(--series-${si + 1})` }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tiny trend line for stat tiles. Stretches to its container's width. */
export function Sparkline({ values, height = 32 }: { values: (number | null)[]; height?: number }) {
  const nums = values.filter((n): n is number => n != null && Number.isFinite(n));
  if (nums.length < 2) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const W = 100;
  const px = (i: number) => (i / (values.length - 1)) * W;
  const py = (n: number) => height - 2 - ((n - lo) / (hi - lo || 1)) * (height - 4);
  let d = "";
  values.forEach((n, i) => {
    if (n == null || !Number.isFinite(n)) return;
    d += `${d ? "L" : "M"}${px(i).toFixed(2)},${py(n).toFixed(2)}`;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Unknown buckets (no value) are bridged rather than breaking the line into fragments. */
function linePath(times: number[], vals: Map<number, number | null>, x: (i: number) => number, y: (v: number) => number) {
  let d = "";
  times.forEach((t, i) => {
    const v = vals.get(t);
    if (v == null) return;
    d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  return d;
}

function areaPath(times: number[], vals: Map<number, number | null>, x: (i: number) => number, y: (v: number) => number, base: number) {
  const pts = times.map((t, i) => ({ i, v: vals.get(t) })).filter((p): p is { i: number; v: number } => p.v != null);
  if (pts.length < 2) return "";
  return `M${x(pts[0].i)},${base}` + pts.map(p => `L${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("") + `L${x(pts[pts.length - 1].i)},${base}Z`;
}

/** Column with a 4px rounded data end, square at the baseline. */
function column(x0: number, top: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x0},${top + h}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${top + h}Z`;
}

/** About four round-numbered gridlines (1, 2, 2.5 or 5 x 10^k apart) covering [lo, hi]. */
function niceTicks(lo: number, hi: number) {
  if (hi - lo <= 0) hi = lo + 1;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { ticks, step };
}

const fine = (g: Granularity) => g === "OneMinute" || g === "HalfHour" || g === "OneHour";

function timeLabel(t: number, g: Granularity) {
  const d = new Date(t);
  return fine(g) ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fullTimeLabel(t: number, g: Granularity) {
  const d = new Date(t);
  if (fine(g)) return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (g === "OneWeek") return `Week of ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

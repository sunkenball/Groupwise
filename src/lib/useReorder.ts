import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD = 5;

/**
 * Pointer-driven drag to reorder, for lists and grids alike. While dragging, `order` is the live
 * preview (render items in that order); dropping calls `onChange` with the new order. A press that
 * doesn't move past a few pixels stays a normal click.
 */
export function useReorder<T extends string>(ids: T[], onChange: (ids: T[]) => void) {
  const nodes = useRef(new Map<T, HTMLElement>());
  const [drag, setDrag] = useState<{ id: T; order: T[] } | null>(null);
  const live = useRef<{ id: T; startX: number; startY: number; active: boolean; slots: { id: T; x: number; y: number }[]; order: T[] } | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const onMove = useCallback((e: PointerEvent) => {
    const s = live.current;
    if (!s) return;
    if (!s.active) {
      if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < THRESHOLD) return;
      s.active = true;
      // Snapshot slot centres once; the preview reorders items but the slots stay where they were.
      s.slots = idsRef.current.flatMap(id => {
        const r = nodes.current.get(id)?.getBoundingClientRect();
        return r ? [{ id, x: r.left + r.width / 2, y: r.top + r.height / 2 }] : [];
      });
      document.body.classList.add("is-reordering");
    }
    const nearest = s.slots.reduce((best, slot, i) => {
      const d = Math.hypot(slot.x - e.clientX, slot.y - e.clientY);
      return d < best.d ? { i, d } : best;
    }, { i: 0, d: Infinity }).i;
    const order = idsRef.current.filter(id => id !== s.id);
    order.splice(nearest, 0, s.id);
    if (order.join() !== s.order.join()) {
      s.order = order;
      setDrag({ id: s.id, order });
    }
  }, []);

  const onUp = useCallback(() => {
    const s = live.current;
    live.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.classList.remove("is-reordering");
    if (s?.active) {
      // The pointerup becomes a click on whatever is under it; swallow that one click.
      // It fires in the same task as pointerup, so drop the swallower right after in case no click comes.
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (s.order.join() !== idsRef.current.join()) changeRef.current(s.order);
    }
    setDrag(null);
  }, [onMove]);

  useEffect(() => () => onUp(), [onUp]);

  const bind = (id: T) => ({
    ref: (el: HTMLElement | null) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("[data-no-drag]")) return;
      live.current = { id, startX: e.clientX, startY: e.clientY, active: false, slots: [], order: idsRef.current };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    "data-dragging": drag?.id === id ? "" : undefined,
  });

  return { order: drag?.order ?? ids, dragging: drag?.id ?? null, bind };
}

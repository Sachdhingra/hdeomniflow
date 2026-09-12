/**
 * Ordering helpers for kiosk scheme banners.
 *
 * `sort_order` decides the rotation order of the kiosk screensaver, so it has
 * to stay distinct and sequential. Banners created before uploads stopped
 * numbering by row count can share a value, which is why reordering rewrites
 * positions instead of swapping two numbers.
 */

export interface Orderable {
  id: string;
  sort_order: number;
}

/** Move the item at `index` one step in `direction`; returns `list` unchanged at the ends. */
export function moveBanner<T extends Orderable>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The `sort_order` writes needed to persist `list`'s current order — rows already correct are skipped. */
export function orderUpdates<T extends Orderable>(list: T[]): { id: string; sort_order: number }[] {
  return list
    .map((item, i) => ({ id: item.id, sort_order: i }))
    .filter((update, i) => list[i].sort_order !== update.sort_order);
}

/** Next `sort_order` for a new banner — past the end even when existing rows collide. */
export function nextSortOrder(list: Orderable[]): number {
  return list.reduce((max, b) => Math.max(max, b.sort_order), -1) + 1;
}

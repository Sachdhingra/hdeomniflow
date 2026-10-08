import { describe, expect, it } from "vitest";
import { moveBanner, nextSortOrder, orderUpdates } from "@/lib/bannerOrder";

const list = (...orders: number[]) =>
  orders.map((sort_order, i) => ({ id: `b${i}`, sort_order }));

describe("moveBanner", () => {
  it("swaps with the neighbour in the given direction", () => {
    const moved = moveBanner(list(0, 1, 2), 2, -1);
    expect(moved.map((b) => b.id)).toEqual(["b0", "b2", "b1"]);
  });

  it("returns the same list at either end", () => {
    const original = list(0, 1, 2);
    expect(moveBanner(original, 0, -1)).toBe(original);
    expect(moveBanner(original, 2, 1)).toBe(original);
  });
});

describe("orderUpdates", () => {
  it("only writes rows whose position changed", () => {
    expect(orderUpdates(moveBanner(list(0, 1, 2), 1, 1))).toEqual([
      { id: "b2", sort_order: 1 },
      { id: "b1", sort_order: 2 },
    ]);
  });

  it("is empty when the order already matches", () => {
    expect(orderUpdates(list(0, 1, 2))).toEqual([]);
  });

  it("resequences rows that share a sort_order", () => {
    expect(orderUpdates(list(2, 2, 2))).toEqual([
      { id: "b0", sort_order: 0 },
      { id: "b1", sort_order: 1 },
    ]);
  });
});

describe("nextSortOrder", () => {
  it("starts at 0 for an empty list", () => {
    expect(nextSortOrder([])).toBe(0);
  });

  it("goes past the highest value, not the row count", () => {
    // The old `banners.length` collided after a delete: two rows, highest 2.
    expect(nextSortOrder(list(0, 2))).toBe(3);
  });
});

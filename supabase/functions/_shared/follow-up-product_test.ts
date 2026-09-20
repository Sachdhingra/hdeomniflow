import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { followUpProduct } from "./follow-up-product.ts";

Deno.test("prefers a named product over a category", () => {
  assertEquals(followUpProduct({ liked_product: "Windsor sofa cum bed", category: "sofa" }), "Windsor sofa cum bed");
});

Deno.test("adds useful wording for category-only leads", () => {
  assertEquals(followUpProduct({ category: "almirah" }), "a wardrobe with useful organised storage");
  assertEquals(followUpProduct({ category: "mattress" }), "a supportive mattress for comfortable sleep");
});

Deno.test("uses a safe fallback without claiming stock or price", () => {
  assertEquals(followUpProduct({}), "furniture suited to your home and space");
});
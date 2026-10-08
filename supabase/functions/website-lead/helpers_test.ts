import { assertEquals } from "jsr:@std/assert@1";
import { categoryFromEnquiry, cleanRefCode } from "./helpers.ts";

Deno.test("cleanRefCode keeps valid codes and lowercases them", () => {
  assertEquals(cleanRefCode(" Rahul-Sharma "), "rahul-sharma");
  assertEquals(cleanRefCode("rahul sharma"), "");
  assertEquals(cleanRefCode("<script>"), "");
  assertEquals(cleanRefCode(undefined), "");
});

Deno.test("categoryFromEnquiry prefers the product, then the room", () => {
  assertEquals(categoryFromEnquiry("Living Room", "Queen bed with hydraulic storage"), "bed");
  assertEquals(categoryFromEnquiry("Modular Kitchen", ""), "kitchen");
  assertEquals(categoryFromEnquiry("Home Office", "Ergonomic mesh office chair"), "chair");
  assertEquals(categoryFromEnquiry("Storage", ""), "almirah");
  assertEquals(categoryFromEnquiry("Something else", ""), "others");
});

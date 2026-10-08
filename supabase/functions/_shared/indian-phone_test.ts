import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { indianPhoneLastTen, normalizeIndianPhone } from "./indian-phone.ts";

Deno.test("normalizes Indian mobile numbers with repeated country prefixes", () => {
  assertEquals(normalizeIndianPhone("9876543210"), "+919876543210");
  assertEquals(normalizeIndianPhone("919876543210"), "+919876543210");
  assertEquals(normalizeIndianPhone("+91 91 98765 43210"), "+919876543210");
  assertEquals(indianPhoneLastTen("whatsapp:+91919876543210"), "9876543210");
});

Deno.test("rejects invalid Indian mobile numbers", () => {
  assertEquals(normalizeIndianPhone("12345"), "");
  assertEquals(normalizeIndianPhone("+911234567890"), "");
  assertEquals(normalizeIndianPhone("will plan till next month"), "");
});
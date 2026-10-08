import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isWhatsAppWorthyStaffAlert, staffWhatsAppRoles, templateText } from "./staff-whatsapp.ts";

Deno.test("mirrors lead, order and broadcast alerts to WhatsApp", () => {
  assertEquals(isWhatsAppWorthyStaffAlert("lead_assigned"), true);
  assertEquals(isWhatsAppWorthyStaffAlert("order_approval"), true);
  assertEquals(isWhatsAppWorthyStaffAlert("order_service_reminder"), true);
  assertEquals(isWhatsAppWorthyStaffAlert("broadcast_text"), true);
});

Deno.test("keeps chat and generic alerts push-only", () => {
  assertEquals(isWhatsAppWorthyStaffAlert("chat_message"), false);
  assertEquals(isWhatsAppWorthyStaffAlert("info"), false);
  assertEquals(isWhatsAppWorthyStaffAlert(""), false);
  assertEquals(isWhatsAppWorthyStaffAlert(null), false);
});

Deno.test("flattens template variables and never sends them empty", () => {
  assertEquals(templateText("🎯 New Lead\n\nAssigned", 120), "🎯 New Lead Assigned");
  assertEquals(templateText("   ", 120), "-");
  assertEquals(templateText("x".repeat(10), 4), "xxxx");
});

Deno.test("sends WhatsApp to sales, service head and accounts only by default", () => {
  assertEquals(staffWhatsAppRoles(""), ["sales", "service_head", "accounts"]);
  assertEquals(staffWhatsAppRoles(undefined), ["sales", "service_head", "accounts"]);
});

Deno.test("lets STAFF_WHATSAPP_ROLES override the role list", () => {
  assertEquals(staffWhatsAppRoles(" Sales, admin ,"), ["sales", "admin"]);
});

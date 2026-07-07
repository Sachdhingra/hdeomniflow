import { describe, it, expect } from "vitest";
import {
  detectSuspiciousInput,
  sanitizeText,
  validateTextInput,
  validatePhone,
  validateEmail,
  isValidUUID,
  validateAmount,
  isAllowedTable,
} from "@/utils/inputValidation";

describe("detectSuspiciousInput", () => {
  it("flags XSS probes", () => {
    expect(detectSuspiciousInput('<script>alert(1)</script>')).toContain("script tag");
    expect(detectSuspiciousInput('javascript:alert(1)')).toContain("javascript: URI");
    expect(detectSuspiciousInput('<img onerror="steal()">')).toContain("inline event handler");
  });

  it("flags SQL injection probes", () => {
    expect(detectSuspiciousInput("1' UNION SELECT password FROM users")).toContain("SQL keywords");
    expect(detectSuspiciousInput("x'; DROP TABLE leads")).toContain("destructive SQL");
  });

  it("flags path traversal and template injection", () => {
    expect(detectSuspiciousInput("../../etc/passwd")).toContain("path traversal");
    expect(detectSuspiciousInput("${process.env.SECRET}")).toContain("template injection");
  });

  it("passes normal customer data", () => {
    expect(detectSuspiciousInput("Ravi Kumar")).toEqual([]);
    expect(detectSuspiciousInput("Sofa cushion torn, needs replacement")).toEqual([]);
    expect(detectSuspiciousInput("Flat 4-B, MG Road")).toEqual([]);
  });
});

describe("sanitizeText", () => {
  it("strips HTML tags", () => {
    expect(sanitizeText("<b>hello</b> world")).toBe("hello world");
  });

  it("strips control characters and normalizes whitespace", () => {
    expect(sanitizeText("a\u0007bc   d")).toBe("abc d");
  });

  it("enforces max length", () => {
    expect(sanitizeText("x".repeat(50), 10)).toHaveLength(10);
  });
});

describe("validateTextInput", () => {
  it("rejects attack input but still returns a sanitized value", () => {
    const result = validateTextInput('<script>x</script>note');
    expect(result.valid).toBe(false);
    expect(result.sanitized).toBe("xnote");
  });

  it("accepts normal input", () => {
    expect(validateTextInput("Customer wants delivery on Friday").valid).toBe(true);
  });
});

describe("validatePhone", () => {
  it("canonicalizes to +91 form", () => {
    expect(validatePhone("98765 43210").sanitized).toBe("+919876543210");
    expect(validatePhone("+91-9876543210").sanitized).toBe("+919876543210");
  });

  it("rejects short numbers", () => {
    expect(validatePhone("12345").valid).toBe(false);
  });
});

describe("validateEmail", () => {
  it("accepts and lowercases valid emails", () => {
    const result = validateEmail("John.Doe@Example.COM");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("john.doe@example.com");
  });

  it("rejects malformed emails", () => {
    expect(validateEmail("not-an-email").valid).toBe(false);
    expect(validateEmail("a@b").valid).toBe(false);
  });
});

describe("isValidUUID", () => {
  it("accepts valid v4 UUIDs", () => {
    expect(isValidUUID("a3bb189e-8bf9-4888-9912-ace4e6543002")).toBe(true);
  });

  it("rejects injection-shaped IDs", () => {
    expect(isValidUUID("1 OR 1=1")).toBe(false);
    expect(isValidUUID("")).toBe(false);
  });
});

describe("validateAmount", () => {
  it("rejects negative and non-finite values", () => {
    expect(validateAmount(-5).valid).toBe(false);
    expect(validateAmount(NaN).valid).toBe(false);
    expect(validateAmount(Infinity).valid).toBe(false);
  });

  it("enforces bounds and integer constraint", () => {
    expect(validateAmount(2_000_000).valid).toBe(false);
    expect(validateAmount(10.5, { integer: true }).valid).toBe(false);
    expect(validateAmount(75, { integer: true }).valid).toBe(true);
  });
});

describe("isAllowedTable", () => {
  it("allows known tables and rejects everything else", () => {
    expect(isAllowedTable("leads")).toBe(true);
    expect(isAllowedTable("card_points")).toBe(true);
    expect(isAllowedTable("auth.users")).toBe(false);
    expect(isAllowedTable("audit_log")).toBe(false); // audit log is never a delete target
    expect(isAllowedTable("leads; DROP TABLE leads")).toBe(false);
  });
});

// Phone helpers for +91 IN numbers

/** Extract the last 10 digits from any input format. */
export function extractTenDigits(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

/** Validate that the value is exactly 10 digits. */
export function isValidIndianMobile(raw: string | null | undefined): boolean {
  return /^\d{10}$/.test(extractTenDigits(raw));
}

/** Convert any input to canonical storage form: "+91XXXXXXXXXX". Returns "" if invalid. */
export function toCanonicalPhone(raw: string | null | undefined): string {
  const ten = extractTenDigits(raw);
  return ten.length === 10 ? `+91${ten}` : "";
}

/** Format for display: "+91 XXXXX XXXXX". Accepts either canonical or 10-digit input. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const ten = extractTenDigits(raw);
  if (ten.length !== 10) return raw || "";
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}

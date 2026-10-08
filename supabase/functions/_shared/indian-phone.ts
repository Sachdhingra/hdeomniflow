/** Normalize Indian mobile numbers to exactly +91 followed by the final 10 digits. */
export function normalizeIndianPhone(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 10) return "";

  const nationalNumber = digits.slice(-10);
  if (!/^[6-9]\d{9}$/.test(nationalNumber)) return "";
  return `+91${nationalNumber}`;
}

export function indianPhoneLastTen(raw: string | null | undefined): string {
  const normalized = normalizeIndianPhone(raw);
  return normalized ? normalized.slice(-10) : "";
}
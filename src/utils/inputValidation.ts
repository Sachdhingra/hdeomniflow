/**
 * Input Validation & Sanitization
 * First line of defense against injection, XSS, and malformed-data attacks.
 * All user-supplied input should pass through these before hitting
 * DataContext writes or being rendered.
 */

export interface ValidationResult {
  valid: boolean;
  sanitized: string;
  issues: string[];
}

// Patterns that indicate an injection or XSS probe rather than real data
const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /<script\b/i, label: 'script tag' },
  { pattern: /javascript:/i, label: 'javascript: URI' },
  { pattern: /on\w+\s*=\s*["']/i, label: 'inline event handler' },
  { pattern: /<iframe\b/i, label: 'iframe tag' },
  { pattern: /(\bunion\b.+\bselect\b|\bselect\b.+\bfrom\b.+\bwhere\b)/i, label: 'SQL keywords' },
  { pattern: /(;|--|\/\*)\s*(drop|delete|truncate|alter)\b/i, label: 'destructive SQL' },
  { pattern: /\$\{.*\}/, label: 'template injection' },
  { pattern: /\{\{.*\}\}/, label: 'template injection' },
  { pattern: /\.\.\/\.\.\//, label: 'path traversal' },
  { pattern: /data:text\/html/i, label: 'data-URI HTML' },
];

/**
 * Detect injection/XSS probes in a string.
 * Returns the list of matched attack signatures (empty = clean).
 */
export function detectSuspiciousInput(value: string): string[] {
  if (!value) return [];
  return SUSPICIOUS_PATTERNS.filter(({ pattern }) => pattern.test(value)).map(
    ({ label }) => label
  );
}

/**
 * Strip HTML and control characters from free-text input.
 * Use for names, descriptions, notes — anything rendered back to users.
 */
export function sanitizeText(value: string, maxLength = 2000): string {
  if (!value) return '';
  return value
    .replace(/<[^>]*>/g, '')                 // strip HTML tags
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // control chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate and sanitize a free-text field.
 * Rejects (rather than silently strips) content that looks like an attack,
 * so the attempt can be logged as a security event.
 */
export function validateTextInput(value: string, maxLength = 2000): ValidationResult {
  const issues = detectSuspiciousInput(value);
  const sanitized = sanitizeText(value, maxLength);

  if (value && value.length > maxLength * 2) {
    issues.push(`input exceeds ${maxLength * 2} chars (possible buffer abuse)`);
  }

  return { valid: issues.length === 0, sanitized, issues };
}

/**
 * Validate an Indian phone number; returns canonical +91XXXXXXXXXX form.
 */
export function validatePhone(value: string): ValidationResult {
  const digits = (value || '').replace(/\D/g, '');
  const issues: string[] = [];

  if (digits.length < 10) issues.push('phone number must have at least 10 digits');
  if (digits.length > 13) issues.push('phone number too long');

  const canonical = digits.length >= 10 ? `+91${digits.slice(-10)}` : '';
  return { valid: issues.length === 0, sanitized: canonical, issues };
}

/**
 * Validate an email address (conservative RFC-5322 subset).
 */
export function validateEmail(value: string): ValidationResult {
  const trimmed = (value || '').trim().toLowerCase();
  const issues: string[] = [];

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) {
    issues.push('invalid email format');
  }
  if (trimmed.length > 254) issues.push('email too long');
  issues.push(...detectSuspiciousInput(trimmed));

  return { valid: issues.length === 0, sanitized: trimmed, issues };
}

/**
 * Validate a UUID (guards RPC/table calls built from client-side state).
 */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value || ''
  );
}

/**
 * Validate a numeric amount (points, rupee values) with bounds.
 * Prevents negative-value and overflow attacks on financial fields.
 */
export function validateAmount(
  value: number,
  opts: { min?: number; max?: number; integer?: boolean } = {}
): ValidationResult {
  const { min = 0, max = 1_000_000, integer = false } = opts;
  const issues: string[] = [];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push('not a finite number');
  } else {
    if (value < min) issues.push(`below minimum (${min})`);
    if (value > max) issues.push(`above maximum (${max})`);
    if (integer && !Number.isInteger(value)) issues.push('must be an integer');
  }

  return { valid: issues.length === 0, sanitized: String(value), issues };
}

/**
 * Whitelist check for table names used in dynamic operations
 * (secureDataOps takes a tableName parameter — never let arbitrary
 * strings through to a query builder).
 */
const ALLOWED_TABLES = new Set([
  'leads',
  'service_jobs',
  'site_visits',
  'profiles',
  'elite_customers',
  'app_users',
  'card_points',
  'redemption_requests',
  'card_bill_entries',
  'card_commissions',
]);

export function isAllowedTable(tableName: string): boolean {
  return ALLOWED_TABLES.has(tableName);
}

/**
 * Validate a whole form object at once.
 * Returns per-field results plus an overall verdict and any attack signatures
 * found, so the caller can both show errors and log a security event.
 */
export function validateForm(
  fields: Record<string, { value: string; type: 'text' | 'email' | 'phone'; maxLength?: number }>
): {
  valid: boolean;
  sanitized: Record<string, string>;
  fieldIssues: Record<string, string[]>;
  attackSignatures: string[];
} {
  const sanitized: Record<string, string> = {};
  const fieldIssues: Record<string, string[]> = {};
  const attackSignatures: string[] = [];

  for (const [name, field] of Object.entries(fields)) {
    let result: ValidationResult;
    switch (field.type) {
      case 'email':
        result = validateEmail(field.value);
        break;
      case 'phone':
        result = validatePhone(field.value);
        break;
      default:
        result = validateTextInput(field.value, field.maxLength);
    }
    sanitized[name] = result.sanitized;
    if (!result.valid) fieldIssues[name] = result.issues;
    attackSignatures.push(...detectSuspiciousInput(field.value));
  }

  return {
    valid: Object.keys(fieldIssues).length === 0,
    sanitized,
    fieldIssues,
    attackSignatures: Array.from(new Set(attackSignatures)),
  };
}

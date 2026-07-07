# Data Protection & Guardrails Specification

**Objective:** Implement comprehensive guardrails in OmniFlow to protect against data corruption and theft through admin-only controls, encryption, and audit logging.

---

## 1. Architecture Overview

### 1.1 Three-Layer Protection Model

```
┌─────────────────────────────────────┐
│ UI Layer (React/TypeScript)         │
│ - Admin Guards (AuthContext)        │
│ - Encryption/Decryption (utils)     │
├─────────────────────────────────────┤
│ Transport Layer (Supabase Client)   │
│ - TLS/HTTPS (automatic)             │
│ - Encrypted payloads in transit      │
├─────────────────────────────────────┤
│ Database Layer (PostgreSQL)         │
│ - Field-level encryption            │
│ - RLS policies with admin checks    │
│ - Audit logging triggers            │
│ - Immutable audit table             │
└─────────────────────────────────────┘
```

### 1.2 Key Principles

1. **Admin-Only Knowledge** — Only admin role can see/execute sensitive operations
2. **Defense in Depth** — Protection at UI, transport, and database layers
3. **Immutable Audit Trail** — All sensitive operations logged with who, what, when, why
4. **Field-Level Encryption** — PII encrypted at rest in database
5. **Fail-Safe Deletion** — Soft delete by default; hard delete requires admin + 2FA intent
6. **Data Integrity Validation** — Checksums/signatures on critical data structures

---

## 2. Sensitive Data Classification

### 2.1 PII (Personally Identifiable Information) — Encrypted at Rest

**Database tables:**
- `profiles`: `name`, `email`, `phone`
- `elite_customers`: `customer_name`, `phone_1`, `date_of_birth`
- `leads`: `contact_phone`, `customer_email`
- `app_service_requests`: `contact_phone`

**Encryption approach:**
- Use `pgcrypto` extension on PostgreSQL (AES-256-GCM)
- Encrypted value stored in database; decryption done in application layer
- Encryption keys managed via environment secrets (per-deployment, not in code)
- Decryption available only to authorized roles (admin, service_head where permitted by RLS)

### 2.2 Financial Data — Monitored & Audited

**Sensitive operations:**
- `card_points`: INSERT/UPDATE/DELETE (points balance changes)
- `redemption_requests`: UPDATE status (approval/rejection)
- `commissions`: Any row modification
- `bills`: INSERT/UPDATE/DELETE

**Protection:**
- All writes require RLS policy check + audit trigger
- Soft delete only (no permanent hard delete without admin approval)
- Audit log captures old vs new values + user role + timestamp

### 2.3 Critical System Settings — Admin-Only

**Admin-only operations:**
- User role changes (via `grant_user_role` function)
- Permanent data deletion (hard deletes)
- RLS policy modifications
- Encryption key rotation
- Audit log access (full history)

---

## 3. Admin Guard Implementation

### 3.1 AuthContext.ts Enhanced Guards

```typescript
// New functions in AuthContext
isAdmin(): boolean          // Check if user.role === 'admin'
requireAdmin(): void        // Throw if not admin
canDeletePermanently(): boolean  // Admin check + 2FA verification
canAccessAuditLog(): boolean    // Admin only
canRotateKeys(): boolean        // Admin only
canModifyRoles(): boolean       // Admin only
```

### 3.2 Admin-Only UI Patterns

- Delete buttons show soft-delete by default
- Hard delete icon only visible to admin (conditional render)
- Hard delete requires inline confirmation modal with "are you sure" + admin password
- Audit log tab only visible to admin
- Key rotation panel only visible to admin
- User role management only accessible to admin

### 3.3 Frontend Guards (DataContext.ts)

```typescript
// New methods in DataContext
async softDelete(type: string, id: uuid): Promise<void>
  // Updates deleted_at timestamp, visible to admin only

async hardDelete(type: string, id: uuid, adminPassword: string): Promise<void>
  // Requires admin role + password verification
  // Writes audit log before deletion
  // Executes DELETE query (data unrecoverable)

async permanentlyExpire(customerId: uuid, reason: string): Promise<void>
  // Admin-only: hard-deletes elite_customers row + related records
  // Require explicit intent + reason
```

---

## 4. Encryption Implementation

### 4.1 Frontend Encryption Utilities

**File: `src/utils/encryption.ts`**

```typescript
// Encryption utilities (XChaCha20-Poly1305 for browser compatibility)
export interface EncryptedData {
  ciphertext: string;     // base64
  nonce: string;          // base64
  salt: string;           // base64
  algorithm: 'xchacha20-poly1305';
}

// Key derivation from password (PBKDF2)
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey>

// Encrypt/Decrypt operations
export async function encryptField(plaintext: string, password: string): Promise<EncryptedData>
export async function decryptField(encrypted: EncryptedData, password: string): Promise<string>

// Local cache encryption
export async function encryptLocalCache(data: any): Promise<string>
export async function decryptLocalCache(encrypted: string): Promise<any>
```

**Note:** For browser, use Web Crypto API (native, no external libraries). For server-side (edge functions), use `pgcrypto` in PostgreSQL.

### 4.2 Database Encryption (pgcrypto)

**File: `supabase/migrations/20260708_encryption_setup.sql`**

```sql
-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypted column example (in existing tables):
-- ALTER TABLE profiles ADD COLUMN name_encrypted bytea;
-- ALTER TABLE profiles ADD COLUMN name_nonce bytea;
-- 
-- Decrypt in queries:
-- pgp_sym_decrypt(name_encrypted, 'key_material') AS name

-- For new PII fields:
-- - Store encrypted bytea + metadata
-- - Create view that decrypts for authorized roles only
-- - Immutable: once encrypted, only decrypt (no re-encrypt in app)
```

### 4.3 Encryption Key Management

**Strategy:**
- **Master Key** stored in Supabase secrets (never in code)
- **Per-Deployment Key Rotation** — manual process, audit logged
- **Breakglass Access** — admin can request emergency decryption (logged)
- **No Key Escrow** — if master key is lost, encrypted data is unrecoverable by design

**Secrets needed:**
```bash
VITE_ENCRYPTION_PASSPHRASE    # For frontend encryption (browser)
SUPABASE_ENCRYPTION_KEY       # For database pgcrypto (server-side only)
ADMIN_2FA_SECRET              # For 2FA verification on critical ops
```

---

## 5. Audit Logging Implementation

### 5.1 Audit Log Table

**File: `supabase/migrations/20260708_audit_logging.sql`**

```sql
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,          -- 'INSERT', 'UPDATE', 'DELETE', 'SOFT_DELETE', 'HARD_DELETE'
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  user_role TEXT,
  old_values JSONB,                 -- Before state (for UPDATE/DELETE)
  new_values JSONB,                 -- After state (for INSERT/UPDATE)
  reason TEXT,                      -- Why: admin note, automatic expiry, etc.
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Immutability: no updates or deletes allowed
  CONSTRAINT audit_log_immutable CHECK (true)
);

-- RLS: Only admin can SELECT; automatic INSERT via trigger
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT TO authenticated USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY audit_log_system_insert ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);
```

### 5.2 Audit Trigger on Sensitive Tables

```sql
-- Trigger function (applies to: card_points, redemption_requests, commissions, bills, profiles PII)
CREATE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_log
    (operation, table_name, record_id, user_id, user_role, old_values, new_values, created_at)
  VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    (auth.jwt() ->> 'role'),
    to_jsonb(OLD),
    to_jsonb(NEW),
    now()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach to sensitive tables
CREATE TRIGGER audit_card_points AFTER INSERT OR UPDATE OR DELETE ON card_points
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_redemption AFTER INSERT OR UPDATE OR DELETE ON redemption_requests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_bills AFTER INSERT OR UPDATE OR DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
-- ... and others
```

---

## 6. Soft Delete vs Hard Delete Strategy

### 6.1 Soft Delete (Default)

**Pattern:** Every table with sensitive data gets `deleted_at` column (TIMESTAMPTZ, nullable)

```typescript
// In DataContext
async softDelete(type: string, id: uuid): Promise<void> {
  // UPDATE <table> SET deleted_at = now() WHERE id = id
  // Visible to admin only in queries (add WHERE deleted_at IS NULL for staff)
}
```

**RLS Example:**
```sql
CREATE POLICY soft_delete_hide_staff ON leads
  FOR SELECT TO authenticated USING (
    deleted_at IS NULL OR auth.jwt() ->> 'role' = 'admin'
  );
```

### 6.2 Hard Delete (Admin-Only, Audited)

**Pattern:** Two-step confirmation with admin password

```typescript
// Step 1: User clicks "Permanently Delete"
// UI shows modal: "This cannot be undone. Enter your admin password."

// Step 2: On confirmation, call:
async hardDelete(type: string, id: uuid, adminPassword: string): Promise<void> {
  if (user.role !== 'admin') throw new Error('Unauthorized');
  
  // Verify admin password
  const verified = await verifyAdminPassword(adminPassword);
  if (!verified) throw new Error('Invalid password');
  
  // Log the deletion intent
  await supabase.from('audit_log').insert({
    operation: 'HARD_DELETE',
    table_name: type,
    record_id: id,
    reason: 'Admin-initiated permanent deletion',
    user_id: user.id
  });
  
  // Execute the deletion
  await supabase.rpc('hard_delete_record', { 
    table_name: type, 
    record_id: id 
  });
}
```

**Database Function:**
```sql
CREATE FUNCTION hard_delete_record(_table_name TEXT, _record_id UUID)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- Only admin can call
  IF (auth.jwt() ->> 'role') != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: hard delete requires admin role';
  END IF;
  
  -- Execute deletion (actual SQL will be dynamic per table)
  EXECUTE format('DELETE FROM %I WHERE id = %L', _table_name, _record_id);
END;
$$;
```

---

## 7. Data Integrity Checks

### 7.1 Checksum Validation

**Critical structures that need integrity checks:**
- `card_points` ledger (customer balance must match SUM of all transactions)
- `commissions` totals (sum must match bill line items)
- `profiles` email/phone uniqueness (no duplicates across roles)

**Implementation:**
```typescript
// In DataContext
async validateDataIntegrity(type: string): Promise<{ valid: boolean; issues: string[] }> {
  const issues = [];
  
  if (type === 'card_points') {
    // Fetch all card_points for customer
    // Calculate SUM(points) from purchase, anniversary, referral
    // Compare against current_points in elite_customers
    // If mismatch, flag and notify admin
  }
  
  return { valid: issues.length === 0, issues };
}

// Run hourly via edge function or scheduled job
// On mismatch, alert admin and freeze operations
```

### 7.2 Data Anomaly Detection

**Patterns to monitor:**
- Unusual point balance changes (spike > 1000 pts in single transaction)
- Rapid successive deletions (>10 in < 1 minute)
- Role changes outside business hours
- Bulk updates without audit trail
- Encryption key access (any rotation/breakglass)

**Implementation:**
```sql
-- Stored procedure to check for anomalies
CREATE FUNCTION detect_anomalies() RETURNS TABLE(anomaly_type TEXT, description TEXT, severity TEXT) AS $$
BEGIN
  -- Check 1: Huge point transactions in last hour
  -- Check 2: Multiple soft deletes in rapid succession
  -- Check 3: Off-hours role changes
  -- Return all detected issues
END;
$$ LANGUAGE plpgsql;

-- Cron job runs every 5 minutes, alerts admin if anomalies detected
```

---

## 8. Implementation Roadmap

### Phase 1: Foundation (Encryption & Admin Guards)
- [ ] Create `src/utils/encryption.ts` (XChaCha20-Poly1305 for browser)
- [ ] Enhance `AuthContext.ts` with admin guard functions
- [ ] Create database migration for audit_log table
- [ ] Add `deleted_at` column to sensitive tables (migrations)
- [ ] Test encryption/decryption roundtrip

### Phase 2: Audit Logging & RLS
- [ ] Create audit trigger function + attach to sensitive tables
- [ ] Add RLS policies for audit_log (admin-only SELECT)
- [ ] Update existing RLS policies to check `deleted_at`
- [ ] Create `hard_delete_record` database function
- [ ] Test audit logging on INSERT/UPDATE/DELETE operations

### Phase 3: Frontend Integration
- [ ] Update DataContext with soft delete / hard delete methods
- [ ] Add admin-only delete button UI (conditional render)
- [ ] Add hard delete confirmation modal with password verification
- [ ] Add audit log viewer tab (admin-only)
- [ ] Add encryption/decryption on local cache

### Phase 4: Monitoring & Response
- [ ] Create data integrity check function + schedule
- [ ] Create anomaly detection stored procedure + cron job
- [ ] Add admin dashboard widget showing recent audit entries
- [ ] Add alert mechanism for detected anomalies
- [ ] Document emergency procedures (breakglass access, key recovery)

### Phase 5: Key Management & Documentation
- [ ] Set up encryption key rotation procedure
- [ ] Document key rotation runbook
- [ ] Create 2FA integration for admin critical operations
- [ ] Document disaster recovery procedures
- [ ] Create compliance audit template (for SOC2 / data protection regs)

---

## 9. Admin Dashboard Features (Phase 4+)

### 9.1 Audit Log Viewer
```
┌─────────────────────────────────────────────────────┐
│ Audit Log (Admin Only)                              │
├─────────────────────────────────────────────────────┤
│ Filters: [Date Range] [Operation] [User] [Table]   │
├─────────────────────────────────────────────────────┤
│ Operation | Table | User | When | Old → New         │
├─────────────────────────────────────────────────────┤
│ DELETE    | leads | john | 2m ago | (archived)      │
│ UPDATE    | card_points | system | 5m ago | +50pts  │
│ INSERT    | redemption_requests | maria | 10m ago   │
└─────────────────────────────────────────────────────┘
```

### 9.2 Data Integrity Monitor
```
┌─────────────────────────────────────────────────────┐
│ Data Integrity Status                               │
├─────────────────────────────────────────────────────┤
│ ✅ card_points ledger — balanced                    │
│ ✅ commissions totals — reconciled                  │
│ ⚠️  3 duplicate emails in profiles — review needed  │
│ 🔴 elite_customers.id mismatch — ALERT              │
└─────────────────────────────────────────────────────┘
```

### 9.3 Critical Actions Log
```
┌─────────────────────────────────────────────────────┐
│ Critical Actions (Last 30 Days)                      │
├─────────────────────────────────────────────────────┤
│ Hard delete | leads#abc123 | admin_user | reason... │
│ Role change | john → admin | system | migration     │
│ Encryption key rotation | — | system | scheduled    │
│ Breakglass access | customer#xyz | admin | approved  │
└─────────────────────────────────────────────────────┘
```

---

## 10. Security Checklist

- [ ] No plaintext passwords in code or logs
- [ ] Encryption keys fetched from env secrets only
- [ ] Hard delete requires admin + password verification
- [ ] All sensitive ops logged to immutable audit table
- [ ] RLS policies prevent unauthorized access
- [ ] Soft delete default; hard delete requires explicit intent
- [ ] PII encrypted at rest in database
- [ ] Encryption in transit (TLS automatic via Supabase)
- [ ] Data integrity checks run hourly
- [ ] Anomaly detection alerts admin on suspicious patterns
- [ ] Audit log accessible to admin only
- [ ] No data accessible cross-customer (RLS enforced)
- [ ] Key rotation documented and auditable
- [ ] Emergency procedures documented (breakglass, recovery)

---

## 11. References & Standards

- **Encryption:** NIST SP 800-38D (AES-GCM), RFC 7748 (XChaCha20)
- **Key Derivation:** NIST SP 800-132 (PBKDF2)
- **Audit Logging:** NIST SP 800-92 (audit log guidelines)
- **Data Classification:** ISO 27001 Annex A.12.2.1
- **Incident Response:** NIST SP 800-61 (computer security incident handling)


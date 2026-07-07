# Data Protection Implementation Guide

This document explains how to use and maintain the data protection guardrails in OmniFlow.

---

## Quick Start

### 1. Database Migrations

Apply the new migrations to enable audit logging and soft deletes:

```bash
# In Supabase dashboard or via CLI:
supabase db push

# This will create:
# - public.audit_log table (immutable)
# - public.audit_trigger_fn() function (logs all operations)
# - public.audit_soft_delete_fn() function (tracks soft deletes)
# - deleted_at columns on sensitive tables
# - RLS policies for audit log access (admin-only read)
```

### 2. Frontend Imports

```typescript
// Use encryption utilities
import { encryptField, decryptField, hashData } from "@/utils/encryption";

// Use secure data operations
import { softDeleteRecord, hardDeleteRecord, getAuditLog } from "@/utils/secureDataOps";

// Use data integrity checks
import { runAllIntegrityChecks, detectAnomalies } from "@/utils/dataIntegrity";

// Use auth guards
import { useAuth } from "@/contexts/AuthContext";
const { isAdmin, requireAdmin, canPerformHardDelete } = useAuth();
```

---

## Features

### 🔐 Encryption Utilities (`src/utils/encryption.ts`)

Encrypts sensitive data using AES-256-GCM (Web Crypto API).

#### Encrypt a field:
```typescript
const encrypted = await encryptField("john.doe@example.com", "password123");
// Returns: { ciphertext, nonce, salt, algorithm, timestamp }
```

#### Decrypt a field:
```typescript
const plaintext = await decryptField(encrypted, "password123");
// Returns: "john.doe@example.com"
```

#### Hash data (for integrity checks):
```typescript
const hash = await hashData(JSON.stringify(data));
// Returns: base64-encoded SHA-256 hash
```

#### Encrypt local cache:
```typescript
const encrypted = await encryptLocalCache(sensitiveData, adminPassword);
localStorage.setItem("protected_cache", encrypted);

// Later:
const data = await decryptLocalCache(encrypted, adminPassword);
```

---

### 🛡️ Admin Guards (`src/contexts/AuthContext.tsx`)

Check admin permissions before sensitive operations:

```typescript
const { user, isAdmin, requireAdmin, canPerformHardDelete, verifyAdminPassword, verifyMFA } = useAuth();

// Check if user is admin
if (isAdmin()) {
  // Show admin-only features
}

// Throw error if not admin
try {
  requireAdmin();
  // Proceed with sensitive operation
} catch (e) {
  console.error(e.message); // "🚫 [Auth] Unauthorized: admin role required"
}

// Check hard delete permission (requires MFA)
if (canPerformHardDelete()) {
  // Hard delete is available
}

// Verify admin password before critical operation
const valid = await verifyAdminPassword(userEnteredPassword);
if (!valid) {
  throw new Error("Invalid admin password");
}

// Verify MFA code
const mfaValid = await verifyMFA(userEnteredCode);
if (mfaValid) {
  console.log("MFA verified - proceed with critical operation");
}
```

---

### 🗑️ Secure Data Operations (`src/utils/secureDataOps.ts`)

#### Soft Delete (Recoverable)
```typescript
const result = await softDeleteRecord("leads", leadId, "Customer requested deletion");
// Marks record as deleted (deleted_at = now)
// Automatically logged to audit_log table
// Visible to admin only in queries
```

#### Restore from Soft Delete
```typescript
const result = await restoreRecord("leads", leadId, user);
// Only works if user.role === 'admin'
// Sets deleted_at = null
```

#### Hard Delete (Permanent, Admin-Only)
```typescript
const result = await hardDeleteRecord(
  "leads",
  leadId,
  user,
  "Reason for deletion: duplicate entry",
  { verifyAdminPassword, verifyMFA }
);
// Requires admin role
// Must verify admin password
// Must verify MFA code
// Logs intent to audit_log BEFORE deletion
// Actually deletes the record (unrecoverable)
```

#### View Audit Log
```typescript
const logs = await getAuditLog(user, {
  tableName: "leads",
  operation: "SOFT_DELETE",
  startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
  limit: 100
});

logs.forEach(log => {
  console.log(`${log.operation} on ${log.table_name} by ${log.user_email} at ${log.created_at}`);
  console.log(`Old: ${JSON.stringify(log.old_values)}`);
  console.log(`New: ${JSON.stringify(log.new_values)}`);
});
```

#### Get Audit Statistics
```typescript
const stats = await getAuditLogStats(user, "last_day");
// Returns: { INSERT: 45, UPDATE: 123, SOFT_DELETE: 8, HARD_DELETE: 0, ... }
```

#### Bulk Soft Delete
```typescript
const result = await bulkSoftDelete("leads", [id1, id2, id3], "Bulk cleanup");
// Rate-limited to 100 records per operation
// Returns: { totalRequested, successCount, failedCount, failures, timestamp }
```

---

### ✅ Data Integrity Checks (`src/utils/dataIntegrity.ts`)

#### Run All Checks
```typescript
const result = await runAllIntegrityChecks();
// Returns: { valid, checks: [], timestamp, summary }
// Runs: validatePointsLedger, checkPIIDuplicates, checkRapidDeletions, checkAnomalousTransactions
```

#### Example output:
```typescript
{
  valid: false,
  checks: [
    {
      name: "Points Ledger Balance",
      status: "pass",
      message: "✅ All 150 customer balances match transaction ledgers",
      severity: "low"
    },
    {
      name: "PII Duplicates",
      status: "warning",
      message: "⚠️  Duplicate phone numbers in customers: +911234567890 (2x)...",
      severity: "medium"
    },
    {
      name: "Rapid Deletions",
      status: "pass",
      message: "✅ 5 soft deletes in last 5 minutes (normal)",
      severity: "low"
    }
  ],
  timestamp: Date,
  summary: "2 passed, 1 warning, 0 failed"
}
```

#### Detect Anomalies
```typescript
const anomalies = await detectAnomalies();
// Returns: AnomalyDetected[]
// Detects: unusual transactions, rapid deletions, off-hours changes, encryption key access

anomalies.forEach(a => {
  console.log(`🚨 ${a.type}: ${a.description}`);
  console.log(`Severity: ${a.severity}`);
  console.log(`Action: ${a.recommended_action}`);
});
```

---

## UI Components

### Admin Dashboard (`src/components/AdminDashboard.tsx`)

Shows comprehensive admin oversight:

```typescript
import AdminDashboard from "@/components/AdminDashboard";

// In your layout/router:
<Route path="/admin" element={<AdminDashboard />} />
```

**Features:**
- 📊 **Overview** — Operation stats, integrity status at a glance
- 📋 **Audit Log** — Browse all operations with filtering
- ✅ **Integrity** — Run data consistency checks
- ⚠️ **Anomalies** — View detected suspicious patterns

**Access:** Only visible to users with `role === 'admin'`

---

## Audit Log Structure

Every sensitive operation is logged:

```sql
SELECT * FROM public.audit_log
  WHERE table_name = 'leads'
  ORDER BY created_at DESC
  LIMIT 10;
```

**Columns:**
- `id` — Unique log entry ID
- `operation` — 'INSERT', 'UPDATE', 'DELETE', 'SOFT_DELETE', 'HARD_DELETE'
- `table_name` — Which table was modified
- `record_id` — ID of the affected record
- `user_id` — Auth user ID (who did it)
- `user_role` — User's role at time of operation
- `user_email` — User's email (cached for audit trail)
- `old_values` — JSONB: state before modification
- `new_values` — JSONB: state after modification
- `reason` — Why (admin note, automatic expiry, etc.)
- `created_at` — When it happened

**Immutability:** Cannot UPDATE or DELETE audit log entries (enforced by RLS)

---

## Soft Delete Pattern

Tables with sensitive data have a `deleted_at` column:

### What happens on soft delete?
```sql
UPDATE leads SET deleted_at = now() WHERE id = 'abc123';
```

### Query pattern (show active records):
```sql
SELECT * FROM leads WHERE deleted_at IS NULL;
```

### Query pattern (admin sees all):
```sql
-- RLS policy automatically handles this:
SELECT * FROM leads;  -- Shows deleted_at IS NULL for staff, all for admin
```

### Recover from soft delete:
```typescript
await restoreRecord("leads", leadId, user);
// Updates: deleted_at = null
```

---

## Hard Delete Pattern

### When to use hard delete:
- Customer requests permanent deletion (GDPR right to be forgotten)
- Data is corrupted and must be removed
- Duplicate record must be completely erased

### Hard delete flow:
1. Admin clicks "Permanently Delete"
2. UI shows confirmation modal: "This cannot be undone. Enter your password."
3. User enters admin password
4. Backend logs deletion intent to audit_log
5. Record is permanently deleted from database
6. Operation is unrecoverable

### Example usage:
```typescript
const result = await hardDeleteRecord(
  "leads",
  customerId,
  user,
  "Customer GDPR deletion request - contract terminated",
  { verifyAdminPassword, verifyMFA }
);

if (result.success) {
  toast.success("Record permanently deleted");
} else {
  toast.error(result.message);
}
```

---

## Encryption Key Management

### Current Strategy
- **Master Key** stored in Supabase secrets (environment variable)
- **Never** hardcoded in source code or git
- **Per-deployment** key (different key per dev/staging/production)

### Using the master key:
```bash
# In .env.local (development):
VITE_ENCRYPTION_PASSPHRASE=your_secure_password_here

# In Supabase project settings (production):
# Environment Variables > Add
# Key: VITE_ENCRYPTION_PASSPHRASE
# Value: your_secure_password_here
```

### Key rotation (manual process):
1. Admin generates new key
2. Creates snapshot of encrypted data
3. Decrypts all data with old key
4. Re-encrypts with new key
5. Verifies all data intact
6. Logs rotation to audit_log
7. Updates Supabase secrets

---

## RLS Policies for Soft Delete

Example RLS policy (applied to all sensitive tables):

```sql
CREATE POLICY soft_delete_hide_from_staff ON leads
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL OR 
    auth.jwt() ->> 'role' = 'admin'
  );
```

**Effect:**
- Staff users (non-admin) cannot see soft-deleted records
- Admin can see all records (deleted or not)
- No explicit WHERE clause needed in queries

---

## Data Integrity Checks

### Points Ledger Validation
Verifies: `SUM(card_points.points for customer) = elite_customers.current_points`

**What it catches:**
- Incorrect balance calculations
- Missing transaction records
- Fraud (manual balance modifications)

### PII Duplicate Detection
Checks for duplicate emails and phone numbers

**What it catches:**
- Duplicate customer registrations
- Data import errors
- Accidental re-entry

### Rapid Deletion Detection
Flags if >50 soft deletes in 5 minutes

**What it catches:**
- Runaway deletion scripts
- Possible malicious bulk deletion
- Human error (e.g., wrong filter)

### Anomalous Transaction Detection
Custom logic in `detect_anomalous_transactions()` RPC function

**What it catches:**
- Unusual point balances (>1000 pts in single transaction)
- Off-hours role changes
- Encryption key access patterns

---

## Monitoring & Alerting

### Run checks on a schedule:
```typescript
// In your app initialization or via scheduled edge function:
useEffect(() => {
  const checkInterval = setInterval(async () => {
    const result = await runAllIntegrityChecks();
    
    if (!result.valid) {
      // Send alert to admin
      const criticalIssues = result.checks.filter(c => c.status === 'fail');
      if (criticalIssues.length > 0) {
        notifyAdmin("Data integrity issues detected", criticalIssues);
      }
    }
  }, 60 * 60 * 1000); // Every hour
  
  return () => clearInterval(checkInterval);
}, []);
```

### Dashboard auto-refresh:
AdminDashboard refreshes audit logs and integrity checks every 60 seconds

---

## Emergency Procedures

### Breakglass Access (Lost Master Key)
If encryption master key is lost:
1. All encrypted data becomes unrecoverable
2. This is by design (fail-safe)
3. Options:
   - Restore from backup (if available)
   - Re-encrypt fresh data with new key
   - Contact Supabase support for emergency access logs

### Audit Log Corruption
If audit log is corrupted:
1. Immutability constraints prevent modification
2. Contact Supabase support
3. Restore from backup

### Accidental Hard Delete
If an admin permanently deletes wrong record:
1. Check most recent backup
2. Restore record from backup (if available)
3. Log the incident
4. Review admin permissions for that user

---

## Testing

### Test encryption roundtrip:
```typescript
import { encryptField, decryptField } from "@/utils/encryption";

const original = "test@example.com";
const password = "MyTestPassword123!";

const encrypted = await encryptField(original, password);
const decrypted = await decryptField(encrypted, password);

console.assert(decrypted === original, "Encryption roundtrip failed");
```

### Test soft delete visibility:
```typescript
// As staff user:
const staffView = await supabase.from("leads").select("*");
// Should NOT include deleted_at IS NOT NULL records

// As admin user:
const adminView = await supabase.from("leads").select("*");
// Should include all records
```

### Test audit logging:
```typescript
// Perform a soft delete
await softDeleteRecord("leads", testLeadId);

// Check audit log
const logs = await getAuditLog(user, { recordId: testLeadId });
console.assert(logs.length > 0, "Audit log entry not created");
console.assert(logs[0].operation === "SOFT_DELETE", "Wrong operation logged");
```

---

## Troubleshooting

### Audit log trigger not firing
- Check trigger status: `SELECT * FROM information_schema.triggers WHERE trigger_name LIKE 'audit%';`
- Verify audit_trigger_fn exists: `SELECT * FROM pg_proc WHERE proname = 'audit_trigger_fn';`
- Check RLS policies on audit_log table

### Soft delete column missing
- Run migrations: `supabase db push`
- Verify column exists: `SELECT * FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'deleted_at';`

### Encryption fails
- Check passphrase is set in environment
- Verify Web Crypto API is available (check browser compatibility)
- Check encrypted data format (should be JSON with ciphertext, nonce, salt)

### Admin dashboard shows no data
- Verify user role is 'admin': `SELECT role FROM user_roles WHERE user_id = auth.uid();`
- Check RLS policy on audit_log: `SELECT * FROM pg_policies WHERE tablename = 'audit_log';`
- Verify audit triggers are attached to tables

---

## Compliance Notes

### GDPR / Right to be Forgotten
Use hard delete for customer deletion requests:
```typescript
await hardDeleteRecord(
  "elite_customers",
  customerId,
  user,
  "GDPR deletion request - customer initiated",
  { verifyAdminPassword, verifyMFA }
);
```

### Audit Trail Retention
Keep audit logs for minimum 90 days (configure based on compliance needs)

### Data Classification
- **PII** (names, emails, phones) — encrypted at rest
- **Financial** (balances, commissions) — audited, soft-delete only
- **System** (roles, permissions) — audited, admin-only changes

---

## Next Steps

1. **Deploy migrations** — Apply SQL migrations to Supabase
2. **Test encryption** — Verify Web Crypto API works in your environment
3. **Configure admin accounts** — Ensure primary admins have MFA enabled
4. **Set up monitoring** — Run integrity checks on a schedule
5. **Train staff** — Document soft/hard delete procedures
6. **Review RLS policies** — Ensure all sensitive tables have soft-delete policies
7. **Set up alerts** — Configure email/Slack notifications for critical anomalies


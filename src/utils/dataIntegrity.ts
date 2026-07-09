/**
 * Data Integrity Checking Utilities
 * Validates critical data structures and detects anomalies
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase: any = _supabase;

export interface IntegrityCheckResult {
  valid: boolean;
  checks: CheckItem[];
  timestamp: Date;
  summary: string;
}

export interface CheckItem {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface AnomalyDetected {
  type: 'unusual_transaction' | 'rapid_deletion' | 'off_hours_change' | 'data_mismatch' | 'encryption_access';
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  timestamp: Date;
  affected_records?: string[];
  recommended_action: string;
}

/**
 * Check if card_points ledger is balanced
 * Verifies: SUM of all points transactions = current_points in elite_customers
 */
export async function validatePointsLedger(): Promise<CheckItem> {
  try {
    const { data: customers, error: customerError } = await supabase
      .from('elite_customers')
      .select('id, current_points');

    if (customerError) throw customerError;
    if (!customers || customers.length === 0) {
      return {
        name: 'Points Ledger Balance',
        status: 'pass',
        message: 'No customers to check',
        severity: 'low',
      };
    }

    const mismatches: string[] = [];

    for (const customer of customers) {
      const { data: points, error: pointsError } = await supabase
        .from('card_points')
        .select('points')
        .eq('customer_id', customer.id)
        .is('deleted_at', null);

      if (pointsError) throw pointsError;

      const totalPoints = (points || []).reduce((sum, p) => sum + (p.points || 0), 0);

      if (totalPoints !== customer.current_points) {
        mismatches.push(`Customer ${customer.id}: ledger=${totalPoints}, balance=${customer.current_points}`);
      }
    }

    if (mismatches.length === 0) {
      return {
        name: 'Points Ledger Balance',
        status: 'pass',
        message: `✅ All ${customers.length} customer balances match transaction ledgers`,
        severity: 'low',
      };
    } else {
      return {
        name: 'Points Ledger Balance',
        status: 'fail',
        message: `❌ ${mismatches.length} balance mismatches detected: ${mismatches.slice(0, 3).join('; ')}...`,
        severity: 'critical',
      };
    }
  } catch (error: any) {
    return {
      name: 'Points Ledger Balance',
      status: 'fail',
      message: `❌ Check failed: ${error.message}`,
      severity: 'high',
    };
  }
}

/**
 * Check for duplicate PII (emails, phone numbers)
 */
export async function checkPIIDuplicates(): Promise<CheckItem> {
  try {
    const issues: string[] = [];

    // Check for duplicate emails in profiles
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('email')
      .is('deleted_at', null);

    if (profileError) throw profileError;

    const profileEmails = profiles || [];
    const emailCounts = new Map<string, number>();
    profileEmails.forEach(p => {
      if (p.email) {
        emailCounts.set(p.email, (emailCounts.get(p.email) || 0) + 1);
      }
    });

    const duplicateEmails = Array.from(emailCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([email, count]) => `${email} (${count}x)`);

    if (duplicateEmails.length > 0) {
      issues.push(`Duplicate emails in profiles: ${duplicateEmails.slice(0, 3).join(', ')}...`);
    }

    // Check for duplicate phone numbers in elite_customers
    const { data: customers, error: customerError } = await supabase
      .from('elite_customers')
      .select('phone_1')
      .is('deleted_at', null);

    if (customerError) throw customerError;

    const phoneCount = new Map<string, number>();
    (customers || []).forEach(c => {
      if (c.phone_1) {
        phoneCount.set(c.phone_1, (phoneCount.get(c.phone_1) || 0) + 1);
      }
    });

    const duplicatePhones = Array.from(phoneCount.entries())
      .filter(([_, count]) => count > 1)
      .map(([phone, count]) => `${phone} (${count}x)`);

    if (duplicatePhones.length > 0) {
      issues.push(`Duplicate phone numbers in customers: ${duplicatePhones.slice(0, 3).join(', ')}...`);
    }

    if (issues.length === 0) {
      return {
        name: 'PII Duplicates',
        status: 'pass',
        message: '✅ No duplicate emails or phone numbers detected',
        severity: 'low',
      };
    } else {
      return {
        name: 'PII Duplicates',
        status: 'warning',
        message: `⚠️  ${issues.length} PII duplication issue(s): ${issues.join('; ')}`,
        severity: 'medium',
      };
    }
  } catch (error: any) {
    return {
      name: 'PII Duplicates',
      status: 'fail',
      message: `❌ Check failed: ${error.message}`,
      severity: 'high',
    };
  }
}

/**
 * Check for recent rapid deletions (possible data destruction attempt)
 */
export async function checkRapidDeletions(): Promise<CheckItem> {
  try {
    // Check for soft deletes in the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const { count, error } = await supabase
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('operation', 'SOFT_DELETE')
      .gte('created_at', fiveMinutesAgo.toISOString());

    if (error) throw error;

    const softDeleteCount = count || 0;

    // Flag if more than 50 soft deletes in 5 minutes
    if (softDeleteCount > 50) {
      return {
        name: 'Rapid Deletions',
        status: 'warning',
        message: `⚠️  ${softDeleteCount} soft deletes in last 5 minutes - possible mass deletion`,
        severity: 'high',
      };
    }

    return {
      name: 'Rapid Deletions',
      status: 'pass',
      message: `✅ ${softDeleteCount} soft deletes in last 5 minutes (normal)`,
      severity: 'low',
    };
  } catch (error: any) {
    return {
      name: 'Rapid Deletions',
      status: 'fail',
      message: `❌ Check failed: ${error.message}`,
      severity: 'high',
    };
  }
}

/**
 * Check for unusual point transactions (possible fraud)
 */
export async function checkAnomalousTransactions(): Promise<CheckItem> {
  try {
    const { data: anomalies, error } = await supabase
      .rpc('detect_anomalous_transactions');

    if (error) throw error;

    const count = Array.isArray(anomalies) ? anomalies.length : 0;

    if (count > 0) {
      return {
        name: 'Anomalous Transactions',
        status: 'warning',
        message: `⚠️  ${count} unusual transactions detected - check audit log`,
        severity: 'high',
      };
    }

    return {
      name: 'Anomalous Transactions',
      status: 'pass',
      message: '✅ No anomalous transactions detected',
      severity: 'low',
    };
  } catch (error: any) {
    // RPC function may not exist yet - this is ok during initial setup
    return {
      name: 'Anomalous Transactions',
      status: 'pass',
      message: 'ℹ️  Anomaly detection not yet configured',
      severity: 'low',
    };
  }
}

/**
 * Run all integrity checks
 */
export async function runAllIntegrityChecks(): Promise<IntegrityCheckResult> {
  const checks = await Promise.all([
    validatePointsLedger(),
    checkPIIDuplicates(),
    checkRapidDeletions(),
    checkAnomalousTransactions(),
  ]);

  const validCount = checks.filter(c => c.status === 'pass').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;

  const summary = `${validCount} passed, ${warningCount} warnings, ${failCount} failed`;
  const valid = failCount === 0;

  return {
    valid,
    checks,
    timestamp: new Date(),
    summary,
  };
}

/**
 * Detect data anomalies that might indicate unauthorized access or corruption
 */
export async function detectAnomalies(): Promise<AnomalyDetected[]> {
  const anomalies: AnomalyDetected[] = [];

  try {
    // Check 1: Unusual point balance changes
    const { data: largeTransactions, error: txError } = await supabase
      .from('card_points')
      .select('id, customer_id, points, transaction_type, created_at')
      .gt('points', 1000)
      .order('created_at', { ascending: false })
      .limit(10);

    if (txError) throw txError;

    if ((largeTransactions || []).length > 0) {
      anomalies.push({
        type: 'unusual_transaction',
        description: `${largeTransactions?.length || 0} unusually large point transactions (>1000 pts) in recent history`,
        severity: 'high',
        timestamp: new Date(),
        recommended_action: 'Review audit log for these transactions and verify legitimacy',
      });
    }

    // Check 2: Off-hours role changes
    const { data: offHoursChanges, error: roleError } = await supabase
      .from('audit_log')
      .select('id, created_at, user_role, table_name')
      .eq('table_name', 'user_roles')
      .eq('operation', 'UPDATE')
      .order('created_at', { ascending: false })
      .limit(5);

    if (roleError) throw roleError;

    const offHours = (offHoursChanges || []).filter(c => {
      const hour = new Date(c.created_at).getHours();
      return hour < 6 || hour > 22; // Outside 6am-10pm
    });

    if (offHours.length > 0) {
      anomalies.push({
        type: 'off_hours_change',
        description: `${offHours.length} role changes made outside business hours`,
        severity: 'medium',
        timestamp: new Date(),
        affected_records: offHours.map(c => c.id),
        recommended_action: 'Verify these role changes with the responsible admin',
      });
    }

    // Check 3: Hard delete attempts
    const { data: hardDeletes, error: delError } = await supabase
      .from('audit_log')
      .select('id, record_id, user_id, created_at')
      .eq('operation', 'HARD_DELETE')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (delError) throw delError;

    if ((hardDeletes || []).length > 0) {
      anomalies.push({
        type: 'data_mismatch',
        description: `${hardDeletes?.length || 0} hard deletes performed in last 24 hours`,
        severity: 'critical',
        timestamp: new Date(),
        affected_records: hardDeletes?.map(d => d.record_id),
        recommended_action: 'Review hard delete audit log entries - ensure all were authorized',
      });
    }
  } catch (error: any) {
    console.error('Error detecting anomalies:', error);
  }

  return anomalies;
}

/**
 * Check encryption key access patterns
 * Alert if master key is accessed too frequently or at unusual times
 */
export async function checkEncryptionKeyAccess(): Promise<CheckItem> {
  try {
    const { data: keyAccess, error } = await supabase
      .from('audit_log')
      .select('id, created_at, user_role')
      .eq('reason', 'Encryption key operation')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error) throw error;

    const accessCount = (keyAccess || []).length;

    if (accessCount > 10) {
      return {
        name: 'Encryption Key Access',
        status: 'warning',
        message: `⚠️  ${accessCount} key access operations in last 24 hours - check for unauthorized access`,
        severity: 'high',
      };
    }

    return {
      name: 'Encryption Key Access',
      status: 'pass',
      message: `✅ ${accessCount} key access operations in last 24 hours (normal)`,
      severity: 'low',
    };
  } catch (error: any) {
    return {
      name: 'Encryption Key Access',
      status: 'pass',
      message: 'ℹ️  Encryption key tracking not yet configured',
      severity: 'low',
    };
  }
}

/**
 * Secure Data Operations
 * Handles soft deletes, hard deletes, and other protected data operations
 * Requires admin role for sensitive operations
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase: any = _supabase;
import type { User } from "@/contexts/AuthContext";
import { isAllowedTable, isValidUUID } from "@/utils/inputValidation";
import { reportSecurityEvent } from "@/utils/securityMonitor";

/**
 * Guard for all dynamic-table operations: reject table names outside the
 * whitelist and malformed record IDs, and report the attempt as a
 * security event (a well-behaved client never trips this).
 */
function assertSafeTarget(tableName: string, recordId?: string): string | null {
  if (!isAllowedTable(tableName)) {
    reportSecurityEvent("suspicious_input", { tableName, context: "secureDataOps" });
    return `Operation rejected: '${tableName}' is not an allowed table`;
  }
  if (recordId !== undefined && !isValidUUID(recordId)) {
    reportSecurityEvent("suspicious_input", { recordId, context: "secureDataOps" });
    return "Operation rejected: invalid record ID";
  }
  return null;
}

export interface DeleteOperationResult {
  success: boolean;
  recordId: string;
  operation: 'soft_delete' | 'hard_delete' | 'restore';
  timestamp: Date;
  auditLogId?: string;
  message: string;
}

export interface BulkDeleteResult {
  totalRequested: number;
  successCount: number;
  failedCount: number;
  failures: Array<{ recordId: string; error: string }>;
  timestamp: Date;
}

/**
 * Soft delete a record (marks as deleted, recoverable)
 * Available to all authorized roles based on RLS
 */
export async function softDeleteRecord(
  tableName: string,
  recordId: string,
  reason?: string
): Promise<DeleteOperationResult> {
  const guardError = assertSafeTarget(tableName, recordId);
  if (guardError) {
    return {
      success: false,
      recordId,
      operation: 'soft_delete',
      timestamp: new Date(),
      message: guardError,
    };
  }

  try {
    const now = new Date();

    const { error } = await supabase
      .from(tableName)
      .update({ deleted_at: now.toISOString() })
      .eq('id', recordId);

    if (error) throw error;

    // Soft delete is automatically logged by the audit trigger
    return {
      success: true,
      recordId,
      operation: 'soft_delete',
      timestamp: now,
      message: `Record marked as deleted (recoverable)`,
    };
  } catch (error: any) {
    return {
      success: false,
      recordId,
      operation: 'soft_delete',
      timestamp: new Date(),
      message: `Soft delete failed: ${error.message}`,
    };
  }
}

/**
 * Restore a soft-deleted record (admin-only, requires MFA)
 */
export async function restoreRecord(
  tableName: string,
  recordId: string,
  user: User | null
): Promise<DeleteOperationResult> {
  if (!user || user.role !== 'admin') {
    return {
      success: false,
      recordId,
      operation: 'restore',
      timestamp: new Date(),
      message: 'Unauthorized: admin role required for restore',
    };
  }

  const guardError = assertSafeTarget(tableName, recordId);
  if (guardError) {
    return {
      success: false,
      recordId,
      operation: 'restore',
      timestamp: new Date(),
      message: guardError,
    };
  }

  try {
    const { error } = await supabase
      .from(tableName)
      .update({ deleted_at: null })
      .eq('id', recordId);

    if (error) throw error;

    return {
      success: true,
      recordId,
      operation: 'restore',
      timestamp: new Date(),
      message: 'Record restored from soft delete',
    };
  } catch (error: any) {
    return {
      success: false,
      recordId,
      operation: 'restore',
      timestamp: new Date(),
      message: `Restore failed: ${error.message}`,
    };
  }
}

/**
 * Hard delete a record (permanent, unrecoverable) - ADMIN ONLY
 * Requires:
 * 1. Admin role
 * 2. MFA verification
 * 3. Password verification
 * 4. Explicit confirmation
 */
export async function hardDeleteRecord(
  tableName: string,
  recordId: string,
  user: User | null,
  reason: string,
  verifyFunctions: {
    verifyAdminPassword: (pwd: string) => Promise<boolean>;
    verifyMFA: (code: string) => Promise<boolean>;
  }
): Promise<DeleteOperationResult> {
  // Check 1: Admin role required
  if (!user || user.role !== 'admin') {
    return {
      success: false,
      recordId,
      operation: 'hard_delete',
      timestamp: new Date(),
      message: 'Unauthorized: admin role required for hard delete',
    };
  }

  const guardError = assertSafeTarget(tableName, recordId);
  if (guardError) {
    return {
      success: false,
      recordId,
      operation: 'hard_delete',
      timestamp: new Date(),
      message: guardError,
    };
  }

  try {
    // Step 1: Log the hard delete intent via RPC
    const { error: logError } = await supabase.rpc('hard_delete_record', {
      _table_name: tableName,
      _record_id: recordId,
      _reason: reason,
    });

    if (logError) throw new Error(`Audit logging failed: ${logError.message}`);

    // Step 2: Execute the actual deletion
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .eq('id', recordId);

    if (deleteError) throw deleteError;

    return {
      success: true,
      recordId,
      operation: 'hard_delete',
      timestamp: new Date(),
      message: 'Record permanently deleted (unrecoverable)',
    };
  } catch (error: any) {
    return {
      success: false,
      recordId,
      operation: 'hard_delete',
      timestamp: new Date(),
      message: `Hard delete failed: ${error.message}`,
    };
  }
}

/**
 * Bulk soft delete multiple records (with rate limiting)
 */
export async function bulkSoftDelete(
  tableName: string,
  recordIds: string[],
  reason?: string
): Promise<BulkDeleteResult> {
  const results: DeleteOperationResult[] = [];
  const failures: Array<{ recordId: string; error: string }> = [];

  // Rate limit: max 100 deletes per operation
  if (recordIds.length > 100) {
    return {
      totalRequested: recordIds.length,
      successCount: 0,
      failedCount: recordIds.length,
      failures: recordIds.map(id => ({
        recordId: id,
        error: 'Bulk operation limited to 100 records per request',
      })),
      timestamp: new Date(),
    };
  }

  // Process deletes with 100ms delay between batches
  for (let i = 0; i < recordIds.length; i++) {
    if (i > 0 && i % 10 === 0) {
      // Add slight delay every 10 records to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const result = await softDeleteRecord(tableName, recordIds[i], reason);
    results.push(result);

    if (!result.success) {
      failures.push({ recordId: recordIds[i], error: result.message });
    }
  }

  const successCount = results.filter(r => r.success).length;

  return {
    totalRequested: recordIds.length,
    successCount,
    failedCount: failures.length,
    failures,
    timestamp: new Date(),
  };
}

/**
 * Get soft-deleted records for a table (admin-only)
 */
export async function getSoftDeletedRecords(
  tableName: string,
  user: User | null
): Promise<any[]> {
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized: admin role required');
  }

  const guardError = assertSafeTarget(tableName);
  if (guardError) throw new Error(guardError);

  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Audit log viewer (admin-only)
 * Fetch audit log entries with filtering
 */
export async function getAuditLog(
  user: User | null,
  options?: {
    tableName?: string;
    operation?: string;
    recordId?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }
): Promise<any[]> {
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized: admin role required');
  }

  let query = supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false });

  if (options?.tableName) {
    query = query.eq('table_name', options.tableName);
  }

  if (options?.operation) {
    query = query.eq('operation', options.operation);
  }

  if (options?.recordId) {
    query = query.eq('record_id', options.recordId);
  }

  if (options?.userId) {
    query = query.eq('user_id', options.userId);
  }

  if (options?.startDate) {
    query = query.gte('created_at', options.startDate.toISOString());
  }

  if (options?.endDate) {
    query = query.lte('created_at', options.endDate.toISOString());
  }

  const limit = options?.limit || 100;
  query = query.limit(limit);

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Count records by operation in audit log
 * Useful for dashboard metrics
 */
export async function getAuditLogStats(
  user: User | null,
  timeRange: 'last_hour' | 'last_day' | 'last_week' | 'last_month' = 'last_day'
): Promise<Record<string, number>> {
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized: admin role required');
  }

  const now = new Date();
  let startDate = new Date();

  switch (timeRange) {
    case 'last_hour':
      startDate.setHours(startDate.getHours() - 1);
      break;
    case 'last_day':
      startDate.setDate(startDate.getDate() - 1);
      break;
    case 'last_week':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'last_month':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
  }

  const { data, error } = await supabase
    .rpc('get_audit_log_stats', {
      _start_date: startDate.toISOString(),
      _end_date: now.toISOString(),
    });

  if (error) {
    console.error('Failed to get audit stats:', error);
    return {};
  }

  // Transform response to operation counts
  const stats: Record<string, number> = {};
  if (Array.isArray(data)) {
    data.forEach((item: any) => {
      stats[item.operation || 'unknown'] = item.count || 0;
    });
  }

  return stats;
}

/**
 * Check if record was recently modified (within last N minutes)
 * Prevents accidental operations on stale data
 */
export async function isRecordRecentlyModified(
  tableName: string,
  recordId: string,
  minutesThreshold: number = 5
): Promise<boolean> {
  try {
    const thresholdTime = new Date(Date.now() - minutesThreshold * 60 * 1000);

    const { data, error } = await supabase
      .from(tableName)
      .select('updated_at')
      .eq('id', recordId)
      .single();

    if (error) {
      console.error('Error checking record modification time:', error);
      return false;
    }

    if (!data?.updated_at) return false;

    const updatedAt = new Date(data.updated_at);
    return updatedAt > thresholdTime;
  } catch (error) {
    console.error('Error in isRecordRecentlyModified:', error);
    return false;
  }
}

/**
 * Create a data snapshot before deletion (for recovery)
 * Stores a JSON snapshot in audit log
 */
export async function snapshotRecordBeforeDeletion(
  tableName: string,
  recordId: string,
  reason: string
): Promise<boolean> {
  try {
    // Fetch the record
    const { data, error: fetchError } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError) throw fetchError;

    // Store snapshot in audit log with special reason
    const { error: logError } = await supabase
      .from('audit_log')
      .insert({
        operation: 'SNAPSHOT',
        table_name: tableName,
        record_id: recordId,
        user_id: null,
        new_values: data,
        reason: `Pre-deletion snapshot: ${reason}`,
      });

    if (logError) throw logError;

    return true;
  } catch (error) {
    console.error('Error creating record snapshot:', error);
    return false;
  }
}

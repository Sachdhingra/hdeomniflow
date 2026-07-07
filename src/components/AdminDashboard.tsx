/**
 * Admin Dashboard
 * Displays audit logs, data integrity checks, and security monitoring
 * Only visible to admin users
 */

import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAuditLog, getAuditLogStats } from "@/utils/secureDataOps";
import { runAllIntegrityChecks, detectAnomalies } from "@/utils/dataIntegrity";
import type {
  IntegrityCheckResult,
  AnomalyDetected,
  CheckItem,
} from "@/utils/dataIntegrity";

export const AdminDashboard: React.FC = () => {
  const { user, isAdmin, canAccessAuditLog } = useAuth();
  const [tab, setTab] = useState<"overview" | "audit" | "integrity" | "anomalies">("overview");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditStats, setAuditStats] = useState<Record<string, number>>({});
  const [integrityResult, setIntegrityResult] = useState<IntegrityCheckResult | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyDetected[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch admin data
  useEffect(() => {
    if (!user || !isAdmin() || !canAccessAuditLog()) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // Fetch recent audit logs
        const logs = await getAuditLog(user, { limit: 50 });
        setAuditLogs(logs);

        // Fetch audit statistics
        const stats = await getAuditLogStats(user, "last_day");
        setAuditStats(stats);

        // Run integrity checks
        const integrity = await runAllIntegrityChecks();
        setIntegrityResult(integrity);

        // Detect anomalies
        const detected = await detectAnomalies();
        setAnomalies(detected);
      } catch (error) {
        console.error("Error loading admin data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Refresh every 60 seconds
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [user, isAdmin, canAccessAuditLog]);

  if (!user || !isAdmin()) {
    return (
      <div className="p-4 text-red-600">
        <p>❌ Unauthorized: Admin access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">🔐 Admin Dashboard</h1>
        <p className="text-gray-600 mt-2">Data protection, audit logs, and security monitoring</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-200">
        {["overview", "audit", "integrity", "anomalies"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {t === "overview" && "📊 Overview"}
            {t === "audit" && "📋 Audit Log"}
            {t === "integrity" && "✅ Integrity"}
            {t === "anomalies" && "⚠️ Anomalies"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-600">Loading admin data...</p>
        </div>
      ) : (
        <>
          {/* Overview Tab */}
          {tab === "overview" && (
            <div className="space-y-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-lg shadow">
                  <p className="text-gray-600 text-sm">Total Operations (24h)</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {Object.values(auditStats).reduce((a, b) => a + b, 0)}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow">
                  <p className="text-gray-600 text-sm">Inserts</p>
                  <p className="text-2xl font-bold text-green-600">{auditStats.INSERT || 0}</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow">
                  <p className="text-gray-600 text-sm">Updates</p>
                  <p className="text-2xl font-bold text-blue-600">{auditStats.UPDATE || 0}</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow">
                  <p className="text-gray-600 text-sm">Deletes</p>
                  <p className="text-2xl font-bold text-red-600">
                    {(auditStats.SOFT_DELETE || 0) + (auditStats.HARD_DELETE || 0)}
                  </p>
                </div>
              </div>

              {/* Integrity Summary */}
              {integrityResult && (
                <div className="bg-white p-4 rounded-lg shadow">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Data Integrity Status</h3>
                  <p className="text-sm text-gray-600 mb-2">Last checked: {integrityResult.timestamp.toLocaleTimeString()}</p>
                  <div className="space-y-2">
                    {integrityResult.checks.map((check, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-lg">
                          {check.status === "pass" && "✅"}
                          {check.status === "fail" && "❌"}
                          {check.status === "warning" && "⚠️"}
                        </span>
                        <div>
                          <p className="font-medium text-gray-900">{check.name}</p>
                          <p className="text-sm text-gray-600">{check.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Audit Log Tab */}
          {tab === "audit" && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-900">Operation</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-900">Table</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-900">User</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-900">Time</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-900">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-600">
                          No audit entries found
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${
                                log.operation === "INSERT"
                                  ? "bg-green-100 text-green-800"
                                  : log.operation === "UPDATE"
                                  ? "bg-blue-100 text-blue-800"
                                  : log.operation === "DELETE"
                                  ? "bg-red-100 text-red-800"
                                  : log.operation === "HARD_DELETE"
                                  ? "bg-red-200 text-red-900"
                                  : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {log.operation}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">
                            {log.table_name}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {log.user_email || log.user_role || "system"}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(log.created_at).toLocaleTimeString()}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {log.reason ? (
                              <span className="font-medium">{log.reason}</span>
                            ) : (
                              <span className="text-gray-400">ID: {log.record_id.slice(0, 8)}...</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Integrity Tab */}
          {tab === "integrity" && integrityResult && (
            <div className="space-y-4">
              {integrityResult.checks.map((check, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border-2 ${
                    check.status === "pass"
                      ? "border-green-200 bg-green-50"
                      : check.status === "warning"
                      ? "border-yellow-200 bg-yellow-50"
                      : "border-red-200 bg-red-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">
                      {check.status === "pass" && "✅"}
                      {check.status === "fail" && "❌"}
                      {check.status === "warning" && "⚠️"}
                    </span>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{check.name}</h3>
                      <p className="text-sm text-gray-700 mt-1">{check.message}</p>
                      <p className="text-xs text-gray-600 mt-2">
                        Severity: <span className="font-semibold uppercase">{check.severity}</span>
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={async () => {
                  setLoading(true);
                  const result = await runAllIntegrityChecks();
                  setIntegrityResult(result);
                  setLoading(false);
                }}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                🔄 Re-run Checks
              </button>
            </div>
          )}

          {/* Anomalies Tab */}
          {tab === "anomalies" && (
            <div className="space-y-4">
              {anomalies.length === 0 ? (
                <div className="bg-green-50 border-2 border-green-200 p-6 rounded-lg text-center">
                  <p className="text-green-800 font-semibold">✅ No anomalies detected</p>
                  <p className="text-sm text-green-700 mt-2">System operating normally</p>
                </div>
              ) : (
                anomalies.map((anomaly, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border-2 ${
                      anomaly.severity === "critical"
                        ? "border-red-300 bg-red-50"
                        : anomaly.severity === "high"
                        ? "border-orange-300 bg-orange-50"
                        : "border-yellow-300 bg-yellow-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">
                        {anomaly.severity === "critical" && "🚨"}
                        {anomaly.severity === "high" && "⚠️"}
                        {anomaly.severity === "medium" && "⚠️"}
                        {anomaly.severity === "low" && "ℹ️"}
                      </span>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 capitalize">
                          {anomaly.type.replace(/_/g, " ")}
                        </h3>
                        <p className="text-sm text-gray-700 mt-1">{anomaly.description}</p>
                        <p className="text-xs text-gray-600 mt-2">
                          📋 Action: <span className="font-semibold">{anomaly.recommended_action}</span>
                        </p>
                        {anomaly.affected_records && anomaly.affected_records.length > 0 && (
                          <p className="text-xs text-gray-600 mt-1">
                            🔗 Affected records: {anomaly.affected_records.length}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}

              <button
                onClick={async () => {
                  setLoading(true);
                  const detected = await detectAnomalies();
                  setAnomalies(detected);
                  setLoading(false);
                }}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                🔍 Re-scan Anomalies
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AdminDashboard;

import { apiFetch } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";

// --- Discovery ---
export interface MCPServer {
  id: string;
  name: string | null;
  endpoint: string;
  discovery_status: string;
  metadata: Record<string, any>;
  discovered_at: string;
  last_seen_at: string;
}

export interface MCPServerList {
  items: MCPServer[];
  total: number;
  limit: number;
  offset: number;
}

export async function syncDiscovery(): Promise<MCPServer[]> {
  return apiFetch<MCPServer[]>("/discovery/sync", { method: "POST" });
}

export async function markStaleServers(): Promise<MCPServer[]> {
  return apiFetch<MCPServer[]>("/discovery/stale", { method: "POST" });
}

export async function fetchServers(params: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<MCPServerList> {
  const query = new URLSearchParams();
  if (params.status) query.append("status", params.status);
  if (params.search) query.append("search", params.search);
  if (params.limit) query.append("limit", String(params.limit));
  if (params.offset) query.append("offset", String(params.offset));
  
  const queryString = query.toString();
  return apiFetch<MCPServerList>(`/discovery${queryString ? `?${queryString}` : ""}`);
}

export async function fetchServer(serverId: string): Promise<MCPServer> {
  return apiFetch<MCPServer>(`/discovery/${serverId}`);
}

// --- Connections ---
export interface ConnectionEvent {
  id: string;
  connection_id: string;
  endpoint: string;
  transport_type: string;
  status: string;
  metadata: Record<string, any>;
  connected_at: string;
  disconnected_at: string | null;
}

export interface ConnectionList {
  items: ConnectionEvent[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchConnections(params: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ConnectionList> {
  const query = new URLSearchParams();
  if (params.status) query.append("status", params.status);
  if (params.limit) query.append("limit", String(params.limit));
  if (params.offset) query.append("offset", String(params.offset));

  const queryString = query.toString();
  return apiFetch<ConnectionList>(`/connections${queryString ? `?${queryString}` : ""}`);
}

export async function closeConnection(connectionId: string): Promise<void> {
  return apiFetch<void>(`/connections/${connectionId}/close`, { method: "POST" });
}

// --- Scanning & Capabilities ---
export interface ScanResponse {
  server_id: string;
  status: string;
  tools_count: number;
  error_message: string | null;
}

export interface ToolCapability {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  input_schema: Record<string, any>;
  category: string;
  risk_score: number;
}

export async function scanServer(serverId: string): Promise<ScanResponse> {
  return apiFetch<ScanResponse>(`/scanning/scan/${serverId}`, { method: "POST" });
}

export async function rescanServer(serverId: string): Promise<ScanResponse> {
  return apiFetch<ScanResponse>(`/scanning/rescan/${serverId}`, { method: "POST" });
}

export async function fetchServerCapabilities(serverId: string): Promise<ToolCapability[]> {
  return apiFetch<ToolCapability[]>(`/capabilities/server/${serverId}`);
}

// --- Risk Assessment ---
export interface RiskFinding {
  id: string;
  server_id: string;
  overall_score: number;
  risk_level: string;
  findings: Array<{
    type: string;
    description: string;
    score_impact: number;
    severity: string;
  }>;
}

export async function fetchServerRiskFinding(serverId: string): Promise<RiskFinding> {
  return apiFetch<RiskFinding>(`/risk/server/${serverId}`);
}

export async function fetchRiskFindings(): Promise<RiskFinding[]> {
  return apiFetch<RiskFinding[]>("/risk/findings");
}

// --- Compliance Risk Cards ---
export interface RiskCard {
  id: string;
  server_id: string;
  summary: string;
  compliance_status: string;
  card_data: Record<string, any>;
}

export async function fetchServerRiskCard(serverId: string): Promise<RiskCard> {
  return apiFetch<RiskCard>(`/risk-cards/server/${serverId}`);
}

export async function fetchRiskCards(): Promise<RiskCard[]> {
  return apiFetch<RiskCard[]>("/risk-cards");
}

// --- Policies ---
export interface Policy {
  id: string;
  name: string;
  description: string | null;
  rules: Record<string, any>;
  action: string;
  is_active: boolean;
}

export async function createPolicy(payload: {
  name: string;
  description?: string;
  rules: Record<string, any>;
  action: string;
}): Promise<Policy> {
  return apiFetch<Policy>("/policies", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePolicy(
  policyId: string,
  payload: {
    name: string;
    description?: string;
    rules: Record<string, any>;
    action: string;
    is_active: boolean;
  }
): Promise<Policy> {
  return apiFetch<Policy>(`/policies/${policyId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchPolicies(onlyActive = false): Promise<Policy[]> {
  return apiFetch<Policy[]>(`/policies?only_active=${onlyActive}`);
}

export async function deletePolicy(policyId: string): Promise<void> {
  return apiFetch<void>(`/policies/${policyId}`, { method: "DELETE" });
}

// --- Governance ---
export interface GovernanceRecommendation {
  id: string;
  server_id: string;
  recommendation_text: string;
  suggested_action: string;
  status: string;
  finding_id: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export async function fetchRecommendations(status?: string): Promise<GovernanceRecommendation[]> {
  return apiFetch<GovernanceRecommendation[]>(
    `/governance/recommendations${status ? `?status=${status}` : ""}`
  );
}

export async function acknowledgeRecommendation(recommendationId: string): Promise<GovernanceRecommendation> {
  return apiFetch<GovernanceRecommendation>(
    `/governance/recommendations/${recommendationId}/acknowledge`,
    { method: "POST" }
  );
}

// --- Alerts ---
export interface Alert {
  id: string;
  rule_name: string;
  severity: string;
  message: string;
  status: string;
  server_id: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface AlertList {
  items: Alert[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchAlerts(params: {
  status?: string;
  severity?: string;
  server_id?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<AlertList> {
  const query = new URLSearchParams();
  if (params.status) query.append("status", params.status);
  if (params.severity) query.append("severity", params.severity);
  if (params.server_id) query.append("server_id", params.server_id);
  if (params.limit) query.append("limit", String(params.limit));
  if (params.offset) query.append("offset", String(params.offset));

  const queryString = query.toString();
  return apiFetch<AlertList>(`/alerts${queryString ? `?${queryString}` : ""}`);
}

export async function acknowledgeAlert(alertId: string): Promise<Alert> {
  return apiFetch<Alert>(`/alerts/${alertId}/acknowledge`, { method: "POST" });
}

export async function resolveAlert(alertId: string): Promise<Alert> {
  return apiFetch<Alert>(`/alerts/${alertId}/resolve`, { method: "POST" });
}

// --- Audit Trail ---
export interface AuditLog {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
  user_id: string | null;
  ip_address: string | null;
  context_data: Record<string, any>;
}

export interface AuditLogList {
  items: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchAuditLogs(params: {
  event_type?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<AuditLogList> {
  const query = new URLSearchParams();
  if (params.event_type) query.append("event_type", params.event_type);
  if (params.user_id) query.append("user_id", params.user_id);
  if (params.limit) query.append("limit", String(params.limit));
  if (params.offset) query.append("offset", String(params.offset));

  const queryString = query.toString();
  return apiFetch<AuditLogList>(`/audit/logs${queryString ? `?${queryString}` : ""}`);
}

export async function exportAuditLogs(eventType?: string): Promise<Response> {
  const query = new URLSearchParams();
  if (eventType) query.append("event_type", eventType);
  const queryString = query.toString();

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
  const token = tokenStorage.getAccessToken();

  return fetch(`${API_BASE_URL}/audit/export${queryString ? `?${queryString}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// --- Dashboard & Analytics ---
export interface DashboardSummary {
  total_connections: number;
  total_servers: number;
  scanned_servers: number;
  active_alerts: number;
  risk_distribution: Record<string, number>;
  recent_activity: Array<{
    id: string;
    event_type: string;
    description: string;
    created_at: string;
  }>;
}

export interface AnalyticsSummary {
  capabilities_distribution: Record<string, number>;
  risk_distribution: Record<string, number>;
  connections_over_time: Array<{
    date: string;
    active: number;
    total: number;
  }>;
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>("/dashboard/summary");
}

export async function fetchAnalyticsSummary(): Promise<AnalyticsSummary> {
  return apiFetch<AnalyticsSummary>("/dashboard/analytics");
}

// --- User Management ---
export interface ManagedUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface ManagedUserList {
  items: ManagedUser[];
  total: number;
}

export async function fetchUsers(params: {
  limit?: number;
  offset?: number;
} = {}): Promise<ManagedUserList> {
  const query = new URLSearchParams();
  if (params.limit) query.append("limit", String(params.limit));
  if (params.offset) query.append("offset", String(params.offset));

  const queryString = query.toString();
  return apiFetch<ManagedUserList>(`/users${queryString ? `?${queryString}` : ""}`);
}

export async function updateUserRole(userId: string, role: string): Promise<ManagedUser> {
  return apiFetch<ManagedUser>(`/users/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export async function deactivateUser(userId: string, isActive: boolean): Promise<ManagedUser> {
  return apiFetch<ManagedUser>(`/users/${userId}/deactivate`, {
    method: "PUT",
    body: JSON.stringify({ is_active: isActive }),
  });
}

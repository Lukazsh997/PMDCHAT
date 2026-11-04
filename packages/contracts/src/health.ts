export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthResponse {
  status: HealthStatus;
  version: string;
  uptimeSeconds: number;
  checks: Record<string, { status: 'ok' | 'down'; latencyMs?: number; error?: string }>;
}

import { apiFetch } from "./client";
import type {
  AuditsResponse,
  AuditDetailResponse,
  RecordScanResponse,
  CompleteAuditResponse,
} from "./types";

export const auditsApi = {
  /** Get paginated audits for an organization */
  audits: (
    orgId: string,
    params?: {
      status?: string;
      page?: number;
      perPage?: number;
      search?: string;
    }
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    if (params?.search) searchParams.set("search", params.search);
    return apiFetch<AuditsResponse>(`/api/mobile/audits?${searchParams}`);
  },

  /** Get full audit detail with expected assets and existing scans */
  audit: (auditId: string, orgId: string) =>
    apiFetch<AuditDetailResponse>(
      `/api/mobile/audits/${auditId}?orgId=${orgId}`
    ),

  /** Record a scan during an audit (idempotent) */
  recordAuditScan: (
    orgId: string,
    payload: {
      auditSessionId: string;
      qrId: string;
      assetId: string;
      isExpected: boolean;
    }
  ) =>
    apiFetch<RecordScanResponse>(
      `/api/mobile/audits/record-scan?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  /** Complete an audit session */
  completeAudit: (
    orgId: string,
    payload: {
      sessionId: string;
      completionNote?: string;
      timeZone?: string;
    }
  ) =>
    apiFetch<CompleteAuditResponse>(
      `/api/mobile/audits/complete?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
};

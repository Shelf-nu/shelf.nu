import { apiFetch } from "./client";
import type {
  AuditsResponse,
  AuditDetailResponse,
  RecordScanResponse,
  CompleteAuditResponse,
} from "./types";

export const auditsApi = {
  /**
   * Get paginated audits for an organization.
   *
   * @param orgId Active organization id from `useOrg`.
   * @param params Optional filters / pagination.
   *   - `status`: comma-separated `AuditStatus` values (e.g. `"PENDING,ACTIVE"`).
   *   - `assignedToMe`: when `true`, restricts the result to audits the
   *     caller is assigned to. For BASE/SELF_SERVICE users this is
   *     already implicit server-side; for admins/owners it's the
   *     companion's "Assigned to me" filter toggle.
   *   - `signal`: AbortSignal for in-flight cancellation on rapid filter
   *     toggling (the list re-fires on every chip tap, and we don't want
   *     a stale response to overwrite the current one).
   * Results are always sorted server-side by `dueDate asc nulls last,
   * createdAt desc` so overdue + soon-due work surfaces first.
   */
  audits: (
    orgId: string,
    params?: {
      status?: string;
      page?: number;
      perPage?: number;
      search?: string;
      assignedToMe?: boolean;
    },
    signal?: AbortSignal
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    if (params?.search) searchParams.set("search", params.search);
    if (params?.assignedToMe) searchParams.set("assignedToMe", "true");
    return apiFetch<AuditsResponse>(`/api/mobile/audits?${searchParams}`, {
      signal,
    });
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
